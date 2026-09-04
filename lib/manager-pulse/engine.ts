/**
 * Manager Pulse: the assembly point (docs/manager-pulse-plan.md section 3).
 *
 * PURE. No Supabase, no fetch, no React, no `Date.now()`. `computeFootprint`
 * takes the plain `ManagerPulseInput` every other module in this directory
 * already reads, calls the five section modules, builds the header and the
 * report container, and returns the finished `ManagerReport`.
 *
 * WHY `generatedAt` IS A SECOND ARGUMENT, NOT READ FROM THE CLOCK
 *   `ManagerReport.generatedAt` is required, but neither `ManagerPulseInput`
 *   nor any of the five section types carries a timestamp: the plan's own
 *   input-types.ts header states "NULL IS NOT ZERO... A missing... is null"
 *   for facts about the DATA, and a report's generation time is not a fact
 *   about the data, it is a fact about the CALL. Reading `Date.now()` here
 *   would make the engine's output depend on when it happened to run rather
 *   than purely on what it was handed, which is exactly what the purity rule
 *   in this directory exists to prevent (the same reason `fingerprint.ts`
 *   states it is clock-free). So `computeFootprint(input, generatedAt)` takes
 *   the timestamp as an explicit second argument, and the caller (`service.ts`,
 *   not owned by this task) is the one place responsible for stamping it.
 *
 * WHY `computeSection`'S "narrative" CASE DOES NOT MAP CLEANLY
 *   `ManagerSection` names eight slices, but only five of them (`results`,
 *   `drafting`, `affinity`, `trading`, `rosterOps`) are literal calls into
 *   the five pure section modules. `identity` and `leagues` are one function
 *   call each, built here rather than in their own module because each is a
 *   handful of lines over `input.leagueSeasons` with nowhere else to live.
 *   `narrative` is the one section that is NOT a peer of the other seven: it
 *   is a set of templates that cite figures FROM the other sections, so it
 *   cannot be produced from `input` alone the way results or drafting can.
 *   Producing it here means assembling the other six sections first and
 *   handing them to `buildNarrative`, which needs a full `ManagerReport` by
 *   its own type signature (per section 6.7's own rule: "no sentence without
 *   the figure it cites present on the same screen"). Since no template ever
 *   reads `generatedAt`, a fixed placeholder stands in for it here rather
 *   than asking `computeSection`'s caller to supply one; this is stated in
 *   `NARRATIVE_SECTION_PLACEHOLDER_GENERATED_AT`'s own comment below.
 */

import { lensForCategory } from "./types";
import type {
  LeagueLens,
  ManagerIdentity,
  ManagerReport,
  ManagerReportLimits,
  ManagerSection,
} from "./types";
import type {
  ManagerDraftFacts,
  ManagerLeagueSeason,
  ManagerPulseInput,
} from "./input-types";
import { computeResults, computeLeagueRows } from "./results";
import { computeDrafting } from "./drafting";
import { computeAffinity } from "./affinity";
import { computeTrading } from "./trading";
import { computeRosterOps } from "./roster-ops";
import { buildNarrative } from "./narrative";

/* -------------------------------------------------------------------------- */
/* 6.1 Header                                                                  */
/* -------------------------------------------------------------------------- */

function buildIdentity(input: ManagerPulseInput): ManagerIdentity {
  const seasons = input.leagueSeasons;

  let dynasty = 0;
  let redraft = 0;
  let bestBallDynasty = 0;
  let bestBallRedraft = 0;
  const seasonsSeen = new Set<number>();
  let firstSeasonSeen: number | null = null;

  for (const s of seasons) {
    seasonsSeen.add(s.season);
    if (firstSeasonSeen === null || s.season < firstSeasonSeen) firstSeasonSeen = s.season;
    if (s.category === "dynasty") dynasty += 1;
    else if (s.category === "redraft") redraft += 1;
    else if (s.category === "best-ball-dynasty") bestBallDynasty += 1;
    else if (s.category === "best-ball-redraft") bestBallRedraft += 1;
  }

  return {
    sleeperUserId: input.sleeperUserId,
    handle: input.handle,
    avatarUrl: input.avatarUrl,
    seasonsCovered: seasonsSeen.size,
    leagueSeasonsFound: seasons.length,
    splits: { dynasty, redraft, bestBallDynasty, bestBallRedraft },
    firstSeasonSeen,
  };
}

/* -------------------------------------------------------------------------- */
/* Counts and the default lens                                                */
/* -------------------------------------------------------------------------- */

function computeCounts(seasons: ManagerLeagueSeason[]): {
  leagueSeasons: number;
  dynasty: number;
  redraft: number;
} {
  let dynasty = 0;
  let redraft = 0;
  for (const s of seasons) {
    if (lensForCategory(s.category) === "dynasty") dynasty += 1;
    else redraft += 1;
  }
  return { leagueSeasons: seasons.length, dynasty, redraft };
}

/**
 * Whichever bucket holds more of the manager's league-seasons, per section
 * 6.0. A tie, including a manager with no history in either, falls back to
 * "all" rather than arbitrarily preferring one game.
 */
