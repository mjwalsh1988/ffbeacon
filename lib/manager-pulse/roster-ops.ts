/**
 * Manager Pulse: roster management section (docs/manager-pulse-plan.md 6.6).
 *
 * Pure. No Supabase, no fetch, no clock, no React. Everything here is
 * arithmetic over the arrays `ManagerPulseInput` already carries.
 *
 * ABSOLUTE RULE, restated from CLAUDE.md's Manager Ledger section and from
 * section 4.4 of the plan: lineup efficiency, the best-lineup record and wins
 * left on the bench are READ from `league_manager_ledger_cache`, by way of
 * `input.ledgers`, which `load.ts` reads out of that table. This module NEVER
 * recomputes a lineup efficiency figure, a best-lineup record, or wins left on
 * the bench. A second implementation would leave two League Pulse surfaces
 * disagreeing about the same manager with nothing to say which one is right.
 *
 * WHY LINEUP EFFICIENCY IS WEIGHTED BY WEEKS GRADED
 *   `lineupEfficiency[lens]` is the mean of each ledger row's
 *   `lineupEfficiency`, weighted by that row's `weeksGraded`. An unweighted
 *   mean would let a manager's two-week cameo in one league-season count for
 *   as much as a full sixteen-week season in another. A row whose own
 *   `lineupEfficiency` is null contributes to neither the weighted sum nor the
 *   weight total; it is skipped, not treated as a zero-weeks row.
 *
 * WHY THE SAMPLE SIZE MATTERS MORE THAN USUAL HERE
 *   `lineupEfficiencySampleSize[lens]` counts league-seasons that actually had
 *   a ledger row to read, which is the count of `input.ledgers` rows in the
 *   lens, full stop. Most league-seasons will NOT have one, because a ledger
 *   only exists for a league somebody has opened the Decisions or Lineups page
 *   on. The report has to be able to say "measured in 9 of 31 seasons", so
 *   this count is never padded with league-seasons that had no row, and it is
 *   reported even when it is small.
 *
 * WHY A LENS WITH ZERO LEDGER ROWS IS DIFFERENT FROM AN EMPTY RESULT
 *   Zero ledger rows returns null for `lineupEfficiency`, `bestLineupRecord`
 *   and `winsLeftOnBench` (there is nothing to report), but the sample size
 *   itself is a real 0, not null: "measured in 0 of 31 seasons" is a true and
 *   useful sentence, where a null sample size would read as "we don't know how
 *   many", which is not the case.
 *
 * WHY A SINGLE NULL FIELD DOES NOT NULL THE WHOLE RECORD
 *   `bestLineupWins`, `bestLineupLosses` and `bestLineupTies` are three
 *   independently-nullable fields on one row. Summing skips whichever field is
 *   null on a given row rather than dropping the whole row from the sum, and
 *   if EVERY row in the lens is null for a field, the aggregate for that field
 *   is null rather than a manufactured zero. Same rule for `winsLeftOnBench`.
 *
 * WAIVERS AND FAAB
 *   `waiverClaimsPerSeason[lens]` divides waiver-kind moves by the count of
 *   distinct league-seasons in the lens (from `input.leagueSeasons`, not from
 *   how many of them happened to have a move).
 *
 *   `avgFaabBidShare[lens]` averages `faabSpent / faabBudget` over waiver
 *   moves where both are non-null and `faabBudget > 0`, but returns null
 *   outright when the lens holds no FAAB league-season at all
 *   (`ManagerLeagueSeason.usesFaab`). A rolling-priority league has no bid to
 *   average, and reporting 0 there would say this manager never bids when in
 *   fact their leagues have nothing to bid with.
 *
 *   `waiverPointsProduced[lens]` sums the ledger's own `waiverPointsStarted`,
 *   which is points a claimed player scored IN THE LINEUP. The ledger also
 *   publishes on-roster points, which count the weeks he sat on the bench; that
 *   measures the claim rather than the decision to start him, and reporting it
 *   under this name would credit a manager for a player they never played.
 *   Like every other figure in this section it is READ, never recomputed.
 *
 * MOVES PER WEEK AND MOVE SHAPE
 *   `movesPerWeek[lens]` counts every `ManagerMove` regardless of `kind`
 *   (waivers, free agent adds, trades, commissioner moves all count: this
 *   figure is about activity, not about waivers specifically), divided by the
 *   sum of `weeklyMoves[].lastWeekPlayed` for the league-seasons in the lens.
 *   A league-season whose `lastWeekPlayed` is null is dropped from BOTH the
 *   numerator (its moves are excluded) and the denominator; dividing a real
 *   move count by a guessed week count would let a preseason league drag the
 *   rate down for no reason.
 *
 *   `moveShape[lens]` splits each league-season's weeks at its own midpoint
 *   (`lastWeekPlayed / 2`; a week at or before the midpoint is the front half)
 *   and aggregates the front and back move counts across the lens. Below
 *   `MOVE_SHAPE_MIN_MOVES` total moves the shape returns null, because a shape
 *   read off three moves is a shape read off noise, not a pattern.
 *
 * ABANDONMENT IS A COUNT, NOT A JUDGEMENT
 *   `abandonmentCount[lens]` counts league-seasons (from `weeklyMoves`, since
 *   that is the only array carrying both a per-week move history and
 *   `weeksWithIncompleteLineup`) that end with BOTH a run of at least
 *   `ABANDONMENT_MIN_QUIET_WEEKS` consecutive final weeks of zero moves AND at
 *   least one week of an incomplete lineup. Both conditions, not either: a
 *   manager whose roster was set and simply needed nothing for the last month
 *   of the season is not absent, and this module attaches no adjective to the
 *   number either way. It returns 0, a real zero, when the lens has
 *   league-seasons and none of them qualify, and null only when the lens has
 *   no league-seasons (no `weeklyMoves` rows) at all.
 */

