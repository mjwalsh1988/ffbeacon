/**
 * What a trade does to one team's starting lineup, week by week.
 *
 * lib/faab/marginal.ts answers the same question for a waiver claim: add one
 * player, cut one player, measure the lineup. A trade is that question with the
 * counts unpinned. Two in and three out is an ordinary offer, and so is one in
 * and one out, and the arithmetic should not care which it is looking at.
 *
 * The method is unchanged and deliberately dumb. For every remaining week, build
 * the optimal lineup as the roster stands, then build it again with the outgoing
 * players struck from the candidate pool and the incoming ones added, and take
 * the difference. No positional heuristics, no "this fills a need" adjustment.
 * If a player never displaces anybody the difference is zero for that week, and
 * a player sent away who was riding the bench costs nothing, both of which fall
 * out of the two builds rather than out of a special case.
 *
 * A week a player has no projection for is a week he is simply not a candidate.
 * That is a bye or an unpublished projection, and scoring him at zero would
 * quietly drag a real starter out of the lineup and report the loss as the
 * trade's doing.
 *
 * Pure. Every candidate arrives already projected by lib/power-pulse/project.ts,
 * which is the rule that keeps a trade answer and a Power Pulse answer from ever
 * disagreeing about what a player is projected to do.
 */

import {
  buildOptimalLineup,
  lineupSigma,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import { mean } from "@/lib/power-pulse/math";
import type { WeeklyDistribution } from "@/lib/power-pulse/what-if";

/** Floating point slack. Below this a week counts as unchanged. */
const EPSILON = 1e-9;

/** One remaining week, before and after. */
export type SwapWeekDetail = {
  week: number;
  beforeTotal: number;
  afterTotal: number;
  delta: number;
  /** Incoming player ids that made the optimal lineup that week. */
  startingIncoming: string[];
};

export type RosterSwapInput = {
  /** Projectable startable slot tokens, in league order. */
  slots: string[];
  /** Remaining weeks, ascending. */
  weeks: number[];
  /** This roster's projectable candidates per week, BEFORE the trade. */
  rosterByWeek: Map<number, LineupCandidate[]>;
  /** Candidates arriving, per week. Same projection terms. */
  incomingByWeek: Map<number, LineupCandidate[]>;
  /** Player ids leaving. Removed from every week. */
  outgoingPlayerIds: string[];
};

export type RosterSwapResult = {
  weeks: SwapWeekDetail[];
  weeklyBefore: WeeklyDistribution;
  weeklyAfter: WeeklyDistribution;
  /** Mean optimal-lineup points per week, before and after. */
  meanBefore: number;
  meanAfter: number;
  delta: number;
  weeksImproved: number;
  weeksWorsened: number;
  /** Weeks each incoming player actually starts. */
  incomingStartWeeks: Record<string, number>;
  /**
   * Mean points per week from each starting slot, before and after, aligned by
   * index with `slots`.
   *
   * Carried out of here rather than recomputed by the caller, and that is worth
   * a sentence. The optimal lineup for every week is built in the loop below,
   * and the per-slot breakdown is sitting in `filled.slots` when it happens.
   * A caller that wants "which starting slot is weakest" and throws this away
   * has to rebuild every one of those lineups a second time: 2 scenarios by 14
   * remaining weeks is 28 exact augmenting-path fills to recover a number that
   * was already in hand.
   */
  slotPointsBefore: number[];
  slotPointsAfter: number[];
};

/**
 * Run the swap.
 *
 * `incomingStartWeeks` is keyed only by players who had a projection in at least
 * one week. A player with none never enters the lineup build, so giving him a
 * zero here would read as "we checked and he never starts" when the truth is
 * "we had nothing to check him with". The caveat list is where that belongs.
 */
export function computeRosterSwap(input: RosterSwapInput): RosterSwapResult {
  const { slots, weeks, rosterByWeek, incomingByWeek, outgoingPlayerIds } = input;

  const leaving = new Set(outgoingPlayerIds);

  // Every arriving player we have at least one projection for. Seeded to zero so
  // a player who is projected but never starts is reported honestly as zero.
  const incomingStartWeeks: Record<string, number> = {};
  for (const arrivals of incomingByWeek.values()) {
    for (const candidate of arrivals) {
      if (incomingStartWeeks[candidate.playerId] === undefined) {
        incomingStartWeeks[candidate.playerId] = 0;
      }
    }
  }

  const detail: SwapWeekDetail[] = [];
  const weeklyBefore: WeeklyDistribution = new Map();
  const weeklyAfter: WeeklyDistribution = new Map();
  const beforeTotals: number[] = [];
  const afterTotals: number[] = [];
  const slotSumBefore = slots.map(() => 0);
  const slotSumAfter = slots.map(() => 0);
  let weeksImproved = 0;
  let weeksWorsened = 0;

  for (const week of weeks) {
    const roster = rosterByWeek.get(week) ?? [];
    const arrivals = incomingByWeek.get(week) ?? [];
    const arrivingIds = new Set(arrivals.map((c) => c.playerId));

    const before = buildOptimalLineup(slots, roster);
    const after = buildOptimalLineup(slots, [
      ...roster.filter((c) => !leaving.has(c.playerId)),
      ...arrivals,
    ]);

    weeklyBefore.set(week, {
      mean: before.total,
      sigma: lineupSigma(before.slots),
    });
    weeklyAfter.set(week, {
      mean: after.total,
      sigma: lineupSigma(after.slots),
    });

    // The per-slot breakdown, captured while the lineup exists. See
    // slotPointsBefore in RosterSwapResult for why it is not left behind.
    before.slots.forEach((slot, i) => {
      slotSumBefore[i] += slot.points;
    });
    after.slots.forEach((slot, i) => {
      slotSumAfter[i] += slot.points;
    });

    const startingIncoming: string[] = [];
    const counted = new Set<string>();
    for (const slot of after.slots) {
      const id = slot.playerId;
      if (!id || !arrivingIds.has(id) || counted.has(id)) continue;
      counted.add(id);
      startingIncoming.push(id);
      incomingStartWeeks[id] = (incomingStartWeeks[id] ?? 0) + 1;
    }

    const delta = after.total - before.total;
    if (delta > EPSILON) weeksImproved += 1;
    else if (delta < -EPSILON) weeksWorsened += 1;

    beforeTotals.push(before.total);
    afterTotals.push(after.total);
    detail.push({
      week,
      beforeTotal: before.total,
      afterTotal: after.total,
      delta,
      startingIncoming,
    });
  }

  const meanBefore = mean(beforeTotals);
  const meanAfter = mean(afterTotals);

  return {
    weeks: detail,
    weeklyBefore,
    weeklyAfter,
    meanBefore,
    meanAfter,
    delta: meanAfter - meanBefore,
    weeksImproved,
    weeksWorsened,
    incomingStartWeeks,
    // Averaged over the weeks considered, so a slot's figure is a per-week rate
    // and comparable with meanBefore / meanAfter. An empty week list would make
    // this a division by zero, so it falls to zeros rather than NaN.
    slotPointsBefore: slotSumBefore.map((v) => (weeks.length > 0 ? v / weeks.length : 0)),
    slotPointsAfter: slotSumAfter.map((v) => (weeks.length > 0 ? v / weeks.length : 0)),
  };
}
