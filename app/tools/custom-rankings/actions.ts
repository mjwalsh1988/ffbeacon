"use server";

/**
 * Beacon Ranker server actions (plan sections 5 and 8).
 *
 * Every action re-derives who is asking: the session for a signed-in reader,
 * the httpOnly guest cookie for everyone else. A request can name a board, but
 * ownership is re-checked (and RLS backs it up); it can never name a guest,
 * because a guest is only ever the caller's own cookie.
 *
 * VALIDATE, THEN METER, THEN WORK. A malformed request is refused before it
 * costs the caller a rate-limit slot, and a slot is claimed before anything
 * expensive (the seed read, a write).
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { boardTag } from "@/lib/signal-profile";
import { getActiveFormats } from "@/lib/source";
import { positionHeading } from "@/lib/site";
import {
  isBoardScope,
  isDefenderScope,
  isSinglePositionScope,
  MAX_BOARD_NAME_LENGTH,
  MAX_BOARD_PLAYERS,
  scopePositions,
  type BoardScope,
} from "@/lib/ranking-boards";
import {
  boardForFlush,
  foldRun,
  parseAnswer,
  parseAnswerLog,
  validateAnswer,
  type Answer,
} from "@/lib/ranking-boards/builder";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import { loadDefenderSeed, loadOffenseSeed } from "@/lib/ranking-boards/seed";
import { resolveBoardProvenance } from "@/lib/ranking-boards/provenance";
import {
  flushAccountBoard,
  loadAccountRun,
  loadGuestRun,
  parseStoredSetup,
  writeAccountAnswers,
  writeGuestAnswers,
  type AccountRun,
  type GuestRun,
  type RunMeta,
  type StoredSetup,
} from "@/lib/ranking-boards/run-store";
import {
  buildRunPayload,
  lastCompletedSeason,
  type RunPayload,
  type RunRef,
} from "@/lib/ranking-boards/run-payload";
import { clearGuestCookie, ensureGuestId, readGuestId } from "@/lib/ranking-boards/guest";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { headers } from "next/headers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fail = { ok: false; error: string };

export type StartRunInput = {
  /** "new" makes a board; "board" runs over an existing one. */
  mode: "new" | "board";
  boardId?: string;
  scope: string;
  includesDefenders?: boolean;
  formatSlug: string;
  sourceSlug?: string | null;
  depth?: number;
  /** For a run over an existing board: re-check from this rank (1 = the top). */
  startRank?: number;
  name?: string;
};

function defaultBoardName(scope: BoardScope, formatDisplay: string, includesDefenders: boolean): string {
  const what =
    scope === "overall"
      ? includesDefenders
        ? "rankings with IDP"
        : "rankings"
      : scope === "defense"
        ? "defender rankings"
        : `${positionHeading(scope, "singular").toLowerCase()} rankings`;
  return `My ${formatDisplay} ${what}`.slice(0, MAX_BOARD_NAME_LENGTH);
}

async function actorKeyFromHeaders(): Promise<string | null> {
  try {
    return await resolveRateLimitActorKey(
      new Request("https://ffbeacon.internal/ranker", { headers: await headers() }),
    );
  } catch {
    return null;
  }
}

/**
 * Start a run. For a signed-in reader "new" creates a board first; "board"
 * runs over one of their boards. For a guest it (re)starts their one guest
 * board, which a guest is told replaces the board they had.
 */
