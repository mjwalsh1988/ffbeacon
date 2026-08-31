/**
 * How volatile is a player we know nothing about?
 *
 * This is the fallback the projection model reaches for when a player has no
 * measured history of his own, which is about a third of the projected pool and
 * almost all of the interesting part of it: rookies, second-year breakouts, and
 * anyone whose role changed over the summer.
 *
 * IT USED TO BE ONE NUMBER PER POSITION, AND THAT WAS WRONG TWICE
 *
 * First, the number was measured on the wrong sample. Ranking the 2025 top 36 at
 * each position and weighting them equally let RB25-48, a pool of committee
 * backs whose usage genuinely swings week to week, set the figure for every
 * running back including the bell cows. That produced a running back CV of 0.59
 * against a receiver CV of 0.57, which says receivers are the steadier position.
 * Inside the range where starters actually live the opposite is true at every
 * band, and for the obvious reason: volume is stability, and the top two dozen
 * backs touch the ball far more often than the receivers around them.
 *
 *     2023-2025, PPR, median week-to-week CV
 *     rank    RB      WR
 *     1-6     0.467   0.502
 *     7-12    0.460   0.534
 *     13-18   0.495   0.554
 *     19-24   0.549   0.565     receivers more volatile through here
 *     25-36   0.593   0.574
 *     37-60   0.763   0.628     and backs beyond it
 *
 * Second, one number cannot serve every league, because SCORING changes the
 * answer. A reception is a floor, so PPR compresses receiver variance and
 * standard scoring exposes it. The gap between the two is larger than the gap
 * between the positions:
 *
 *     WR 1-6      PPR 0.502    half 0.539    standard 0.603
 *     RB 1-6      PPR 0.467    half 0.513    standard 0.541
 *
 * Quarterbacks, kickers and defenses are untouched by reception scoring and
 * measure identically across all three, which is the correctness check on the
 * whole table.
 *
 * WHY THE CURVE IS KEYED ON POINTS AND NOT ON RANK
 * Rank is the natural way to think about this and the wrong way to implement it.
 * projectPlayerWeek is pure and per-player; handing it a positional rank would
 * mean a full-universe ordering threaded through every caller, and inside the
 * Power Pulse engine the only players in scope are one league's rosters, where a
 * within-set rank means nothing. A player's own projected points answer the same
 * question with no context at all: a receiver projected 16 a week IS a WR1. The
 * anchors below are the measured average points per game in each rank band, so
 * the curve says exactly what the rank table above says, addressed differently.
 *
 * A KNOWN LIMITATION, STATED RATHER THAN HIDDEN
 * The anchors are measured under the three CANONICAL bases, and the points a
 * player is placed on the curve with are scored under the league's LITERAL
 * settings. closestScoringBase only inspects `rec`, so a league that pays six
 * points for a passing touchdown lifts every quarterback two or three points a
 * week and pins most starters past the 21.7 anchor, where they all flatten onto
 * the elite figure of 0.365. A tight end premium pushes tight ends the other way
 * and reads them off a lower band than they belong in.
 *
 * The effect is bounded: the curve's whole range is about 0.25 of coefficient of
 * variation, both ends are clamped, and this is a FALLBACK that only applies to
 * players with fewer than eight graded weeks. It is wrong in the same direction
 * for every team in a league, so it barely moves a within-league ranking. It
 * would still be better to normalise the placement points to the canonical base
 * before reading the curve, which is the fix if this is ever revisited.
 *
 * Every figure here comes from player_stats, 2023 through 2025, regular season,
 * requiring 10 games. Reproduce the whole table with npm run measure:variance.
 */

import type { PulsePosition } from "./types";

/** The three stored-points bases a league's scoring map can be closest to. */
export type ScoringBase = "pts_ppr" | "pts_half_ppr" | "pts_std";

/**
 * One measured point on a position's curve: at this many projected points per
 * week, players historically swung by this coefficient of variation.
 *
 * Ordered by DESCENDING points, which is how cvForPoints walks them.
 */
export type VarianceAnchor = {
  /** Projected points per week, in the league's own scoring. */
  points: number;
  /** Coefficient of variation, sigma over mean. */
  cv: number;
};

export type VarianceCurve = Record<PulsePosition, VarianceAnchor[]>;

/**
 * Reception scoring is the only thing that separates the three bases, so the
 * quarterback, kicker and defense curves are shared rather than triplicated.
 * Anything that changes one of them must change all three.
 */
const QB_CURVE: VarianceAnchor[] = [
  { points: 21.7, cv: 0.365 },
  { points: 18.6, cv: 0.389 },
  { points: 16.7, cv: 0.392 },
  { points: 14.6, cv: 0.48 },
  { points: 11.2, cv: 0.615 },
];

const K_CURVE: VarianceAnchor[] = [
  { points: 10.3, cv: 0.481 },
  { points: 8.9, cv: 0.527 },
  { points: 8.1, cv: 0.533 },
  { points: 7.6, cv: 0.558 },
  { points: 6.4, cv: 0.595 },
];

