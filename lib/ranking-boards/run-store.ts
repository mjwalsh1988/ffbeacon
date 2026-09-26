import "server-only";

/**
 * Beacon Ranker's persistence (plan section 8): reading and writing runs for a
 * signed-in reader (ranking_builder_runs, migration 0307) and for a guest
 * (ranking_guest_boards, migration 0308), and flushing a run's board into
 * user_ranking_board_players.
 *
 * NOTHING HERE TRUSTS THE BROWSER. The setup is written by the server when a
 * run starts and never accepted from a request afterwards; every answer is
 * folded against it on the server (lib/ranking-boards/builder.ts) before it is
 * appended. A guest's cap, a run's depth and the seed itself all live in that
 * server-written setup, so editing a request changes none of them.
 *
 * Appends are optimistic: `where answer_count = <count read>`. Two tabs cannot
 * both append to the same log; the loser gets "already answered" and resyncs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  isBoardScope,
  MAX_BOARD_PLAYERS,
  normalizeTierBreaks,
  type BoardScope,
} from "@/lib/ranking-boards";
import { parseAnswerLog, type Answer, type RunSetup, type RunState } from "./builder";

type Client = SupabaseClient<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the page needs to describe a run, stored beside the setup. The fold
 * ignores it. */
export type RunMeta = {
  scope: BoardScope;
  includesDefenders: boolean;
  formatSlug: string;
  formatDisplay: string;
  /** format_configs.scoring_type, for the finishes on the cards. */
  scoringType: string;
  sourceSlug: string | null;
  sourceDisplay: string | null;
  /** One sentence: what the seed is. */
  seedNote: string;
  /** The defender seed's basis sentence, when defenders are in the run. */
  defenderNote: string | null;
  lastCompletedSeason: number;
  boardName: string;
  /** Guests cannot draw tiers (decision 13). */
  tiersAllowed: boolean;
};

export type StoredSetup = RunSetup & { meta: RunMeta };

function uuidList(raw: unknown, max: number): string[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  return raw.every((v) => typeof v === "string" && UUID_RE.test(v)) ? (raw as string[]) : null;
}

function intIn(raw: unknown, min: number, max: number): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max ? raw : null;
}

/** Read a stored setup back. Anything malformed is null, and a null setup is
 * a run that cannot be resumed rather than one folded from garbage. */
export function parseStoredSetup(raw: unknown): StoredSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const seed = uuidList(r.seed, MAX_BOARD_PLAYERS);
  const secondPass = uuidList(r.secondPass, MAX_BOARD_PLAYERS);
  const initialBoard = uuidList(r.initialBoard, MAX_BOARD_PLAYERS);
  const startRank = intIn(r.startRank, 1, MAX_BOARD_PLAYERS + 1);
  const depth = intIn(r.depth, 0, MAX_BOARD_PLAYERS);
  const winsBeforePrompt = intIn(r.winsBeforePrompt, 1, 100);
  const cap = r.cap === null ? null : intIn(r.cap, 1, MAX_BOARD_PLAYERS);
  const breaks = Array.isArray(r.initialBreaks)
    ? normalizeTierBreaks(r.initialBreaks, MAX_BOARD_PLAYERS + 1).breaks
    : [];
  const meta = r.meta as RunMeta | undefined;
  if (
    !seed || !secondPass || !initialBoard || startRank === null || depth === null ||
    winsBeforePrompt === null || (r.cap !== null && cap === null) || !meta ||
    typeof meta !== "object" || !isBoardScope(String(meta.scope))
  ) {
    return null;
  }
  return { seed, secondPass, initialBoard, startRank, depth, winsBeforePrompt, cap, initialBreaks: breaks, meta };
}

export type AccountRun = {
  kind: "board";
  runId: string;
  boardId: string;
  setup: StoredSetup;
  answers: Answer[];
  count: number;
  checkpointCount: number;
};

export type GuestRun = {
  kind: "guest";
  guestBoardId: string;
  guestId: string;
  setup: StoredSetup;
  answers: Answer[];
  count: number;
  updatedAt: string;
};

export type LoadedRun = AccountRun | GuestRun;

/** The signed-in reader's open run on one board. RLS scopes it to the owner. */
export async function loadAccountRun(
  supabase: Client,
  boardId: string,
): Promise<AccountRun | null> {
  if (!UUID_RE.test(boardId)) return null;
  const { data } = await supabase
    .from("ranking_builder_runs")
    .select("id, board_id, setup, answers, answer_count, checkpoint_count")
    .eq("board_id", boardId)
    .maybeSingle();
  if (!data) return null;
  const setup = parseStoredSetup(data.setup);
  if (!setup) return null;
  return {
    kind: "board",
    runId: data.id,
    boardId: data.board_id,
    setup,
    answers: parseAnswerLog(data.answers).slice(0, data.answer_count),
    count: data.answer_count,
    checkpointCount: data.checkpoint_count,
  };
}