import { lensForCategory } from "./types";
import type {
  LeagueLens,
  ManagerLeagueCategory,
  ManagerRecord,
  ManagerPulseSettings,
  ManagerRosterOps,
  MoveShape,
  PoolableStat,
} from "./types";
import type {
  ManagerLedgerFacts,
  ManagerLeagueSeason,
  ManagerMove,
  ManagerPulseInput,
  ManagerWeeklyMoves,
} from "./input-types";

const LENSES: LeagueLens[] = ["all", "dynasty", "redraft"];

/*
 * The move-shape thresholds and the abandonment quiet-week floor used to be
 * constants here. They are settings now (`settings.behaviour`), because they
 * are exactly what this feature's settings row exists for: the number that
 * decides whether we call somebody "front-loaded" or "faded" is a judgement
 * about what we are willing to say about a person, and every such number in
 * Manager Pulse is adjustable without a deploy. See the ABSOLUTE rule in
 * default-settings.ts.
 */

/** Round to four decimal places, matching the precision used elsewhere in this feature. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function leagueSeasonKey(sleeperLeagueId: string, season: number): string {
  return `${sleeperLeagueId}:${season}`;
}

/** Filter any row carrying a `category` down to one lens. */
function filterByLens<T extends { category: ManagerLeagueCategory }>(
  rows: T[],
  lens: LeagueLens,
): T[] {
  if (lens === "all") return rows;
  return rows.filter((row) => lensForCategory(row.category) === lens);
}

/* -------------------------------------------------------------------------- */
/* Lineup efficiency, best-lineup record, wins left on bench (read, not computed) */
/* -------------------------------------------------------------------------- */

type LedgerRollup = {
  lineupEfficiency: number | null;
  lineupEfficiencySampleSize: number;
  bestLineupRecord: ManagerRecord | null;
  winsLeftOnBench: number | null;
  waiverPointsProduced: number | null;
};

