/**
 * The what-if behind the slot button on the lineup board: start this player
 * instead of that one, and say what it does to the week.
 *
 * PURE, AND CLIENT-SAFE. No "server-only", no Supabase, no fetch. Every number
 * it needs is already on the page: each player carries `projected` and `sigma`,
 * and the optimiser has already reported the set total and the best total. That
 * is the whole reason this is arithmetic rather than a server action, and it is
 * why the panel answers instantly and costs nothing to open.
 *
 * IT INTRODUCES NO MODEL. Three facts do all the work and every one of them was
 * decided somewhere else:
 *
 *   POINTS   a swap moves the set lineup by exactly (in minus out). Nothing
 *            else in the lineup changes, so nothing else in the total does.
 *   SPREAD   variances add (lib/power-pulse/lineup.ts lineupSigma), so the new
 *            spread is the root of (old variance, minus out squared, plus in
 *            squared). Same independence simplification winProbability makes.
 *   WIN      lib/power-pulse/math.ts winProbability, unchanged, the same
 *            function the Schedules board uses for the same matchup.
 *
 * THE BEST LINEUP DOES NOT MOVE, AND THAT IS THE POINT. The optimum is the
 * highest-scoring legal lineup the roster can produce; it does not depend on
 * which nine the manager has actually seated. So "points left on your bench"
 * after a swap is optimalTotal minus the NEW set total, with no second run of
 * the optimiser. A version that re-ran the fill per candidate would burn the
 * work to arrive at the identical number.
 *
 * THE COMPARISON IS THE LINEUP AS SET, ON BOTH SIDES. The Schedules page shows
 * a win probability built from each team's BEST lineup, which is a different
 * question and a different number. This one is built from the lineup a reader
 * actually has, because "what happens if I make this change" is meaningless
 * against a baseline that already assumes the change. The panel says which
 * basis it is on rather than leaving two win probabilities on the site with no
 * explanation for the gap.
 *
 * A SETTLED WEEK IS NOT SIMULATED. Nothing here is offered once a week is
 * final: the lineup cannot be changed and grading a hypothetical against
 * results answers a question nobody has. The caller enforces it.
 */

import { winProbability } from "@/lib/power-pulse/math";
import { PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import type { LineupGroup, LineupPlayer } from "./types";

/** The positions a slot token accepts. Empty for IDP and unknown tokens. */
export function eligiblePositionsFor(token: string): string[] {
  return PULSE_SLOT_ELIGIBILITY[token] ?? [];
}

/** True when this player could legally hold this slot. */
export function isEligibleFor(token: string, position: string): boolean {
  const eligible = eligiblePositionsFor(token);
  if (eligible.length === 0) return false;
  return eligible.includes(position.toUpperCase());
}

/**
 * Who could go into this slot instead, best projection first.
 *
 * BENCH ONLY, and all three exclusions are deliberate.
 *
 * Injured reserve and the taxi squad are out because Sleeper will not let them
 * into a lineup without a roster move, and a what-if a manager cannot carry out
 * is not a what-if. The same rule keeps them out of the optimiser
 * (lib/league-lineups/build.ts), so the two agree.
 *
 * Another STARTER is out for a different reason: moving a player from one
 * starting slot to another changes the total by nothing at all. The optimiser
 * panel already says so in as many words, and offering a menu of swaps worth
 * 0.0 would bury the ones worth eleven points.
 *
 * A player with no published projection is out because there is no number to
 * simulate with, and reading his absence as a zero would report the swap as a
 * loss of every point the outgoing player was worth.
 */
export function swapCandidates(bench: LineupPlayer[], token: string): LineupPlayer[] {
  return bench
    .filter((p) => p.rosterSlot === "bench")
    .filter((p) => p.projected !== null)
    .filter((p) => isEligibleFor(token, p.position))
    .sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0));
}

/**
 * The same filter as `swapCandidates`, counted rather than built.
 *
 * The board only wants to know whether a slot has anything to offer, and
 * sorting a bench it is going to discard is work for nobody. Sharing the
 * predicate rather than restating it is what keeps the count and the list from
 * ever disagreeing about whether a button should exist.
 */
export function countSwapCandidates(bench: LineupPlayer[], token: string): number {
  let count = 0;
  for (const player of bench) {
    if (player.rosterSlot !== "bench") continue;
    if (player.projected === null) continue;
    if (!isEligibleFor(token, player.position)) continue;
    count += 1;
  }
  return count;
}

/** The week's numbers a simulation is measured against. */
export type LineupBaseline = {
  /** The set lineup's projected points. Null when nothing in it is projected. */
  setTotal: number | null;
  /** The best legal lineup's projected points. Null when it could not be built. */
  optimalTotal: number | null;
  /** Combined spread of the set lineup, over the same starters that made setTotal. */
  sigma: number;
  /**
   * The opponent's projected mean and spread for this week, when we hold them.
   *
   * From `league_power_pulse_cache.weekly`, which is their BEST lineup. It is
   * the same figure the Schedules board uses for the same matchup, so the two
   * pages cannot disagree about the opponent. Null before a slate exists,
   * after a week settles, or for a roster Sleeper left unpaired.
   */
  opponent: { mean: number; sigma: number } | null;
};

