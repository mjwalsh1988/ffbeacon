/**
 * "What would the rest of the season look like if these rosters were different?"
 *
 * This is an extraction, not new arithmetic. lib/faab/league-faab.ts already
 * built a SimTeam[] for a whole league, swapped one team's weekly distribution
 * for the post-signing one, and ran simulateSeason twice to turn a points-per-week
 * gain into a playoff-odds gain. Trade Ideas needs the identical thing with two
 * teams changed instead of one, and two copies of that block would drift: the day
 * somebody fixes a seeding detail in one, the FAAB odds and the trade odds start
 * disagreeing about the same league on the same afternoon.
 *
 * So it lives here once, parameterised by how many rosters change.
 *
 * The seed is passed through untouched. simulateSeason builds a fresh generator
 * from it on every call, so the before run and the after run see the same dice
 * and the difference between them is the roster change alone, never variance.
 *
 * Pure. No database, no clock. Every distribution arrives already built by the
 * caller, from lib/power-pulse/lineup.ts or from a swap module.
 */

import { mean } from "./math";
import { simulateSeason, type SimTeam } from "./simulate";
import type { ScheduleWeek, SimulationResult } from "./types";

/** A roster's projected mean and spread for each remaining week. */
export type WeeklyDistribution = Map<number, { mean: number; sigma: number }>;

/** The standings facts a simulation needs. RosterRow satisfies this already. */
export type WhatIfRoster = {
  sleeperRosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
};

/** One team's season outcome under one scenario. */
export type WhatIfOutcome = {
  expectedWins: number;
  playoffOdds: number;
  titleOdds: number;
  byeOdds: number;
};

/**
 * Turn rosters plus weekly distributions into simulation inputs.
 *
 * The season-long mean and sigma are the average of the weekly ones rather than
 * a separate estimate, because the playoff bracket draws from them and a bracket
 * scored off a different distribution than the regular season would let a team's
 * odds jump at the seam. A roster with no weekly entries gets zero for both,
 * which is what simulateSeason already assumed when a week was missing.
 */
export function buildSimTeams(
  rosters: WhatIfRoster[],
  weekly: Map<number, WeeklyDistribution>,
): SimTeam[] {
  return rosters.map((roster) => {
    const weeks = weekly.get(roster.sleeperRosterId) ?? new Map();
    const means = [...weeks.values()].map((w) => w.mean);
    const sigmas = [...weeks.values()].map((w) => w.sigma);
    return {
      sleeperRosterId: roster.sleeperRosterId,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: roster.pointsFor,
      weeks,
      mean: mean(means),
      sigma: mean(sigmas),
    };
  });
}

function toOutcomes(results: Map<number, SimulationResult>): Map<number, WhatIfOutcome> {
  const out = new Map<number, WhatIfOutcome>();
  for (const [rosterId, r] of results) {
    out.set(rosterId, {
      expectedWins: r.expectedWins,
      playoffOdds: r.playoffOdds,
      titleOdds: r.titleOdds,
      byeOdds: r.byeOdds,
    });
  }
  return out;
}

/**
 * Run the remaining season twice: once as the league stands, once with the
 * replacement distributions overlaid.
 *
 * Returns null when there is nothing left to play. A league with no unplayed
 * regular-season games has no odds to move, and reporting the difference as zero
 * would read as "this trade does nothing" when the truth is "we cannot say".
 * The caller is expected to surface it as unavailable.
 *
 * `baseline` is never mutated. The after scenario is a shallow copy with the
 * replacement entries written over it, so a caller can hold onto the baseline
 * map and reuse it for a second proposal.
 */
export function simulateWithReplacements(params: {
  rosters: WhatIfRoster[];
  /** Every roster's baseline weekly distribution, keyed by sleeper roster id. */
  baseline: Map<number, WeeklyDistribution>;
  /** Rosters whose distribution changes. Keyed by sleeper roster id. */
  replacements: Map<number, WeeklyDistribution>;
  /** Unplayed regular-season weeks. */
  upcoming: ScheduleWeek[];
  options: {
    runs: number;
    seed: number;
    playoffTeams: number;
    playoffWeekStart: number;
  };
}): {
  before: Map<number, WhatIfOutcome>;
  after: Map<number, WhatIfOutcome>;
} | null {
  const { rosters, baseline, replacements, upcoming, options } = params;
  if (upcoming.length === 0) return null;

  const after = new Map(baseline);
  for (const [rosterId, distribution] of replacements) {
    after.set(rosterId, distribution);
  }

  const beforeResults = simulateSeason(
    buildSimTeams(rosters, baseline),
    upcoming,
    options,
  );
  const afterResults = simulateSeason(buildSimTeams(rosters, after), upcoming, options);

  return { before: toOutcomes(beforeResults), after: toOutcomes(afterResults) };
}
