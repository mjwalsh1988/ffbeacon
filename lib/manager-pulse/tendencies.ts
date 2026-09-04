/**
 * Manager Pulse: the compact cross-tool tendency DTO (section 8.1).
 *
 * PURE. No Supabase, no fetch, no React, no `Date.now()`. Composes
 * `buildTendencySlice` from trading.ts, which already holds every figure this
 * file needs; nothing here recomputes a trade margin, a position appetite, or
 * an age lean. A second implementation would let Trade Ideas and the Manager
 * Pulse report disagree about the same manager with nothing to say which one
 * is right, which is the exact failure trading.ts's own header warns against.
 */

import { buildTendencySlice } from "./trading";
import { pickTendencySlice } from "./types";
import type { ManagerReport, ManagerTendency } from "./types";
import type { ManagerPulseInput } from "./input-types";

/** Re-exported so a consumer of this module never needs a second import for it. */
export { pickTendencySlice };

/**
 * Builds the tendency DTO from an already-computed report, so the favourite
 * and avoid player ids Trade Ideas sees are the SAME ones section 6.4 already
 * ranked, never a second, possibly different, top-N pass over the same data.
 */
export function buildTendency(input: ManagerPulseInput, report: ManagerReport): ManagerTendency {
  const favouritePlayerIds = report.affinity.favourites.map((f) => f.playerId);
  const avoidPlayerIds = report.affinity.avoids.map((a) => a.playerId);

  const dynasty = buildTendencySlice(input, "dynasty", favouritePlayerIds, avoidPlayerIds);
  const redraft = buildTendencySlice(input, "redraft", favouritePlayerIds, avoidPlayerIds);

  return {
    sleeperUserId: input.sleeperUserId,
    seasonsCovered: report.identity.seasonsCovered,
    overall: {
      leagueSeasons: report.counts.leagueSeasons,
      winRate: report.results.winRate.all,
      lineupEfficiency: report.rosterOps.lineupEfficiency.all,
    },
    dynasty,
    redraft,
  };
}

/**
 * What goes into the two real columns on `manager_pulse_tendencies`
 * (`dynasty_sample`, `redraft_sample`). An absent (null) slice contributes a
 * real 0, never null: the column exists so a caller can filter on it without
 * deserializing the jsonb tendency payload first, and a null column would
 * defeat that.
 */
export function tendencySamples(t: ManagerTendency): { dynasty: number; redraft: number } {
  return {
    dynasty: t.dynasty?.sampleSize ?? 0,
    redraft: t.redraft?.sampleSize ?? 0,
  };
}
