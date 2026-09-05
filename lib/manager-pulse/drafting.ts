/**
 * Manager Pulse, section 6.3: draft habits.
 *
 * Pure. Takes the flat `ManagerPulseInput` and returns `ManagerDrafting`. No
 * Supabase, no fetch, no React, no `Date.now()` (every timestamp arrives as a
 * plain epoch ms field on the input, already resolved by load.ts).
 *
 * KEEPERS ARE EXCLUDED FROM EVERY FIGURE EXCEPT THE KEEPER FIGURE ITSELF
 *   A keeper is carried at a slot the league's rules set, not chosen off the
 *   board, so grading it as a draft decision measures the rules rather than
 *   the manager. This is the same exclusion the Manager Ledger's draft ledger
 *   makes (lib/manager-ledger/moves.ts roundBaselines / buildDraftLedger).
 *   Reach index, positional shape, rookie/veteran lean and the draft grade all
 *   drop `isKeeper` picks before doing anything else. Keeper usage itself is
 *   the one figure that is ABOUT keepers, so it is the one figure that counts
 *   them.
 *
 * DRAFT PACE IS A FACT ABOUT THE ROOM, NEVER ABOUT THE MANAGER
 *   `draftPace` on the returned `ManagerDrafting` is computed from the whole
 *   draft's start and end time and its pick count. It describes the room this
 *   manager happened to sit in, not a personal trait. Nothing downstream may
 *   present it as a personal stat, rank it against other managers, or feed it
 *   into Trade Ideas. See docs/manager-pulse-plan.md section 2.3A.
 *
 * PER-PICK CLOCK IS THE ONE REAL PERSONAL TIMING FIGURE, AND IT STARTS EMPTY
 *   Sleeper publishes no per-pick timestamp anywhere (verified in both the
 *   REST and the GraphQL surface, section 2.3). `perPickClock` is built from
 *   `draft_pick_observations`, a live-capture table that only has rows for
 *   drafts On The Clock has actually watched. A manager with no rows here
 *   simply has a null `perPickClock`, and the card that renders it says so
 *   plainly rather than showing an empty chart.
 */

import type {
  AutopickFact,
  DraftClockFact,
  DraftPaceFact,
  DraftPositionShape,
  ManagerDrafting,
  PoolableStat,
  TradePosition,
} from "./types";
import { lensForCategory } from "./types";
import type {
  ManagerDraftFacts,
  ManagerDraftPick,
  ManagerPickObservation,
  ManagerPlayerFacts,
  ManagerPulseInput,
} from "./input-types";

/** The three lens buckets every `PoolableStat` field is computed across. */
type Lens = "all" | "dynasty" | "redraft";
const LENSES: readonly Lens[] = ["all", "dynasty", "redraft"];