/** The signed-in reader's most recently touched open run, for "Resume". */
export async function latestAccountRunBoardId(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("ranking_builder_runs")
    .select("board_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.board_id ?? null;
}

/** A guest's board and run. Service-role only: the table has no other policy. */
export async function loadGuestRun(admin: Client, guestId: string): Promise<GuestRun | null> {
  const { data } = await admin
    .from("ranking_guest_boards")
    .select("id, guest_id, run_setup, run_answers, answer_count, updated_at")
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!data) return null;
  const setup = parseStoredSetup(data.run_setup);
  if (!setup) return null;
  return {
    kind: "guest",
    guestBoardId: data.id,
    guestId: data.guest_id,
    setup,
    answers: parseAnswerLog(data.run_answers).slice(0, data.answer_count),
    count: data.answer_count,
    updatedAt: data.updated_at,
  };
}

/**
 * Replace a run's log with `answers` if nobody else changed it since `expected`
 * was read. Returns false when the lock was lost.
 */
export async function writeAccountAnswers(
  supabase: Client,
  run: AccountRun,
  answers: Answer[],
  expected: number,
  checkpointCount?: number,
): Promise<boolean> {
  const update: Database["public"]["Tables"]["ranking_builder_runs"]["Update"] = {
    answers: answers as unknown as Json,
    answer_count: answers.length,
    updated_at: new Date().toISOString(),
  };
  if (checkpointCount !== undefined) update.checkpoint_count = checkpointCount;
  const { data, error } = await supabase
    .from("ranking_builder_runs")
    .update(update)
    .eq("id", run.runId)
    .eq("answer_count", expected)
    .select("id");
  return !error && (data?.length ?? 0) === 1;
}

export async function writeGuestAnswers(
  admin: Client,
  run: GuestRun,
  answers: Answer[],
  expected: number,
  board: string[],
  leftOff: string[],
): Promise<boolean> {
  const { data, error } = await admin
    .from("ranking_guest_boards")
    .update({
      run_answers: answers as unknown as Json,
      answer_count: answers.length,
      player_ids: board,
      left_off_player_ids: leftOff,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.guestBoardId)
    .eq("answer_count", expected)
    .select("id");
  return !error && (data?.length ?? 0) === 1;
}

/**
 * Write a run's board into user_ranking_board_players: remove the players no
 * longer on it, upsert everyone else at their rank, record who was LEFT OFF
 * (a judgement the community merge reads), and keep every tier line at its
 * rank unless the tier pass produced new ones.
 *
 * Runs on the reader's own session client, so the owner-only RLS policies are
 * the backstop for every write.
 */
export async function flushAccountBoard(
  supabase: Client,
  boardId: string,
  board: string[],
  state: RunState,
  opts: { tierBreaks: number[] | null },
): Promise<boolean> {
  const existing = await fetchAllRows("ranker flush existing", (from, to) =>
    supabase
      .from("user_ranking_board_players")
      .select("id, player_id")
      .eq("board_id", boardId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const keep = new Set(board);
  const removals = existing.filter((r) => !keep.has(r.player_id)).map((r) => r.player_id);
  for (let i = 0; i < removals.length; i += 200) {
    const { error } = await supabase
      .from("user_ranking_board_players")
      .delete()
      .eq("board_id", boardId)
      .in("player_id", removals.slice(i, i + 200));
    if (error) return false;
  }
  const nowIso = new Date().toISOString();
  for (let i = 0; i < board.length; i += 500) {
    const rows = board.slice(i, i + 500).map((playerId, j) => ({
      board_id: boardId,
      player_id: playerId,
      rank_position: i + j + 1,
      updated_at: nowIso,
    }));
    const { error } = await supabase
      .from("user_ranking_board_players")
      .upsert(rows, { onConflict: "board_id,player_id" });
    if (error) return false;
  }

  const { data: boardRow } = await supabase
    .from("user_ranking_boards")
    .select("tier_breaks, left_off_player_ids")
    .eq("id", boardId)
    .maybeSingle();
  const leftOff = [
    ...new Set([...(boardRow?.left_off_player_ids ?? []), ...state.leftOff]),
  ].filter((id) => !keep.has(id)).slice(0, MAX_BOARD_PLAYERS);
  const breaks = normalizeTierBreaks(opts.tierBreaks ?? boardRow?.tier_breaks ?? [], board.length).breaks;
  const { error } = await supabase
    .from("user_ranking_boards")
    .update({
      tier_breaks: breaks,
      left_off_player_ids: leftOff,
      ...(opts.tierBreaks && opts.tierBreaks.length > 0 ? { tiers_enabled: true } : {}),
      updated_at: nowIso,
    })
    .eq("id", boardId);
  return !error;
}
