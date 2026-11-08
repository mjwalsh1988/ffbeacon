/**
 * The Long Shot attempt engine (plan 8, 9, 16, 17). The only place a route
 * touches long_shot_attempts and long_shot_answers.
 *
 * CONSISTENCY MODEL: supabase-js has no multi-statement transactions, so
 * every write is status-guarded, the Signal Scout engine's pattern
 * (lib/signal-scout/round-engine.ts header). The answer row is settled first
 * (guarded on state = 'pending'), then the attempt row advances (guarded on
 * its old current_position and status = 'active'). A crash between the two
 * leaves the attempt one behind; serveNext's repair path notices the settled
 * row at current_position, advances the attempt and recomputes base_points.
 * base_points is ALWAYS recomputed from the answer rows, never incremented.
 *
 * THE CLOCK: the pending row for a position is created by serveNext and
 * nowhere else, with served_at = now(). Serving it again returns the same
 * served_at. The answer response never creates the next row, so the next
 * prompt's clock starts only when the player asks for it.
 *
 * TRACKING: tallies and stats are Hurry-Up only. Every incrementTally and
 * recordCompletion call below sits inside a mode === "hurry_up" branch
 * (lib/long-shot/film-room-guard.test.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { addDays } from "@/lib/game-date";
import { LongShotError } from "./errors";
import { ensurePuzzle } from "./generate";
import { dailyRank, loadExclusionSet } from "./rank";
import { scoreAnswer, sumPoints } from "./scoring";
import { recordCompletion } from "./stats";
import { displayedStreak } from "./streaks";
import { incrementTally, loadPlayerInfo, loadRoom, type PlayerInfo } from "./tallies";
import { loadTeamColors, teamTonesFor } from "./team-colors";
import { isExpired, remainingMs } from "./timer";
import type {
  AnswerEntry,
  AnswerState,
  AnswerSummaryDto,
  AttemptDto,
  AttemptStatus,
  CompletedDto,
  LongShotSettings,
  Mode,
  PromptDto,
  ResultDto,
  Tier,
} from "./types";

type Client = SupabaseClient<Database>;

export interface AttemptRow {
  id: string;
  user_id: string;
  puzzle_id: string;
  game_date: string;
  mode: Mode;
  status: AttemptStatus;
  current_position: number;
  base_points: number;
  bonus_points: number;
  total_points: number;
  timer_seconds: number | null;
  started_at: string;
  completed_at: string | null;
  stats_recorded_at: string | null;
  settled_at: string | null;
}

export interface AnswerRow {
  id: string;
  attempt_id: string;
  prompt_id: string;
  position: number;
  state: AnswerState;
  served_at: string;
  answered_at: string | null;
  player_id: string | null;
  correct: boolean | null;
  tier: Tier | null;
  points: number;
  lone_signal: boolean;
}

interface PromptRow {
  id: string;
  position: number;
  prompt_text: string;
  answers: AnswerEntry[];
}

const ATTEMPT_COLUMNS =
  "id, user_id, puzzle_id, game_date, mode, status, current_position, base_points, bonus_points, total_points, timer_seconds, started_at, completed_at, stats_recorded_at, settled_at";
const ANSWER_COLUMNS =
  "id, attempt_id, prompt_id, position, state, served_at, answered_at, player_id, correct, tier, points, lone_signal";

function fail(label: string, error: { message: string } | null): void {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findActiveAttempt(admin: Client, userId: string): Promise<AttemptRow | null> {
  const { data, error } = await admin
    .from("long_shot_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1);
  fail("active attempt read failed", error);
  return (data?.[0] as AttemptRow | undefined) ?? null;
}

/** The caller's attempt, or not_found: an id that is not theirs cannot be probed. */
export async function loadAttempt(admin: Client, attemptId: string, userId: string): Promise<AttemptRow> {
  const { data, error } = await admin
    .from("long_shot_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();
  fail("attempt read failed", error);
  if (!data) throw new LongShotError("not_found");
  return data as AttemptRow;
}

async function reloadAttempt(admin: Client, attemptId: string): Promise<AttemptRow> {
  const { data, error } = await admin.from("long_shot_attempts").select(ATTEMPT_COLUMNS).eq("id", attemptId).single();
  fail("attempt reload failed", error);
  return data as AttemptRow;
}

export async function loadAnswers(admin: Client, attemptId: string): Promise<AnswerRow[]> {
  const { data, error } = await admin
    .from("long_shot_answers")
    .select(ANSWER_COLUMNS)
    .eq("attempt_id", attemptId)
    .order("position", { ascending: true });
  fail("answers read failed", error);
  return (data ?? []) as AnswerRow[];
}

export async function loadPromptCount(admin: Client, puzzleId: string): Promise<number> {
  const { data, error } = await admin.from("long_shot_puzzles").select("prompt_count").eq("id", puzzleId).single();
  fail("puzzle read failed", error);
  return data!.prompt_count;
}

async function loadPrompt(admin: Client, puzzleId: string, position: number): Promise<PromptRow> {
  const { data, error } = await admin
    .from("long_shot_prompts")
    .select("id, position, prompt_text, answers")
    .eq("puzzle_id", puzzleId)
    .eq("position", position)
    .single();
  fail("prompt read failed", error);
  return data as unknown as PromptRow;
}

async function loadPromptById(admin: Client, promptId: string): Promise<PromptRow> {
  const { data, error } = await admin
    .from("long_shot_prompts")
    .select("id, position, prompt_text, answers")
    .eq("id", promptId)
    .single();
  fail("prompt read failed", error);
  return data as unknown as PromptRow;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export function toAnswerSummary(row: AnswerRow, players: ReadonlyMap<string, PlayerInfo>): AnswerSummaryDto {
  const info = row.player_id ? players.get(row.player_id) : undefined;
  return {
    position: row.position,
    state: row.state,
    tier: row.tier,
    points: row.points,
    playerName: info?.name ?? null,
    playerSlug: info?.slug ?? null,
    sleeperId: info?.sleeperId ?? null,
    teamCode: info?.teamCode ?? null,
    loneSignal: row.lone_signal,
  };
}

export function toAttemptDto(
  attempt: AttemptRow,
  answers: readonly AnswerRow[],
  promptCount: number,
  players: ReadonlyMap<string, PlayerInfo>,
): AttemptDto {
  const settled = answers.filter((a) => a.state !== "pending");
  return {
    attemptId: attempt.id,
    mode: attempt.mode,
    gameDate: attempt.game_date,
    status: attempt.status,
    promptCount,
    currentPosition: attempt.current_position,
    basePoints: attempt.base_points,
    bonusPoints: attempt.bonus_points,
    totalPoints: attempt.total_points,
    settled: attempt.settled_at !== null,
    hasPending: answers.some((a) => a.state === "pending" && a.position === attempt.current_position),
    answers: settled.map((a) => toAnswerSummary(a, players)),
  };
}

export async function buildAttemptDto(admin: Client, attempt: AttemptRow, promptCount?: number): Promise<AttemptDto> {
  const [answers, count] = await Promise.all([
    loadAnswers(admin, attempt.id),
    promptCount ?? loadPromptCount(admin, attempt.puzzle_id),
  ]);
  const players = await loadPlayerInfo(
    admin,
    answers.map((a) => a.player_id).filter((x): x is string => Boolean(x)),
  );
  return toAttemptDto(attempt, answers, count, players);
}

export async function buildCompletedDto(
  admin: Client,
  attempt: AttemptRow,
  settings: LongShotSettings,
  today: string,
  promptCount?: number,
): Promise<CompletedDto> {
  const dto = await buildAttemptDto(admin, attempt, promptCount);
  if (attempt.mode !== "hurry_up" || attempt.status !== "completed" || !attempt.completed_at) {
    return { kind: "completed", attempt: dto, rank: null, currentStreak: null, bestDayPoints: null };
  }
  const [excluded, statsRes] = await Promise.all([
    loadExclusionSet(admin, settings),
    admin
      .from("long_shot_user_stats")
      .select("current_streak, last_completed_date, best_day_points")
      .eq("user_id", attempt.user_id)
      .maybeSingle(),
  ]);
  const rank = await dailyRank(admin, attempt.game_date, attempt.total_points, attempt.completed_at, excluded);
  const stats = statsRes.data;
  return {
    kind: "completed",
    attempt: dto,
    rank,
    currentStreak: displayedStreak(stats ?? null, today),
    bestDayPoints: stats?.best_day_points ?? attempt.base_points,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Recompute base_points from the answer rows. Never an increment. */
async function recomputeBase(admin: Client, attemptId: string): Promise<number> {
  const answers = await loadAnswers(admin, attemptId);
  return sumPoints(answers);
}

/**
 * Advance the attempt past `position`, guarded on its old value so a
 * duplicate cannot move it twice. Returns false when the guard missed.
 */
async function advance(
  admin: Client,
  attempt: AttemptRow,
  position: number,
  opts: { requireActive: boolean },
): Promise<boolean> {
  const base = await recomputeBase(admin, attempt.id);
  let q = admin
    .from("long_shot_attempts")
    .update({ current_position: position + 1, base_points: base, total_points: base + attempt.bonus_points })
    .eq("id", attempt.id)
    .eq("current_position", position);
  if (opts.requireActive) q = q.eq("status", "active");
  const { data, error } = await q.select("id").maybeSingle();
  fail("attempt advance failed", error);
  return Boolean(data);
}

/**
 * Close the attempt when its last prompt is answered. Hurry-Up completions
 * also record stats. Returns the completed row or null.
 */
async function completeIfDone(admin: Client, attempt: AttemptRow, promptCount: number): Promise<AttemptRow | null> {
  const fresh = await reloadAttempt(admin, attempt.id);
  if (fresh.status !== "active" || fresh.current_position !== promptCount + 1) {
    return fresh.status === "completed" ? fresh : null;
  }
  const { data, error } = await admin.rpc("long_shot_complete_attempt", { p_attempt_id: attempt.id });
  fail("complete attempt failed", error);
  const done = ((data as AttemptRow[] | null) ?? [])[0] ?? (await reloadAttempt(admin, attempt.id));
  if (done.status === "completed" && done.mode === "hurry_up") {
    await recordCompletion(admin, done.user_id, done.id);
  }
  return done.status === "completed" ? done : null;
}

/**
 * Record a pending prompt as timed out: the guarded answer update, the
 * attempt advance and the tally (null player, Hurry-Up only), exactly as a
 * submitted answer does. `closing` is the settle cron's path: the attempt is
 * already abandoned, so the advance is not guarded on status and nothing
 * completes.
 */
export async function recordTimeout(
  admin: Client,
  attempt: AttemptRow,
  row: AnswerRow,
  promptCount: number,
  opts: { closing?: boolean } = {},
): Promise<boolean> {
  const { data: settled, error } = await admin
    .from("long_shot_answers")
    .update({
      state: "timed_out",
      answered_at: new Date().toISOString(),
      player_id: null,
      correct: false,
      tier: null,
      points: 0,
    })
    .eq("id", row.id)
    .eq("state", "pending")
    .select("id")
    .maybeSingle();
  fail("timeout update failed", error);
  if (!settled) return false;
  await advance(admin, attempt, row.position, { requireActive: !opts.closing });
  if (attempt.mode === "hurry_up") {
    await incrementTally(admin, row.prompt_id, null);
  }
  if (!opts.closing && row.position === promptCount) {
    await completeIfDone(admin, attempt, promptCount);
  }
  return true;
}

function promptDto(attempt: AttemptRow, row: AnswerRow, prompt: PromptRow, promptCount: number, answers: AnswerSummaryDto[], now: Date): PromptDto {
  return {
    kind: "prompt",
    attemptId: attempt.id,
    position: row.position,
    promptCount,
    promptText: prompt.prompt_text,
    remainingMs:
      attempt.mode === "hurry_up" && attempt.timer_seconds ? remainingMs(row.served_at, attempt.timer_seconds * 1000, now) : null,
    timerSeconds: attempt.mode === "hurry_up" ? attempt.timer_seconds : null,
    mode: attempt.mode,
    gameDate: attempt.game_date,
    basePoints: attempt.base_points,
    answers,
  };
}

/**
 * Serve the prompt at current_position (plan 8.2 and 17.3), repairing an
 * attempt left one behind, timing out an expired pending prompt, and
 * completing an attempt that has passed its last prompt.
 */
export async function serveNext(
  admin: Client,
  attemptArg: AttemptRow,
  settings: LongShotSettings,
  today: string,
  now: Date = new Date(),
): Promise<PromptDto | CompletedDto> {
  let attempt = attemptArg;
  const promptCount = await loadPromptCount(admin, attempt.puzzle_id);
  // Bounded: each pass either returns or moves the attempt forward one prompt.
  for (let guard = 0; guard < 12; guard++) {
    if (attempt.status === "completed") return buildCompletedDto(admin, attempt, settings, today, promptCount);
    if (attempt.status !== "active") throw new LongShotError("attempt_closed");

    if (attempt.current_position > promptCount) {
      const done = await completeIfDone(admin, attempt, promptCount);
      if (!done) throw new LongShotError("attempt_closed");
      return buildCompletedDto(admin, done, settings, today, promptCount);
    }

    const answers = await loadAnswers(admin, attempt.id);
    const current = answers.find((a) => a.position === attempt.current_position);

    if (current && current.state !== "pending") {
      // Repair: the answer was recorded but the attempt never advanced.
      await advance(admin, attempt, current.position, { requireActive: true });
      attempt = await reloadAttempt(admin, attempt.id);
      continue;
    }

    if (current && current.state === "pending") {
      const limitMs = (attempt.timer_seconds ?? 0) * 1000;
      if (
        attempt.mode === "hurry_up" &&
        attempt.timer_seconds &&
        isExpired(current.served_at, limitMs, settings.timer.grace_seconds * 1000, now)
      ) {
        await recordTimeout(admin, attempt, current, promptCount);
        attempt = await reloadAttempt(admin, attempt.id);
        continue;
      }
      const [prompt, players] = await Promise.all([
        loadPromptById(admin, current.prompt_id),
        loadPlayerInfo(admin, answers.map((a) => a.player_id).filter((x): x is string => Boolean(x))),
      ]);
      const done = answers.filter((a) => a.state !== "pending").map((a) => toAnswerSummary(a, players));
      return promptDto(attempt, current, prompt, promptCount, done, now);
    }

    // No row yet: serve this position, starting its clock now.
    const prompt = await loadPrompt(admin, attempt.puzzle_id, attempt.current_position);
    const { data: inserted, error } = await admin
      .from("long_shot_answers")
      .insert({
        attempt_id: attempt.id,
        prompt_id: prompt.id,
        position: attempt.current_position,
        state: "pending",
        served_at: now.toISOString(),
      })
      .select(ANSWER_COLUMNS)
      .single();
    if (error && error.code !== "23505") fail("serve insert failed", error);
    if (error) continue; // A concurrent serve created it; read theirs.
    const players = await loadPlayerInfo(
      admin,
      answers.map((a) => a.player_id).filter((x): x is string => Boolean(x)),
    );
    const done = answers.filter((a) => a.state !== "pending").map((a) => toAnswerSummary(a, players));
    return promptDto(attempt, inserted as AnswerRow, prompt, promptCount, done, now);
  }
  throw new Error("serveNext did not settle");
}

export type StartResult = PromptDto | CompletedDto | { kind: "existing"; attempt: AttemptDto };

/** The game date Film Room plays: today once today's Hurry-Up is over, else the latest past puzzle. */
export async function pickFilmRoomDate(admin: Client, userId: string, today: string): Promise<string | null> {
  const { data: hu, error } = await admin
    .from("long_shot_attempts")
    .select("status")
    .eq("user_id", userId)
    .eq("game_date", today)
    .eq("mode", "hurry_up")
    .maybeSingle();
  fail("hurry-up read failed", error);
  if (hu && (hu.status === "completed" || hu.status === "abandoned")) return today;
  const { data: past, error: pastErr } = await admin
    .from("long_shot_puzzles")
    .select("game_date")
    .lt("game_date", today)
    // Settled days only: an unsettled past day can still have a Hurry-Up open
    // past midnight, and Film Room's room figures would show that player the
    // most given answers from a second account.
    .not("settled_at", "is", null)
    .order("game_date", { ascending: false })
    .limit(1);
  fail("past puzzle read failed", pastErr);
  return past?.[0]?.game_date ?? null;
}

export async function startAttempt(
  admin: Client,
  userId: string,
  mode: Mode,
  settings: LongShotSettings,
  today: string,
  now: Date = new Date(),
): Promise<StartResult> {
  if (await findActiveAttempt(admin, userId)) throw new LongShotError("attempt_active");

  let gameDate = today;
  let puzzleId: string;
  if (mode === "hurry_up") {
    const puzzle = await ensurePuzzle(admin, today);
    if (!puzzle) throw new LongShotError("puzzle_unavailable");
    puzzleId = puzzle.id;
  } else {
    if (!settings.film_room_enabled) throw new LongShotError("film_room_disabled");
    const date = await pickFilmRoomDate(admin, userId, today);
    if (!date) throw new LongShotError("no_puzzle");
    const { data: p, error } = await admin.from("long_shot_puzzles").select("id").eq("game_date", date).maybeSingle();
    fail("film room puzzle read failed", error);
    if (!p) throw new LongShotError("no_puzzle");
    gameDate = date;
    puzzleId = p.id;
  }

  const { data: created, error } = await admin
    .from("long_shot_attempts")
    .insert({
      user_id: userId,
      puzzle_id: puzzleId,
      game_date: gameDate,
      mode,
      timer_seconds: mode === "hurry_up" ? settings.timer.seconds : null,
    })
    .select(ATTEMPT_COLUMNS)
    .single();
  if (error) {
    // The one-active index (migration 0369) answers 23505 when a second start
    // raced the check above; that is attempt_active, not a finished day.
    if (error.code === "23505" && (await findActiveAttempt(admin, userId))) throw new LongShotError("attempt_active");
    if (error.code === "23505" && mode === "hurry_up") {
      // Today's Hurry-Up already exists: hand back that attempt, no error.
      const { data: existing, error: exErr } = await admin
        .from("long_shot_attempts")
        .select(ATTEMPT_COLUMNS)
        .eq("user_id", userId)
        .eq("game_date", today)
        .eq("mode", "hurry_up")
        .single();
      fail("existing hurry-up read failed", exErr);
      const row = existing as AttemptRow;
      if (row.status === "active") return serveNext(admin, row, settings, today, now);
      if (row.status === "completed") return buildCompletedDto(admin, row, settings, today);
      return { kind: "existing", attempt: await buildAttemptDto(admin, row) };
    }
    fail("attempt insert failed", error);
  }
  return serveNext(admin, created as AttemptRow, settings, today, now);
}

export async function endFilmRoomAttempt(admin: Client, attempt: AttemptRow): Promise<void> {
  if (attempt.mode !== "film_room") throw new LongShotError("not_film_room");
  const { error } = await admin
    .from("long_shot_attempts")
    .update({ status: "abandoned" })
    .eq("id", attempt.id)
    .eq("status", "active");
  fail("end practice failed", error);
}

export interface AnswerBody {
  position: number;
  playerId: string | null;
  timedOut: boolean;
  skipped: boolean;
}

/**
 * Submit an answer (plan 17.4). `claim` is the route's rate claim, run after
 * the cheap checks so a stale request never spends the budget.
 */
export async function submitAnswer(
  admin: Client,
  attempt: AttemptRow,
  body: AnswerBody,
  settings: LongShotSettings,
  today: string,
  claim: () => Promise<boolean>,
  now: Date = new Date(),
): Promise<ResultDto> {
  if (attempt.status !== "active") throw new LongShotError("attempt_closed");
  if (body.position !== attempt.current_position) throw new LongShotError("stale_prompt");
  const answers = await loadAnswers(admin, attempt.id);
  const row = answers.find((a) => a.position === body.position);
  if (!row || row.state !== "pending") throw new LongShotError("stale_prompt");
  if (body.skipped && attempt.mode !== "film_room") throw new LongShotError("invalid_request");
  if (!body.skipped && !body.timedOut && !body.playerId) throw new LongShotError("invalid_request");
  if (!(await claim())) throw new LongShotError("rate_limited");

  const promptCount = await loadPromptCount(admin, attempt.puzzle_id);
  const prompt = await loadPromptById(admin, row.prompt_id);

  const expired =
    attempt.mode === "hurry_up" &&
    Boolean(attempt.timer_seconds) &&
    isExpired(row.served_at, (attempt.timer_seconds ?? 0) * 1000, settings.timer.grace_seconds * 1000, now);

  let state: Exclude<AnswerState, "pending">;
  let playerId: string | null = null;
  let scored = { correct: false, tier: null as Tier | null, points: 0 };
  if (expired || body.timedOut) {
    state = "timed_out";
  } else if (body.skipped) {
    state = "skipped";
  } else {
    state = "answered";
    playerId = body.playerId;
    scored = scoreAnswer(prompt.answers, playerId, settings.tiers.points);
  }

  const { data: settled, error } = await admin
    .from("long_shot_answers")
    .update({
      state,
      answered_at: now.toISOString(),
      player_id: playerId,
      correct: scored.correct,
      tier: scored.tier,
      points: scored.points,
    })
    .eq("id", row.id)
    .eq("state", "pending")
    .select("id")
    .maybeSingle();
  fail("answer update failed", error);
  if (!settled) throw new LongShotError("stale_prompt");

  await advance(admin, attempt, row.position, { requireActive: true });
  if (attempt.mode === "hurry_up") {
    await incrementTally(admin, row.prompt_id, playerId);
  }

  let completed: AttemptRow | null = null;
  if (row.position === promptCount) completed = await completeIfDone(admin, attempt, promptCount);

  const [room, players, teams] = await Promise.all([
    loadRoom(admin, row.prompt_id, playerId, prompt.answers),
    playerId ? loadPlayerInfo(admin, [playerId]) : Promise.resolve(new Map<string, PlayerInfo>()),
    playerId ? loadTeamColors(admin) : Promise.resolve([]),
  ]);
  const info = playerId ? players.get(playerId) : undefined;
  const fresh = await reloadAttempt(admin, attempt.id);

  return {
    position: row.position,
    state,
    tier: scored.tier,
    points: scored.points,
    correct: scored.correct,
    playerName: info?.name ?? null,
    playerSlug: info?.slug ?? null,
    sleeperId: info?.sleeperId ?? null,
    teamCode: info?.teamCode ?? null,
    team: state === "answered" && scored.correct ? teamTonesFor(info?.teamCode ?? null, teams) : null,
    roomCount: room.roomCount,
    roomTotal: room.roomTotal,
    mostGiven: room.mostGiven,
    basePoints: fresh.base_points,
    next: completed
      ? await buildCompletedDto(admin, completed, settings, today, promptCount)
      : { kind: "next", position: row.position + 1, promptCount },
  };
}

/** Yesterday as a game date, for callers that only hold today. */
export function yesterdayOf(today: string): string {
  return addDays(today, -1);
}