const DEF_CURVE: VarianceAnchor[] = [
  { points: 9.8, cv: 0.683 },
  { points: 8.6, cv: 0.755 },
  { points: 7.5, cv: 0.715 },
  { points: 6.6, cv: 0.866 },
  { points: 5.1, cv: 0.844 },
];

export const VARIANCE_CURVES: Record<ScoringBase, VarianceCurve> = {
  pts_ppr: {
    QB: QB_CURVE,
    RB: [
      { points: 20.2, cv: 0.467 },
      { points: 16.2, cv: 0.46 },
      { points: 14.8, cv: 0.495 },
      { points: 13.0, cv: 0.549 },
      { points: 10.7, cv: 0.593 },
      { points: 6.6, cv: 0.763 },
    ],
    WR: [
      { points: 20.1, cv: 0.502 },
      { points: 16.5, cv: 0.534 },
      { points: 15.0, cv: 0.554 },
      { points: 13.7, cv: 0.565 },
      { points: 12.6, cv: 0.574 },
      { points: 9.9, cv: 0.628 },
    ],
    TE: [
      { points: 14.2, cv: 0.542 },
      { points: 11.0, cv: 0.57 },
      { points: 9.5, cv: 0.65 },
      { points: 8.0, cv: 0.646 },
      { points: 6.5, cv: 0.685 },
      { points: 4.2, cv: 0.659 },
    ],
    K: K_CURVE,
    DEF: DEF_CURVE,
  },
  pts_half_ppr: {
    QB: QB_CURVE,
    RB: [
      { points: 18.5, cv: 0.513 },
      { points: 14.8, cv: 0.497 },
      { points: 13.5, cv: 0.525 },
      { points: 11.8, cv: 0.579 },
      { points: 9.7, cv: 0.619 },
      { points: 5.9, cv: 0.833 },
    ],
    WR: [
      { points: 17.1, cv: 0.539 },
      { points: 13.9, cv: 0.565 },
      { points: 12.5, cv: 0.601 },
      { points: 11.4, cv: 0.61 },
      { points: 10.4, cv: 0.604 },
      { points: 8.0, cv: 0.671 },
    ],
    TE: [
      { points: 12.1, cv: 0.593 },
      { points: 9.3, cv: 0.634 },
      { points: 7.9, cv: 0.706 },
      { points: 6.6, cv: 0.714 },
      { points: 5.3, cv: 0.729 },
      { points: 3.3, cv: 0.742 },
    ],
    K: K_CURVE,
    DEF: DEF_CURVE,
  },
  pts_std: {
    QB: QB_CURVE,
    RB: [
      { points: 16.8, cv: 0.541 },
      { points: 13.4, cv: 0.545 },
      { points: 12.2, cv: 0.559 },
      { points: 10.6, cv: 0.633 },
      { points: 8.7, cv: 0.673 },
      { points: 5.2, cv: 0.889 },
    ],
    WR: [
      { points: 14.1, cv: 0.603 },
      { points: 11.3, cv: 0.646 },
      { points: 10.0, cv: 0.693 },
      { points: 9.1, cv: 0.68 },
      { points: 8.2, cv: 0.703 },
      { points: 6.1, cv: 0.755 },
    ],
    TE: [
      { points: 10.0, cv: 0.678 },
      { points: 7.6, cv: 0.741 },
      { points: 6.3, cv: 0.81 },
      { points: 5.2, cv: 0.821 },
      { points: 4.1, cv: 0.853 },
      { points: 2.5, cv: 0.879 },
    ],
    K: K_CURVE,
    DEF: DEF_CURVE,
  },
};

/**
 * The coefficient of variation for a player projected to score `points` a week.
 *
 * Linear between anchors, FLAT outside them. Flat rather than extrapolated on
 * purpose: past the last measured point the shape is unknown, and a straight
 * line drawn off the end of real data reaches absurd values within a few points.
 * A player projected 30 a week gets the elite figure; one projected 0.5 gets the
 * deep-bench figure, and neither is invented.
 */
export function cvForPoints(
  anchors: VarianceAnchor[],
  points: number,
): number | null {
  if (anchors.length === 0) return null;
  if (!Number.isFinite(points)) return anchors[anchors.length - 1].cv;

  const first = anchors[0];
  if (points >= first.points) return first.cv;

  const last = anchors[anchors.length - 1];
  if (points <= last.points) return last.cv;

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const hi = anchors[i];
    const lo = anchors[i + 1];
    if (points <= hi.points && points >= lo.points) {
      const span = hi.points - lo.points;
      if (span <= 0) return hi.cv;
      const t = (points - lo.points) / span;
      return lo.cv + t * (hi.cv - lo.cv);
    }
  }
  return last.cv;
}

/** The curve for one position under one scoring base. Empty when unknown. */
export function curveFor(
  scoringBase: string,
  position: PulsePosition,
  curves: Record<string, VarianceCurve> = VARIANCE_CURVES,
): VarianceAnchor[] {
  const table = curves[scoringBase] ?? curves.pts_ppr;
  return table?.[position] ?? [];
}