/** A dropped pick with a stated reason none of these arithmetic helpers throws on. */
function inLens(category: ManagerDraftPick["category"], lens: Lens): boolean {
  return lens === "all" || lensForCategory(category) === lens;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * The middle value of a sorted-ascending list, or the mean of the two middle
 * values on an even count. Used for the per-pick clock deliberately instead of
 * a mean: one manager who stepped away for a sandwich should not move the
 * figure for everyone else's picks.
 */
function median(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedAscending[mid];
  return (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

function poolable<T>(byLens: Record<Lens, T | null>): PoolableStat<T> {
  return { all: byLens.all, dynasty: byLens.dynasty, redraft: byLens.redraft };
}

/* -------------------------------------------------------------------------- */
/* Reach index                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `(marketAdp - pickNo) / teams`, in rounds. Positive means the manager took
 * the player earlier than the market would have. A pick with no `marketAdp`,
 * or whose draft carries no team count, is excluded rather than treated as an
 * on-market (zero) pick: we simply do not know where the market had him.
 *
 * Gated on `minDraftsForReach` DISTINCT DRAFTS among the picks that actually
 * clear the marketAdp/teams filter, because two reach picks in the same draft
 * describe one room's board, not a habit. `sampleSize` still reports the
 * number of usable PICKS regardless of the gate, so an admin can see how close
 * a manager is to clearing the floor rather than only seeing null.
 *
 * A second gate applies after the mean is computed: a reach index whose
 * absolute value sits below `reachRoundsThreshold` is not a pattern worth
 * reporting. Half a round early is noise, and reporting it as a habit would
 * give every manager a "drafts early" or "drafts late" label whether or not
 * the difference means anything. `sampleSize` is unaffected by this gate for
 * the same reason it is unaffected by the drafts-count gate above.
 */
function reachIndexForLens(
  picks: ManagerDraftPick[],
  draftsById: Map<string, ManagerDraftFacts>,
  lens: Lens,
  minDraftsForReach: number,
  reachRoundsThreshold: number,
): { value: number | null; sampleSize: number } {
  const ratios: number[] = [];
  const draftIds = new Set<string>();

  for (const pick of picks) {
    if (pick.isKeeper) continue;
    if (!inLens(pick.category, lens)) continue;
    if (pick.marketAdp == null) continue;
    const draft = draftsById.get(pick.sleeperDraftId);
    const teams = draft?.teams;
    if (teams == null || teams <= 0) continue;
    ratios.push((pick.marketAdp - pick.pickNo) / teams);
    draftIds.add(pick.sleeperDraftId);
  }

  const sampleSize = ratios.length;
  if (draftIds.size < minDraftsForReach || ratios.length === 0) {
    return { value: null, sampleSize };
  }
  const value = mean(ratios);
  if (Math.abs(value) < reachRoundsThreshold) {
    return { value: null, sampleSize };
  }
  return { value, sampleSize };
}

/* -------------------------------------------------------------------------- */
/* Positional shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Share of picks at `round <= earlyRoundCutoff` spent at each position. A pick
 * whose player we cannot resolve a position for is excluded from BOTH the
 * numerator and the denominator, so the remaining shares still sum to 1.
 */
function shapeForLens(
  picks: ManagerDraftPick[],
  players: Record<string, ManagerPlayerFacts>,
  earlyRoundCutoff: number,
  lens: Lens,
): { shape: DraftPositionShape; sampleSize: number } {
  const counts: Partial<Record<TradePosition, number>> = {};
  let total = 0;

  for (const pick of picks) {
    if (pick.isKeeper) continue;
    if (!inLens(pick.category, lens)) continue;
    if (pick.round == null || pick.round > earlyRoundCutoff) continue;
    const position = pick.playerId ? players[pick.playerId]?.position ?? null : null;
    if (position == null) continue;
    counts[position] = (counts[position] ?? 0) + 1;
    total += 1;
  }

  if (total === 0) return { shape: {}, sampleSize: 0 };
  const shape: DraftPositionShape = {};
  for (const position of Object.keys(counts) as TradePosition[]) {
    shape[position] = (counts[position] ?? 0) / total;
  }
  return { shape, sampleSize: total };
}

/* -------------------------------------------------------------------------- */
/* Rookie versus veteran lean (dynasty only)                                  */
/* -------------------------------------------------------------------------- */

/**
 * `(rookies - veterans) / total` over picks made in dynasty STARTUP drafts.
 * `isStartup === null` drafts are excluded entirely rather than guessed at: a
 * rookie draft is 100% rookies by definition, so folding an unknown-type
 * draft in would drag every dynasty manager toward the same number. Picks
 * with `wasRookie === null` are excluded the same way. Type-exclusive: a
 * redraft-only manager naturally has zero qualifying picks and gets null, not
 * zero.
 */
function rookieVeteranLean(
  picks: ManagerDraftPick[],
  draftsById: Map<string, ManagerDraftFacts>,
): { value: number | null; sampleSize: number } {
  let rookies = 0;
  let veterans = 0;

  for (const pick of picks) {
    if (pick.isKeeper) continue;
    if (lensForCategory(pick.category) !== "dynasty") continue;
    const draft = draftsById.get(pick.sleeperDraftId);
    if (draft?.isStartup !== true) continue;
    if (pick.wasRookie == null) continue;
    if (pick.wasRookie) rookies += 1;
    else veterans += 1;
  }

  const total = rookies + veterans;
  if (total === 0) return { value: null, sampleSize: 0 };
  return { value: (rookies - veterans) / total, sampleSize: total };
}

/* -------------------------------------------------------------------------- */
/* Keeper usage                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Keeper picks over total picks, over picks belonging to a (league, season)
 * that carries at least one keeper pick. This under-detects a league whose
 * keepers we did not capture (no isKeeper=true row ever reached us), which is
 * honest and one-directional: it can only make keeper usage look lower than
 * it is, never higher.
 */
function keeperUsage(picks: ManagerDraftPick[]): { value: number | null; sampleSize: number } {
  const leagueSeasonKey = (pick: ManagerDraftPick) => `${pick.sleeperLeagueId}|${pick.season}`;

  const keeperLeagueSeasons = new Set<string>();
  for (const pick of picks) {
    if (pick.isKeeper) keeperLeagueSeasons.add(leagueSeasonKey(pick));
  }
  if (keeperLeagueSeasons.size === 0) return { value: null, sampleSize: 0 };

  let keeperPicks = 0;
  let totalPicks = 0;
  for (const pick of picks) {
    if (!keeperLeagueSeasons.has(leagueSeasonKey(pick))) continue;
    totalPicks += 1;
    if (pick.isKeeper) keeperPicks += 1;
  }
  if (totalPicks === 0) return { value: null, sampleSize: 0 };
  return { value: keeperPicks / totalPicks, sampleSize: totalPicks };
}

/* -------------------------------------------------------------------------- */
/* Draft grade                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Mean of `pick.grade`, ignoring nulls. The grade itself comes from
 * lib/on-the-clock/draft-grade.ts and is never recomputed here; this is
 * aggregation only.
 */
function gradeForLens(
  picks: ManagerDraftPick[],
  lens: Lens,
): { value: number | null; sampleSize: number } {
  const grades: number[] = [];
  for (const pick of picks) {
    if (pick.isKeeper) continue;
    if (!inLens(pick.category, lens)) continue;
    if (pick.grade == null) continue;
    grades.push(pick.grade);
  }
  if (grades.length === 0) return { value: null, sampleSize: 0 };
  return { value: mean(grades), sampleSize: grades.length };
}

/* -------------------------------------------------------------------------- */
/* Draft pace: a fact about the room                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whole-draft pace, from `startedAtMs`, `lastPickedAtMs` and the pick count.
 * A draft missing either timestamp, or with fewer than two total picks, is
 * excluded: there is no honest "seconds per pick" for a draft with one pick
 * or an unknown start.
 *
 * THE MIDDLE DRAFT, NOT THE AVERAGE ONE, for the same reason the per-pick
 * clock below takes a median. A slow asynchronous rookie draft runs for days
 * with overnight pauses inside it, so its pace lands in the thousands of
 * seconds; one of those in a set of forty pulled the mean to "2007 seconds a
 * pick, 483% of the allowed clock" for a manager whose live drafts all ran
 * inside their timer. A median describes the drafts this manager actually
 * sits in; a mean describes the worst one.
 */
function computeDraftPace(drafts: ManagerDraftFacts[]): DraftPaceFact | null {
  const perDraftSeconds: number[] = [];
  const perDraftClockShare: number[] = [];

  for (const draft of drafts) {
    if (draft.startedAtMs == null || draft.lastPickedAtMs == null) continue;
    if (draft.totalPicks < 2) continue;
    const secondsPerPick =
      (draft.lastPickedAtMs - draft.startedAtMs) / 1000 / draft.totalPicks;
    perDraftSeconds.push(secondsPerPick);
    if (draft.pickTimerSeconds != null && draft.pickTimerSeconds > 0) {
      perDraftClockShare.push(secondsPerPick / draft.pickTimerSeconds);
    }
  }

  if (perDraftSeconds.length === 0) return null;

  return {
    secondsPerPick: median([...perDraftSeconds].sort((a, b) => a - b)),
    // Only drafts that published a pick_timer contribute a clock share. A
    // manager whose observed drafts never carried a timer gets 0 here rather
    // than a null the type does not offer; draftsObserved is what tells a
    // reader whether this number rests on anything.
    clockShareUsed:
      perDraftClockShare.length > 0
        ? median([...perDraftClockShare].sort((a, b) => a - b))
        : 0,
    draftsObserved: perDraftSeconds.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Per-pick clock: measured, with its error bar                              */
/* -------------------------------------------------------------------------- */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Real per-pick timing from `draft_pick_observations`. For each draft, sort
 * observations by pick number and take consecutive gaps in `firstSeenAtMs`. A
 * gap is usable only when BOTH observations carry a non-null
 * `observationGapMs`: a null gap means that pick was first seen in a bulk
 * poll, so no elapsed time can honestly be derived from it. Each usable gap is
 * attributed to whichever manager made the LATER pick, cross-referenced
 * against `input.picks` (this manager's own picks) by (draftId, pickNo).
 *
 * Gaps over six hours are dropped: an overnight gap is a draft that paused,
 * not a pick that took nine hours, and letting it in would wreck the median
 * on the one draft that has it.
 *
 * `errorBarMs` is the MAX `observationGapMs` across every observation that
 * contributed a usable gap, not the average: the worst poll interval in the
 * sample is the honest bound on how far off the elapsed-time estimate could
 * be, and averaging it away would understate that.
 */
function computePerPickClock(input: ManagerPulseInput): DraftClockFact | null {
  const myPickKeys = new Set(
    input.picks.map((pick) => `${pick.sleeperDraftId}|${pick.pickNo}`),
  );

  const byDraft = new Map<string, ManagerPickObservation[]>();
  for (const observation of input.pickObservations) {
    const list = byDraft.get(observation.sleeperDraftId);
    if (list) list.push(observation);
    else byDraft.set(observation.sleeperDraftId, [observation]);
  }

  const seconds: number[] = [];
  const gapsMs: number[] = [];

  for (const [draftId, observations] of byDraft) {
    const sorted = [...observations].sort((a, b) => a.pickNo - b.pickNo);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.observationGapMs == null || curr.observationGapMs == null) continue;
      if (!myPickKeys.has(`${draftId}|${curr.pickNo}`)) continue;

      const elapsedMs = curr.firstSeenAtMs - prev.firstSeenAtMs;
      if (elapsedMs <= 0 || elapsedMs > SIX_HOURS_MS) continue;

      seconds.push(elapsedMs / 1000);
      gapsMs.push(Math.max(prev.observationGapMs, curr.observationGapMs));
    }
  }

  if (seconds.length === 0) return null;

  const sortedSeconds = [...seconds].sort((a, b) => a - b);
  return {
    medianSeconds: median(sortedSeconds),
    errorBarMs: Math.max(...gapsMs),
    sampleSize: seconds.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Autopick                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Share of drafts in which at least one of this manager's picks was made on
 * autopick, over drafts where at least one of their picks carries a
 * NON-NULL `wasAutopick`. Three states matter here: `true`, `false`, and
 * `null` for "we could not read the autopicker list at that poll", and a null
 * must never be counted as a false. A draft where every one of this manager's
 * picks has a null `wasAutopick` contributes to neither the numerator nor the
 * denominator.
 */
function computeAutopick(input: ManagerPulseInput): AutopickFact | null {
  const observationByKey = new Map<string, ManagerPickObservation>();
  for (const observation of input.pickObservations) {
    observationByKey.set(
      `${observation.sleeperDraftId}|${observation.pickNo}`,
      observation,
    );
  }

  const myPicksByDraft = new Map<string, ManagerDraftPick[]>();
  for (const pick of input.picks) {
    const list = myPicksByDraft.get(pick.sleeperDraftId);
    if (list) list.push(pick);
    else myPicksByDraft.set(pick.sleeperDraftId, [pick]);
  }

  let draftsWithData = 0;
  let draftsWithAutopick = 0;

  for (const [draftId, picks] of myPicksByDraft) {
    let sawNonNull = false;
    let sawAutopick = false;
    for (const pick of picks) {
      const observation = observationByKey.get(`${draftId}|${pick.pickNo}`);
      if (!observation || observation.wasAutopick == null) continue;
      sawNonNull = true;
      if (observation.wasAutopick === true) sawAutopick = true;
    }
    if (!sawNonNull) continue;
    draftsWithData += 1;
    if (sawAutopick) draftsWithAutopick += 1;
  }

  if (draftsWithData === 0) return null;
  return { rate: draftsWithAutopick / draftsWithData, draftsObserved: draftsWithData };
}

/* -------------------------------------------------------------------------- */
/* The entry point                                                           */
/* -------------------------------------------------------------------------- */

export function computeDrafting(input: ManagerPulseInput): ManagerDrafting {
  const { picks, drafts, players, settings } = input;
  const draftsById = new Map(drafts.map((draft) => [draft.sleeperDraftId, draft]));

  const reachIndexRounds: Record<Lens, number | null> = { all: null, dynasty: null, redraft: null };
  const reachIndexSampleSize: Record<Lens, number | null> = { all: null, dynasty: null, redraft: null };
  const firstRoundsShape: Record<Lens, DraftPositionShape | null> = { all: null, dynasty: null, redraft: null };
  const firstRoundsSampleSize: Record<Lens, number | null> = { all: null, dynasty: null, redraft: null };
  const avgDraftGrade: Record<Lens, number | null> = { all: null, dynasty: null, redraft: null };
  const avgDraftGradeSampleSize: Record<Lens, number | null> = { all: null, dynasty: null, redraft: null };

  for (const lens of LENSES) {
    const reach = reachIndexForLens(
      picks,
      draftsById,
      lens,
      settings.samples.minDraftsForReach,
      settings.draft.reachRoundsThreshold,
    );
    reachIndexRounds[lens] = reach.value;
    reachIndexSampleSize[lens] = reach.sampleSize;

    const shape = shapeForLens(picks, players, settings.draft.earlyRoundCutoff, lens);
    firstRoundsShape[lens] = shape.sampleSize > 0 ? shape.shape : null;
    firstRoundsSampleSize[lens] = shape.sampleSize;

    const grade = gradeForLens(picks, lens);
    avgDraftGrade[lens] = grade.value;
    avgDraftGradeSampleSize[lens] = grade.sampleSize;
  }

  const rookieVeteran = rookieVeteranLean(picks, draftsById);
  const keepers = keeperUsage(picks);

  return {
    reachIndexRounds: poolable(reachIndexRounds),
    reachIndexSampleSize: poolable(reachIndexSampleSize),
    firstRoundsShape: poolable(firstRoundsShape),
    firstRoundsSampleSize: poolable(firstRoundsSampleSize),
    rookieVeteranLean: rookieVeteran.value,
    rookieVeteranLeanSampleSize: rookieVeteran.sampleSize,
    keeperUsageRate: keepers.value,
    keeperUsageSampleSize: keepers.sampleSize,
    avgDraftGrade: poolable(avgDraftGrade),
    avgDraftGradeSampleSize: poolable(avgDraftGradeSampleSize),
    draftPace: computeDraftPace(drafts),
    perPickClock: computePerPickClock(input),
    autopick: computeAutopick(input),
  };
}