export async function startRunAction(input: StartRunInput): Promise<{ ok: true; payload: RunPayload } | Fail> {
  // ---- Validate the request's shape before anything else.
  if (!input || typeof input !== "object") return { ok: false, error: "Could not read that." };
  const scopeRaw = String(input.scope ?? "");
  if (!isBoardScope(scopeRaw)) return { ok: false, error: "Pick which players to rank." };
  const scope: BoardScope = scopeRaw;
  const includesDefenders = scope === "overall" && input.includesDefenders === true;
  if (input.mode !== "new" && input.mode !== "board") return { ok: false, error: "Could not read that." };
  if (input.mode === "board" && (typeof input.boardId !== "string" || !UUID_RE.test(input.boardId))) {
    return { ok: false, error: "Could not find that board." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const settings = await loadRankingBuilderSettings(admin);

  if (!user && input.mode === "board") {
    return { ok: false, error: "Sign in to build on a saved board." };
  }

  const provenance = await resolveBoardProvenance(supabase, input.formatSlug, null);
  if (!provenance) return { ok: false, error: "Pick a format." };

  // Existing board: ownership first (RLS scopes the read to the owner).
  let initialBoard: string[] = [];
  let initialBreaks: number[] = [];
  let boardName = "";
  let formatSlug = provenance.format.slug;
  let startRank = 1;
  if (input.mode === "board" && user) {
    const { data: board } = await supabase
      .from("user_ranking_boards")
      .select("id, user_id, name, scope, includes_defenders, format_config_id, tier_breaks")
      .eq("id", input.boardId!)
      .maybeSingle();
    if (!board || board.user_id !== user.id) return { ok: false, error: "Could not find that board." };
    if (board.scope !== scope || board.includes_defenders !== includesDefenders) {
      return { ok: false, error: "That board ranks a different set of players." };
    }
    // A board that already means a format keeps it (decision 5).
    if (board.format_config_id) {
      const formats = await getActiveFormats(supabase);
      const own = formats.find((f) => f.id === board.format_config_id);
      if (own) formatSlug = own.slug;
    }
    const rows: { player_id: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("user_ranking_board_players")
        .select("player_id")
        .eq("board_id", board.id)
        .order("rank_position", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) return { ok: false, error: "Could not read that board." };
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    initialBoard = rows.map((r) => r.player_id);
    initialBreaks = board.tier_breaks ?? [];
    boardName = board.name;
    const requested = Number.isInteger(input.startRank) ? (input.startRank as number) : 1;
    startRank = Math.min(Math.max(1, requested), Math.max(1, initialBoard.length));
  }

  const single = isSinglePositionScope(scope);
  const cap = user ? null : single ? settings.guests.capSingle : settings.guests.capMulti;
  const defaultDepth = single ? settings.builder.defaultDepthSingle : settings.builder.defaultDepthMulti;
  const requestedDepth = Number.isInteger(input.depth) ? (input.depth as number) : defaultDepth;
  const depth = cap !== null
    ? cap
    : Math.min(Math.max(1, requestedDepth), settings.builder.maxDepth, MAX_BOARD_PLAYERS);

  // ---- Meter before the seed read.
  const allowed = await claimRateLimitSlot({
    bucket: "ranker-seed",
    max: settings.limits.seedLoadsPerHour,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return { ok: false, error: "You have started a lot of runs in the last hour. Try again shortly." };
  }

  // ---- Seeds.
  const positions = scopePositions(scope, includesDefenders);
  let seed: string[] = [];
  let secondPass: string[] = [];
  let sourceSlug: string | null = null;
  let sourceDisplay: string | null = null;
  let seedNote = "";
  let defenderNote: string | null = null;

  if (isDefenderScope(scope)) {
    const d = await loadDefenderSeed(positions);
    seed = d.players.map((p) => p.playerId);
    defenderNote = d.basisText;
    seedNote = d.basisText;
  } else {
    const offense = await loadOffenseSeed(supabase, {
      formatSlug,
      sourceSlug: typeof input.sourceSlug === "string" ? input.sourceSlug : null,
      positions,
    });
    if (!offense || offense.players.length === 0) {
      if (initialBoard.length === 0) {
        return { ok: false, error: "No rankings to start from for that format and source." };
      }
    }
    seed = offense?.players.map((p) => p.playerId) ?? [];
    sourceSlug = offense?.sourceSlug ?? null;
    sourceDisplay = offense?.sourceDisplay ?? null;
    seedNote = offense?.sourceDisplay
      ? `Starting from ${offense.sourceDisplay}, ${offense.formatDisplay}.${
          offense.fellBack && offense.requestedDisplay
            ? ` ${offense.requestedDisplay} has no rankings for ${offense.formatDisplay}, so this uses ${offense.sourceDisplay}.`
            : ""
        }`
      : `Starting from your board as it stands, ${offense?.formatDisplay ?? ""}.`;
    if (includesDefenders) {
      const d = await loadDefenderSeed(positions.filter((p) => ["DL", "LB", "DB"].includes(p)));
      secondPass = d.players.slice(0, settings.builder.defenderSecondPass).map((p) => p.playerId);
      defenderNote = `After the offensive players, ${secondPass.length} defenders join at the bottom and climb. ${d.basisText}`;
    }
  }
  if (seed.length === 0 && secondPass.length === 0 && initialBoard.length === 0) {
    return { ok: false, error: "There is no one to rank for that choice yet." };
  }

  const formats = await getActiveFormats(supabase);
  const format = formats.find((f) => f.slug === formatSlug) ?? provenance.format;
  const meta: RunMeta = {
    scope,
    includesDefenders,
    formatSlug: format.slug,
    formatDisplay: format.display_name,
    scoringType: format.scoring_type,
    sourceSlug,
    sourceDisplay,
    seedNote,
    defenderNote,
    lastCompletedSeason: await lastCompletedSeason(admin),
    boardName:
      boardName ||
      (typeof input.name === "string" && input.name.trim()
        ? input.name.trim().slice(0, MAX_BOARD_NAME_LENGTH)
        : defaultBoardName(scope, format.display_name, includesDefenders)),
    tiersAllowed: Boolean(user),
  };
  const setup: StoredSetup = {
    seed,
    secondPass,
    initialBoard,
    startRank,
    depth: input.mode === "board" ? Math.max(depth, initialBoard.length) : depth,
    winsBeforePrompt: settings.builder.winsBeforePrompt,
    cap,
    initialBreaks,
    meta,
  };

  // ---- Persist.
  if (user) {
    let boardId = input.boardId ?? null;
    if (input.mode === "new") {
      const { data: created, error } = await supabase
        .from("user_ranking_boards")
        .insert({
          user_id: user.id,
          name: meta.boardName,
          scope,
          includes_defenders: includesDefenders,
          format_config_id: format.id,
          seed_source_slug: sourceSlug,
        })
        .select("id")
        .single();
      if (error || !created) return { ok: false, error: "Could not create the board." };
      boardId = created.id;
    } else if (boardId) {
      // Record the format a board built before boards remembered one now means.
      await supabase
        .from("user_ranking_boards")
        .update({ format_config_id: format.id, ...(sourceSlug ? { seed_source_slug: sourceSlug } : {}) })
        .eq("id", boardId)
        .is("format_config_id", null);
    }
    const { error: runError } = await admin.from("ranking_builder_runs").upsert(
      {
        user_id: user.id,
        board_id: boardId!,
        setup: setup as unknown as never,
        answers: [] as unknown as never,
        answer_count: 0,
        checkpoint_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "board_id" },
    );
    if (runError) return { ok: false, error: "Could not start the run." };
    const run = await loadAccountRun(supabase, boardId!);
    if (!run) return { ok: false, error: "Could not start the run." };
    // An empty board becomes its first seed player straight away; write that.
    await checkpoint(supabase, run, run.answers, true);
    revalidatePath("/my-beacon/rankings");
    return { ok: true, payload: await buildRunPayload(run, settings) };
  }

  const guestId = await ensureGuestId();
  const actorKey = await actorKeyFromHeaders();
  const initial = foldRun(setup, []).state;
  const { error: guestError } = await admin.from("ranking_guest_boards").upsert(
    {
      guest_id: guestId,
      actor_key: actorKey,
      name: meta.boardName,
      scope,
      includes_defenders: includesDefenders,
      format_config_id: format.id,
      seed_source_slug: sourceSlug,
      player_ids: boardForFlush(initial),
      left_off_player_ids: [],
      run_setup: setup as unknown as never,
      run_answers: [] as unknown as never,
      answer_count: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "guest_id" },
  );
  if (guestError) return { ok: false, error: "Could not start the run." };
  const run = await loadGuestRun(admin, guestId);
  if (!run) return { ok: false, error: "Could not start the run." };
  return { ok: true, payload: await buildRunPayload(run, settings) };
}

/** Load the caller's run for a ref, re-deriving identity. */
async function loadRunFor(ref: RunRef): Promise<
  | { ok: true; run: AccountRun; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: true; run: GuestRun; supabase: ReturnType<typeof createAdminClient> }
  | Fail
> {
  if (!ref || typeof ref !== "object") return { ok: false, error: "Could not read that." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (ref.kind === "board") {
    if (!user) return { ok: false, error: "Sign in again to keep building." };
    if (typeof ref.boardId !== "string" || !UUID_RE.test(ref.boardId)) {
      return { ok: false, error: "Could not find that run." };
    }
    const run = await loadAccountRun(supabase, ref.boardId);
    if (!run) return { ok: false, error: "Could not find that run." };
    return { ok: true, run, supabase };
  }
  if (ref.kind === "guest") {
    const guestId = await readGuestId();
    if (!guestId) return { ok: false, error: "Your guest board has expired. Start a new one." };
    const admin = createAdminClient();
    const run = await loadGuestRun(admin, guestId);
    if (!run) return { ok: false, error: "Your guest board has expired. Start a new one." };
    return { ok: true, run, supabase: admin };
  }
  return { ok: false, error: "Could not read that." };
}

/** Write the board rows when the checkpoint rule says so (account runs). */
async function checkpoint(
  supabase: Awaited<ReturnType<typeof createClient>>,
  run: AccountRun,
  answers: Answer[],
  force: boolean,
  known?: Awaited<ReturnType<typeof loadRankingBuilderSettings>>,
): Promise<void> {
  const settings = known ?? (await loadRankingBuilderSettings(createAdminClient()));
  const state = foldRun(run.setup, answers).state;
  const due =
    force ||
    answers.length - run.checkpointCount >= settings.builder.checkpointEvery ||
    state.phase === "done" ||
    state.phase === "finished";
  if (!due) return;
  const ok = await flushAccountBoard(supabase, run.boardId, boardForFlush(state), state, {
    tierBreaks: null,
  });
  if (ok) {
    await createAdminClient()
      .from("ranking_builder_runs")
      .update({ checkpoint_count: answers.length })
      .eq("id", run.runId);
    revalidateTag(boardTag(run.boardId));
  }
}

export type AnswerResult =
  | { ok: true; count: number }
  | { ok: false; error: string; answers?: Answer[] };

/**
 * Append one answer. Checked against the server's own fold of the log: the
 * pair the reader saw must be the pair the log says is open, a rank must be
 * above the player's current spot, and a guest cannot extend past the cap
 * (the cap is in the server-written setup). On any refusal the current log is
 * returned so the page can resync instead of drifting.
 */
export async function answerAction(input: {
  ref: RunRef;
  expected: number;
  answer: unknown;
  pair: [string, string | null] | null;
}): Promise<AnswerResult> {
  const answer = parseAnswer(input?.answer);
  if (!answer || !Number.isInteger(input?.expected)) return { ok: false, error: "Could not read that answer." };
  const pair =
    Array.isArray(input.pair) &&
    typeof input.pair[0] === "string" &&
    (input.pair[1] === null || typeof input.pair[1] === "string")
      ? ([input.pair[0], input.pair[1]] as [string, string | null])
      : null;

  const loaded = await loadRunFor(input.ref);
  if (!loaded.ok) return loaded;
  const { run } = loaded;
  if (run.count !== input.expected) {
    return { ok: false, error: "That question has already been answered.", answers: run.answers };
  }

  const settings = await loadRankingBuilderSettings(createAdminClient());
  const allowed = await claimRateLimitSlot({
    bucket: "ranker-answer",
    max: settings.limits.answersPerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return { ok: false, error: "That was fast. Wait a moment and answer again.", answers: run.answers };

  const verdict = validateAnswer(run.setup, run.answers, answer, pair);
  if (!verdict.ok) return { ok: false, error: verdict.reason, answers: run.answers };
  const next = [...run.answers, answer];

  if (run.kind === "board") {
    const supabase = loaded.supabase as Awaited<ReturnType<typeof createClient>>;
    const written = await writeAccountAnswers(createAdminClient(), run, next, run.count);
    if (!written) {
      const fresh = await loadAccountRun(supabase, run.boardId);
      return { ok: false, error: "That question has already been answered.", answers: fresh?.answers };
    }
    await checkpoint(supabase, run, next, false, settings);
    return { ok: true, count: next.length };
  }

  const state = verdict.state;
  const written = await writeGuestAnswers(
    loaded.supabase as ReturnType<typeof createAdminClient>,
    run,
    next,
    run.count,
    boardForFlush(state),
    state.leftOff,
  );
  if (!written) {
    const fresh = await loadGuestRun(createAdminClient(), run.guestId);
    return { ok: false, error: "That question has already been answered.", answers: fresh?.answers };
  }
  return { ok: true, count: next.length };
}

/** Undo pops the last answer. */
export async function undoAction(input: { ref: RunRef; expected: number }): Promise<AnswerResult> {
  if (!Number.isInteger(input?.expected)) return { ok: false, error: "Could not read that." };
  const loaded = await loadRunFor(input.ref);
  if (!loaded.ok) return loaded;
  const { run } = loaded;
  if (run.count !== input.expected || run.answers.length === 0) {
    return { ok: false, error: "Nothing to undo.", answers: run.answers };
  }
  const settings = await loadRankingBuilderSettings(createAdminClient());
  const allowed = await claimRateLimitSlot({
    bucket: "ranker-answer",
    max: settings.limits.answersPerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return { ok: false, error: "That was fast. Wait a moment and try again.", answers: run.answers };
  const next = run.answers.slice(0, -1);
  if (run.kind === "board") {
    const supabase = loaded.supabase as Awaited<ReturnType<typeof createClient>>;
    const written = await writeAccountAnswers(
      createAdminClient(),
      run,
      next,
      run.count,
      Math.min(run.checkpointCount, next.length),
    );
    if (!written) return { ok: false, error: "Could not undo. Try again." };
    if (next.length < run.checkpointCount) {
      await checkpoint(supabase, { ...run, checkpointCount: next.length }, next, true, settings);
    }
    return { ok: true, count: next.length };
  }
  const state = foldRun(run.setup, next).state;
  const written = await writeGuestAnswers(
    loaded.supabase as ReturnType<typeof createAdminClient>,
    run,
    next,
    run.count,
    boardForFlush(state),
    state.leftOff,
  );
  if (!written) return { ok: false, error: "Could not undo. Try again." };
  return { ok: true, count: next.length };
}

/** Save and stop: write the board as it stands. The run stays, so the reader
 * can pick up at the next question later. */
export async function stopAction(ref: RunRef): Promise<{ ok: true; boardId: string | null } | Fail> {
  const loaded = await loadRunFor(ref);
  if (!loaded.ok) return loaded;
  const { run } = loaded;
  if (run.kind === "guest") return { ok: true, boardId: null };
  const supabase = loaded.supabase as Awaited<ReturnType<typeof createClient>>;
  await checkpoint(supabase, run, run.answers, true);
  revalidatePath("/my-beacon/rankings");
  return { ok: true, boardId: run.boardId };
}

/**
 * Finish: write the board, the tier lines the tier pass drew, and close the
 * run. A guest's board is already written; a guest run is closed by claiming
 * it or by the cleanup job.
 */
export async function finishAction(ref: RunRef): Promise<{ ok: true; boardId: string | null } | Fail> {
  const loaded = await loadRunFor(ref);
  if (!loaded.ok) return loaded;
  const { run } = loaded;
  if (run.kind === "guest") return { ok: true, boardId: null };
  const supabase = loaded.supabase as Awaited<ReturnType<typeof createClient>>;
  const state = foldRun(run.setup, run.answers).state;
  if (state.phase !== "done" && state.phase !== "finished") {
    return { ok: false, error: "The run is not finished yet." };
  }
  const drew = state.tierPass.breaks.length > 0 || state.phase === "finished";
  const ok = await flushAccountBoard(supabase, run.boardId, boardForFlush(state), state, {
    tierBreaks: drew ? state.tierPass.breaks : null,
  });
  if (!ok) return { ok: false, error: "Could not save the board. Try again." };
  await supabase.from("ranking_builder_runs").delete().eq("id", run.runId);
  revalidateTag(boardTag(run.boardId));
  revalidatePath("/my-beacon/rankings");
  return { ok: true, boardId: run.boardId };
}

/** Start over: drop the run (and, for a guest, the guest board with it). An
 * account board keeps whatever the last checkpoint wrote. */
export async function discardRunAction(ref: RunRef): Promise<{ ok: true } | Fail> {
  const loaded = await loadRunFor(ref);
  if (!loaded.ok) return loaded;
  const { run } = loaded;
  if (run.kind === "board") {
    const supabase = loaded.supabase as Awaited<ReturnType<typeof createClient>>;
    await checkpoint(supabase, run, run.answers, true);
    await supabase.from("ranking_builder_runs").delete().eq("id", run.runId);
    return { ok: true };
  }
  await (loaded.supabase as ReturnType<typeof createAdminClient>)
    .from("ranking_guest_boards")
    .delete()
    .eq("id", run.guestBoardId);
  return { ok: true };
}

/**
 * Carry a guest board into the signed-in account (plan section 8): one step,
 * after sign-in, triggered by the tool page seeing ?claim=1. The guest row
 * becomes a normal board (and, if the run was unfinished, a normal run with
 * the guest cap lifted and tiers allowed), then the guest row and cookie go.
 *
 * A cookie with no guest board behind it (already claimed, or expired) is a
 * no-op, never an error.
 */
export async function claimGuestBoardAction(): Promise<
  { ok: true; boardId: string | null } | Fail
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const guestId = await readGuestId();
  if (!guestId) return { ok: true, boardId: null };

  const admin = createAdminClient();
  const { data: guest } = await admin
    .from("ranking_guest_boards")
    .select(
      "id, name, scope, includes_defenders, format_config_id, seed_source_slug, player_ids, left_off_player_ids, run_setup, run_answers, answer_count",
    )
    .eq("guest_id", guestId)
    .maybeSingle();
  if (!guest) {
    await clearGuestCookie();
    return { ok: true, boardId: null };
  }
  // Take the guest row BEFORE copying it: of two tabs landing on ?claim=1 at
  // once, only the one whose delete returned the row goes on to copy it.
  const { data: taken } = await admin
    .from("ranking_guest_boards")
    .delete()
    .eq("id", guest.id)
    .select("id");
  if ((taken?.length ?? 0) !== 1) {
    await clearGuestCookie();
    return { ok: true, boardId: null };
  }

  const { data: created, error } = await supabase
    .from("user_ranking_boards")
    .insert({
      user_id: user.id,
      name: guest.name,
      scope: guest.scope,
      includes_defenders: guest.includes_defenders,
      format_config_id: guest.format_config_id,
      seed_source_slug: guest.seed_source_slug,
      left_off_player_ids: guest.left_off_player_ids ?? [],
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: "Could not save your board. Try again." };

  const order = (guest.player_ids ?? []).slice(0, MAX_BOARD_PLAYERS);
  if (order.length > 0) {
    const nowIso = new Date().toISOString();
    const { error: rowsError } = await supabase.from("user_ranking_board_players").insert(
      order.map((playerId, index) => ({
        board_id: created.id,
        player_id: playerId,
        rank_position: index + 1,
        updated_at: nowIso,
      })),
    );
    if (rowsError) {
      await supabase.from("user_ranking_boards").delete().eq("id", created.id);
      return { ok: false, error: "Could not save your board. Try again." };
    }
  }

  // An unfinished run comes along, so the reader continues where they stopped,
  // now without the guest cap and with tiers.
  const setup = parseStoredSetup(guest.run_setup);
  if (setup) {
    const answers = parseAnswerLog(guest.run_answers).slice(0, guest.answer_count);
    const state = foldRun(setup, answers).state;
    if (state.phase !== "finished") {
      const accountSetup: StoredSetup = {
        ...setup,
        cap: null,
        meta: { ...setup.meta, tiersAllowed: true },
      };
      await admin.from("ranking_builder_runs").insert({
        user_id: user.id,
        board_id: created.id,
        setup: accountSetup as unknown as never,
        answers: answers as unknown as never,
        answer_count: answers.length,
        checkpoint_count: answers.length,
      });
    }
  }

  await clearGuestCookie();
  revalidatePath("/my-beacon/rankings");
  return { ok: true, boardId: created.id };
}