function pickDefaultLens(counts: { dynasty: number; redraft: number }): LeagueLens {
  if (counts.dynasty > counts.redraft) return "dynasty";
  if (counts.redraft > counts.dynasty) return "redraft";
  return "all";
}

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

function leagueSeasonKey(sleeperLeagueId: string, season: number): string {
  return `${sleeperLeagueId}::${season}`;
}

/**
 * League-seasons with no matching `league_manager_ledger_cache` row, matched
 * on (sleeperLeagueId, season). Never inferred from `leagueId`, because a
 * ledger row is keyed to the Sleeper league regardless of whether we have
 * resolved an internal `leagues.id` for it yet.
 */
function countLeagueSeasonsWithoutLedger(input: ManagerPulseInput): number {
  const ledgerKeys = new Set(
    input.ledgers.map((l) => leagueSeasonKey(l.sleeperLeagueId, l.season)),
  );
  let missing = 0;
  for (const s of input.leagueSeasons) {
    if (!ledgerKeys.has(leagueSeasonKey(s.sleeperLeagueId, s.season))) missing += 1;
  }
  return missing;
}

/**
 * Distinct seasons that had at least one draft, where NONE of that season's
 * drafts has a single `draft_pick_observations` row. A season with no draft
 * at all contributes nothing either way: there is nothing to have observed.
 */
function countSeasonsWithoutDraftObservations(input: ManagerPulseInput): number {
  const draftsBySeason = new Map<number, ManagerDraftFacts[]>();
  for (const draft of input.drafts) {
    const list = draftsBySeason.get(draft.season);
    if (list) list.push(draft);
    else draftsBySeason.set(draft.season, [draft]);
  }

  const observedDraftIds = new Set(input.pickObservations.map((o) => o.sleeperDraftId));

  let count = 0;
  for (const drafts of draftsBySeason.values()) {
    const hasObservation = drafts.some((d) => observedDraftIds.has(d.sleeperDraftId));
    if (!hasObservation) count += 1;
  }
  return count;
}

function computeLimits(input: ManagerPulseInput): ManagerReportLimits {
  return {
    leagueSeasonsSkipped: input.leagueSeasonsSkipped,
    leagueSeasonsWithoutLedger: countLeagueSeasonsWithoutLedger(input),
    seasonsWithoutDraftObservations: countSeasonsWithoutDraftObservations(input),
  };
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything except the narrative. Shared by `computeFootprint` (which fills
 * the narrative in with the real report) and `computeSection`'s "narrative"
 * case (which needs this same assembly before it has anything to cite).
 */
function assembleWithoutNarrative(
  input: ManagerPulseInput,
  generatedAt: string,
): Omit<ManagerReport, "narrative"> {
  const counts = computeCounts(input.leagueSeasons);

  return {
    identity: buildIdentity(input),
    results: computeResults(input),
    drafting: computeDrafting(input),
    affinity: computeAffinity(input),
    trading: computeTrading(input),
    rosterOps: computeRosterOps(input),
    leagues: computeLeagueRows(input),
    defaultLens: pickDefaultLens(counts),
    window: input.window,
    counts,
    generatedAt,
    modelVersion: input.settings.modelVersion,
    limits: computeLimits(input),
  };
}

/**
 * The full report. Pure: the same `input` and `generatedAt` always produce
 * the same output.
 */
export function computeFootprint(input: ManagerPulseInput, generatedAt: string): ManagerReport {
  const withoutNarrative = assembleWithoutNarrative(input, generatedAt);
  // buildNarrative reads every field on ManagerReport except its own
  // `narrative` slot, so an empty placeholder there is safe: no template
  // reads its own output.
  const draft: ManagerReport = { ...withoutNarrative, narrative: { sentences: [] } };
  const narrative = buildNarrative(draft, input.settings);
  return { ...draft, narrative };
}

/**
 * `generatedAt` is never read by any narrative template (see the file
 * header's "WHY computeSection'S narrative CASE DOES NOT MAP CLEANLY"). This
 * fixed value stands in for it so `computeSection` can build the report the
 * narrative needs without accepting a clock input of its own, which would
 * break its "takes an input, returns plain data" contract for a single
 * section.
 */
const NARRATIVE_SECTION_PLACEHOLDER_GENERATED_AT = "1970-01-01T00:00:00.000Z";

/** The report's section slice, for the partial render while capture is still draining. */
export function computeSection(input: ManagerPulseInput, section: ManagerSection): unknown {
  switch (section) {
    case "identity":
      return buildIdentity(input);
    case "results":
      return computeResults(input);
    case "drafting":
      return computeDrafting(input);
    case "affinity":
      return computeAffinity(input);
    case "trading":
      return computeTrading(input);
    case "rosterOps":
      return computeRosterOps(input);
    case "leagues":
      return computeLeagueRows(input);
    case "narrative": {
      const report = assembleWithoutNarrative(input, NARRATIVE_SECTION_PLACEHOLDER_GENERATED_AT);
      const draft: ManagerReport = { ...report, narrative: { sentences: [] } };
      return buildNarrative(draft, input.settings);
    }
    default: {
      const exhaustive: never = section;
      throw new Error(`Unhandled ManagerSection: ${String(exhaustive)}`);
    }
  }
}