function rollupLedgers(ledgers: ManagerLedgerFacts[]): LedgerRollup {
  const n = ledgers.length;
  if (n === 0) {
    // Zero ledger rows in this lens: null for every read figure, but the
    // sample size is a real 0, not null. See file header.
    return {
      lineupEfficiency: null,
      lineupEfficiencySampleSize: 0,
      bestLineupRecord: null,
      winsLeftOnBench: null,
      waiverPointsProduced: null,
    };
  }

  // Weighted mean of lineupEfficiency by weeksGraded. A row with a null
  // lineupEfficiency contributes to neither the weighted sum nor the weight
  // total, rather than being treated as a zero-weeks row.
  let weightTotal = 0;
  let weightedSum = 0;
  for (const ledger of ledgers) {
    if (ledger.lineupEfficiency === null) continue;
    const weight = Math.max(ledger.weeksGraded, 0);
    weightTotal += weight;
    weightedSum += ledger.lineupEfficiency * weight;
  }
  const lineupEfficiency = weightTotal > 0 ? round4(weightedSum / weightTotal) : null;

  // Each of wins/losses/ties is independently nullable on a row; skip the
  // field on that row rather than dropping the whole row, and null the
  // aggregate only if every row was null for that field.
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let sawRecordField = false;
  let benchWins = 0;
  let sawBenchField = false;
  let waiverPoints = 0;
  let sawWaiverField = false;
  for (const ledger of ledgers) {
    if (ledger.bestLineupWins !== null) {
      wins += ledger.bestLineupWins;
      sawRecordField = true;
    }
    if (ledger.bestLineupLosses !== null) {
      losses += ledger.bestLineupLosses;
      sawRecordField = true;
    }
    if (ledger.bestLineupTies !== null) {
      ties += ledger.bestLineupTies;
      sawRecordField = true;
    }
    if (ledger.winsLeftOnBench !== null) {
      benchWins += ledger.winsLeftOnBench;
      sawBenchField = true;
    }
    // Points a claimed player scored IN THE LINEUP, not merely while owned.
    // The ledger publishes both; on-roster points include weeks he sat on the
    // bench, which measures the claim rather than the decision to start him,
    // and reporting that as "what their claims produced" would credit a
    // manager for a player they never played.
    if (ledger.waiverPointsStarted !== null) {
      waiverPoints += ledger.waiverPointsStarted;
      sawWaiverField = true;
    }
  }

  return {
    lineupEfficiency,
    lineupEfficiencySampleSize: n,
    bestLineupRecord: sawRecordField ? { wins, losses, ties } : null,
    winsLeftOnBench: sawBenchField ? round4(benchWins) : null,
    waiverPointsProduced: sawWaiverField ? round4(waiverPoints) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Moves per week                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Total moves in the lens divided by total weeks played, both restricted to
 * league-seasons whose `lastWeekPlayed` is known. A league-season with a null
 * `lastWeekPlayed`, or with no `weeklyMoves` row at all, is excluded from both
 * halves rather than guessed at.
 */
function computeMovesPerWeek(
  weeklyMoves: ManagerWeeklyMoves[],
  moves: ManagerMove[],
  lens: LeagueLens,
): number | null {
  const knownWeeks = filterByLens(weeklyMoves, lens).filter(
    (w): w is ManagerWeeklyMoves & { lastWeekPlayed: number } => w.lastWeekPlayed !== null,
  );
  if (knownWeeks.length === 0) return null;

  const totalWeeks = knownWeeks.reduce((sum, w) => sum + w.lastWeekPlayed, 0);
  if (totalWeeks <= 0) return null;

  const validKeys = new Set(
    knownWeeks.map((w) => leagueSeasonKey(w.sleeperLeagueId, w.season)),
  );
  const movesInLens = filterByLens(moves, lens).filter((m) =>
    validKeys.has(leagueSeasonKey(m.sleeperLeagueId, m.season)),
  );

  return round4(movesInLens.length / totalWeeks);
}

/* -------------------------------------------------------------------------- */
/* Move shape                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Splits one league-season's weeks at its own midpoint (`lastWeekPlayed / 2`;
 * a week at or before the midpoint is the front half) and aggregates the
 * front/back move counts across every league-season in the lens.
 */
function computeMoveShape(
  weeklyMoves: ManagerWeeklyMoves[],
  lens: LeagueLens,
  behaviour: ManagerPulseSettings["behaviour"],
): MoveShape | null {
  const knownWeeks = filterByLens(weeklyMoves, lens).filter(
    (w): w is ManagerWeeklyMoves & { lastWeekPlayed: number } => w.lastWeekPlayed !== null,
  );

  let front = 0;
  let back = 0;
  for (const w of knownWeeks) {
    const midpoint = w.lastWeekPlayed / 2;
    for (const [weekKey, count] of Object.entries(w.movesByWeek)) {
      const week = Number(weekKey);
      if (week <= midpoint) {
        front += count;
      } else {
        back += count;
      }
    }
  }

  const total = front + back;
  if (total < behaviour.moveShapeMinMoves) return null;

  const frontShare = front / total;
  if (frontShare > behaviour.moveShapeFrontLoaded) return "front-loaded";
  if (frontShare < behaviour.moveShapeFaded) return "faded";
  return "steady";
}

/* -------------------------------------------------------------------------- */
/* Waivers and FAAB                                                           */
/* -------------------------------------------------------------------------- */

function computeWaiverClaimsPerSeason(
  leagueSeasons: ManagerLeagueSeason[],
  moves: ManagerMove[],
  lens: LeagueLens,
): number | null {
  const seasonsInLens = filterByLens(leagueSeasons, lens);
  if (seasonsInLens.length === 0) return null;

  const waiverCount = filterByLens(moves, lens).filter((m) => m.kind === "waiver").length;
  return round4(waiverCount / seasonsInLens.length);
}

/**
 * Mean bid share over waiver moves with both `faabSpent` and a positive
 * `faabBudget`. Null when the lens holds no FAAB league at all: a
 * rolling-priority league has no bid to average, and 0 would falsely say this
 * manager never bids.
 */
function computeAvgFaabBidShare(
  leagueSeasons: ManagerLeagueSeason[],
  moves: ManagerMove[],
  lens: LeagueLens,
): number | null {
  const faabSeasons = filterByLens(leagueSeasons, lens).filter((s) => s.usesFaab);
  if (faabSeasons.length === 0) return null;

  const qualifying = filterByLens(moves, lens).filter(
    (m): m is ManagerMove & { faabSpent: number; faabBudget: number } =>
      m.kind === "waiver" && m.faabSpent !== null && m.faabBudget !== null && m.faabBudget > 0,
  );
  if (qualifying.length === 0) return null;

  const sum = qualifying.reduce((acc, m) => acc + m.faabSpent / m.faabBudget, 0);
  return round4(sum / qualifying.length);
}

/* -------------------------------------------------------------------------- */
/* Abandonment                                                                */
/* -------------------------------------------------------------------------- */

/** Consecutive weeks of zero moves counting back from the league-season's last played week. */
function consecutiveQuietFinalWeeks(w: ManagerWeeklyMoves): number {
  if (w.lastWeekPlayed === null) return 0;
  let run = 0;
  for (let week = w.lastWeekPlayed; week >= 1; week -= 1) {
    const count = w.movesByWeek[week] ?? 0;
    if (count !== 0) break;
    run += 1;
  }
  return run;
}

function computeAbandonmentCount(
  weeklyMoves: ManagerWeeklyMoves[],
  lens: LeagueLens,
  behaviour: ManagerPulseSettings["behaviour"],
): number | null {
  const inLens = filterByLens(weeklyMoves, lens);
  if (inLens.length === 0) return null;

  let count = 0;
  for (const w of inLens) {
    const quietRun = consecutiveQuietFinalWeeks(w);
    if (quietRun >= behaviour.abandonmentQuietWeeks && w.weeksWithIncompleteLineup > 0) {
      count += 1;
    }
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* The section                                                                */
/* -------------------------------------------------------------------------- */

export function computeRosterOps(input: ManagerPulseInput): ManagerRosterOps {
  const movesPerWeek = {} as PoolableStat<number>;
  const moveShape = {} as PoolableStat<MoveShape>;
  const waiverClaimsPerSeason = {} as PoolableStat<number>;
  const avgFaabBidShare = {} as PoolableStat<number | null>;
  const waiverPointsProduced = {} as PoolableStat<number>;
  const lineupEfficiency = {} as PoolableStat<number>;
  const lineupEfficiencySampleSize = {} as PoolableStat<number>;
  const bestLineupRecord = {} as PoolableStat<ManagerRecord>;
  const winsLeftOnBench = {} as PoolableStat<number>;
  const abandonmentCount = {} as PoolableStat<number>;

  for (const lens of LENSES) {
    movesPerWeek[lens] = computeMovesPerWeek(input.weeklyMoves, input.moves, lens);
    moveShape[lens] = computeMoveShape(input.weeklyMoves, lens, input.settings.behaviour);
    waiverClaimsPerSeason[lens] = computeWaiverClaimsPerSeason(
      input.leagueSeasons,
      input.moves,
      lens,
    );
    avgFaabBidShare[lens] = computeAvgFaabBidShare(input.leagueSeasons, input.moves, lens);

    const rollup = rollupLedgers(filterByLens(input.ledgers, lens));
    waiverPointsProduced[lens] = rollup.waiverPointsProduced;
    lineupEfficiency[lens] = rollup.lineupEfficiency;
    lineupEfficiencySampleSize[lens] = rollup.lineupEfficiencySampleSize;
    bestLineupRecord[lens] = rollup.bestLineupRecord;
    winsLeftOnBench[lens] = rollup.winsLeftOnBench;

    abandonmentCount[lens] = computeAbandonmentCount(
      input.weeklyMoves,
      lens,
      input.settings.behaviour,
    );
  }

  return {
    movesPerWeek,
    moveShape,
    waiverClaimsPerSeason,
    avgFaabBidShare,
    waiverPointsProduced,
    lineupEfficiency,
    lineupEfficiencySampleSize,
    bestLineupRecord,
    winsLeftOnBench,
    abandonmentCount,
  };
}