/**
 * The set lineup's combined spread.
 *
 * Over exactly the starters that contributed to `setTotal`: a slot with no
 * projection contributed no points and contributes no variance either.
 * Variances add, per lib/power-pulse/lineup.ts lineupSigma.
 */
export function baselineSigma(groups: LineupGroup[]): number {
  let variance = 0;
  for (const group of groups) {
    for (const entry of group.entries) {
      const player = entry.player;
      if (!player || player.projected === null) continue;
      const sigma = player.sigma ?? 0;
      variance += sigma * sigma;
    }
  }
  return Math.sqrt(variance);
}

export type SwapImpact = {
  pointsBefore: number;
  pointsAfter: number;
  /** After minus before. Negative when the change costs points. */
  pointsDelta: number;
  /** 0 to 1. Null when we hold no opponent projection for this week. */
  winProbBefore: number | null;
  winProbAfter: number | null;
  winProbDelta: number | null;
  /** Points still sitting on the bench, before and after. Null with no optimum. */
  gapBefore: number | null;
  gapAfter: number | null;
  gapDelta: number | null;
};

/** Two decimals, the precision fantasy points are quoted at everywhere. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What one swap does to the week.
 *
 * `outPlayer` is null when the slot is empty, which is a real case and not an
 * error: filling an empty FLEX adds the incoming player's whole projection.
 *
 * Returns null when there is no baseline to move (nothing in the lineup is
 * projected), because a delta against an unknown is not a delta.
 */
export function simulateSwap(params: {
  baseline: LineupBaseline;
  outPlayer: LineupPlayer | null;
  inPlayer: LineupPlayer;
}): SwapImpact | null {
  const { baseline, outPlayer, inPlayer } = params;
  if (baseline.setTotal === null) return null;
  if (inPlayer.projected === null) return null;

  // A player with no projection contributed nothing to the total and nothing to
  // the variance, so removing him removes nothing. That is the rule the total
  // itself was built under, not a special case for this file.
  const outPoints = outPlayer?.projected ?? 0;
  const outSigma =
    outPlayer === null || outPlayer.projected === null ? 0 : (outPlayer.sigma ?? 0);
  const inSigma = inPlayer.sigma ?? 0;

  const pointsBefore = baseline.setTotal;
  const pointsAfter = pointsBefore - outPoints + inPlayer.projected;

  // Clamped at zero: floating point can drive the difference a hair negative
  // when the two spreads are equal, and Math.sqrt of that is NaN.
  const varianceBefore = baseline.sigma * baseline.sigma;
  const varianceAfter = Math.max(
    0,
    varianceBefore - outSigma * outSigma + inSigma * inSigma,
  );
  const sigmaAfter = Math.sqrt(varianceAfter);

  const opponent = baseline.opponent;
  const winProbBefore = opponent
    ? winProbability(pointsBefore, baseline.sigma, opponent.mean, opponent.sigma)
    : null;
  const winProbAfter = opponent
    ? winProbability(pointsAfter, sigmaAfter, opponent.mean, opponent.sigma)
    : null;

  const gapBefore =
    baseline.optimalTotal === null
      ? null
      : Math.max(0, round2(baseline.optimalTotal - pointsBefore));
  const gapAfter =
    baseline.optimalTotal === null
      ? null
      : Math.max(0, round2(baseline.optimalTotal - pointsAfter));

  return {
    pointsBefore: round2(pointsBefore),
    pointsAfter: round2(pointsAfter),
    pointsDelta: round2(pointsAfter - pointsBefore),
    winProbBefore,
    winProbAfter,
    winProbDelta:
      winProbBefore === null || winProbAfter === null ? null : winProbAfter - winProbBefore,
    gapBefore,
    gapAfter,
    gapDelta: gapBefore === null || gapAfter === null ? null : round2(gapAfter - gapBefore),
  };
}

/**
 * Below this, a change is reported as no difference rather than as a direction.
 *
 * A twentieth of a point is not a finding in a projection carrying a seven
 * point spread, and "raises your total by 0.0" is a sentence that says nothing
 * while looking like it says something.
 */
export const SWAP_NOISE = 0.05;

/** Which way a points figure moved, or neither. */
export function pointsDirection(delta: number): "up" | "down" | "flat" {
  if (delta > SWAP_NOISE) return "up";
  if (delta < -SWAP_NOISE) return "down";
  return "flat";
}

/** The same three bands for a probability, at half a percentage point. */
export function probabilityDirection(delta: number | null): "up" | "down" | "flat" {
  if (delta === null) return "flat";
  const points = delta * 100;
  if (points > 0.5) return "up";
  if (points < -0.5) return "down";
  return "flat";
}
