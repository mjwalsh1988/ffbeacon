/**
 * Positional WAR tiers: six plain-English bands a reader can act on.
 *
 * PURE. No React, no DOM, no database, no clock. The dashboard's table, its
 * chart readout and its CSV all read the same function, so a player cannot be
 * "Elite" in one place and "Strong advantage" in another.
 *
 * WHY THE THRESHOLDS ARE LEAGUE-RELATIVE, and this is a specification rather
 * than a styling choice.
 *
 * Season WAR is a SUM of weekly win probabilities over the weeks that remain.
 * A league viewed in the preseason has seventeen of them; the same league
 * viewed in week fourteen has four. The best running back in that league is
 * the same player with roughly a quarter of the WAR. Any fixed threshold in
 * wins would therefore relabel the whole league every few weeks without a
 * single projection changing, so a fixed threshold is not an option.
 *
 * A share of the best player's WAR is scale-free but hangs the entire ladder
 * on one outlier: one exceptional running back would demote every other
 * player in the league by a tier.
 *
 * THE ANCHOR IS THE LEAGUE'S OWN STARTING JOBS. Take every player who ranks
 * inside his position's structural demand, across all positions. In a
 * twelve-team league starting 1QB/2RB/3WR/1TE/1K/1DEF with two flexes that is
 * about 120 players: precisely the set of jobs this league hands out each
 * week. Their WAR values are the distribution of what a starting job is worth
 * HERE, and a tier is a percentile within it:
 *
 *   League breaker    top 2% of the league's starting jobs
 *   Elite             top 10%
 *   Strong advantage  top 25%
 *   Starter           at least as valuable as the least valuable starting job
 *
 * That scales the way it has to. More teams means more starting jobs, so the
 * percentiles hold. Superflex adds a dozen quarterback jobs, so quarterbacks
 * rise into the top bands on their own without a positional special case. A
 * shorter remaining window shrinks every WAR together, and percentiles do not
 * notice. And every boundary is a sentence a reader can check against the
 * table in front of them.
 *
 * THE TWO BOTTOM TIERS ARE STRUCTURAL, NOT PERCENTILE. Percentiles describe
 * the starters; below them the question is not "where does he rank" but "is he
 * better than the player anybody could pick up", and the curve already carries
 * both numbers to answer it:
 *
 *   Replacement level  positive WAR, but below the league's least valuable
 *                      starting job. Useful depth, not an edge.
 *   Below replacement  projects for fewer points a week than replacement
 *                      level does. Starting him costs you.
 *
 * WHY "BELOW REPLACEMENT" READS PROJECTED POINTS RATHER THAN WAR. WAR is
 * floored at zero by default (see clampBelowReplacement in
 * ./default-settings.ts for why that floor stays), so it cannot distinguish a
 * player who is exactly replacement level from one who is far under it. The
 * two per-week figures on the curve point can, they are the model's own
 * numbers, and they are on the same screen for the reader to check.
 */

import type { PlottableCurve, WarCurvePoint } from "./types";

export type WarTier =
  | "league-breaker"
  | "elite"
  | "strong"
  | "starter"
  | "replacement"
  | "below";

/** Every tier, best first. The order a legend or a filter should list them in. */
export const WAR_TIERS: readonly WarTier[] = [
  "league-breaker",
  "elite",
  "strong",
  "starter",
  "replacement",
  "below",
] as const;

/** The visible label. Sentence case: these sit in a table cell, not a heading. */
export const WAR_TIER_LABEL: Record<WarTier, string> = {
  "league-breaker": "League breaker",
  elite: "Elite",
  strong: "Strong advantage",
  starter: "Starter",
  replacement: "Replacement level",
  below: "Below replacement",
};

/**
 * One sentence per tier, in plain language, for the tier legend and for the
 * accessible description a screen reader hears alongside the badge.
 *
 * No percentages in the reader-facing text for the top three: "the top 2% of
 * the starting jobs in this league" is precise and unreadable. The percentile
 * is the rule; the sentence is what it means.
 */
export const WAR_TIER_MEANING: Record<WarTier, string> = {
  "league-breaker": "Among the two or three most valuable players in this league.",
  elite: "Worth more than nine in ten of the players this league starts.",
  strong: "Worth more than three quarters of the players this league starts.",
  starter: "Worth as much as the players this league already starts.",
  replacement: "Useful depth, but no better than a player who is freely available.",
  below: "Projects for fewer points than a freely available player at the same position.",
};

/**
 * The four cut points, computed once per league from its own starting jobs.
 *
 * Null when the league has no starting job with a real WAR to measure against,
 * which happens before a league's first computation and for a season with
 * nothing left to play. Every player then falls to one of the two structural
 * tiers, which are the only two that do not need this.
 */
export type WarTierScale = {
  /** Top 2% of starting jobs. */
  leagueBreaker: number;
  /** Top 10%. */
  elite: number;
  /** Top 25%. */
  strong: number;
  /** The least valuable starting job in the league. */
  starter: number;
  /** How many starting jobs the scale was built from. Named in the legend. */
  starterCount: number;
};

/**
 * A WAR small enough that it rounds to 0.00 at the two decimals every surface
 * prints. A player at 0.004 is displayed as "0.00", so calling him a starter
 * because the raw float is above some threshold would contradict the number
 * next to the badge.
 */
const DISPLAY_ZERO = 0.005;

/**
 * The p-th percentile of an ascending array, by the nearest-rank method.
 *
 * Nearest rank rather than interpolation because the answer has to be a WAR a
 * real player in this league actually has: the boundary is quoted back to the
 * reader as "worth more than nine in ten of the players this league starts",
 * and an interpolated value is not any player's.
 */
function percentile(ascending: number[], p: number): number {
  if (ascending.length === 0) return 0;
  const index = Math.min(ascending.length - 1, Math.max(0, Math.ceil(p * ascending.length) - 1));
  return ascending[index];
}

/**
 * Build the league's tier scale from the WAR of every player who ranks inside
 * his position's structural demand.
 *
 * Structural demand rather than a weekly seated count, for the same reason
 * everything else user-facing uses it (see lib/positional-war/engine.ts): it
 * is one integer per position, it does not wobble with byes, and "this league
 * starts 28 running backs" is a sentence a reader can check.
 */
export function buildTierScale(curves: readonly PlottableCurve[]): WarTierScale | null {
  const starterWars: number[] = [];
  for (const curve of curves) {
    for (const point of curve.curve) {
      if (point.positionRank > curve.structuralDemand) continue;
      starterWars.push(point.war);
    }
  }
  if (starterWars.length === 0) return null;

  starterWars.sort((a, b) => a - b);
  const scale: WarTierScale = {
    leagueBreaker: percentile(starterWars, 0.98),
    elite: percentile(starterWars, 0.9),
    strong: percentile(starterWars, 0.75),
    starter: starterWars[0],
    starterCount: starterWars.length,
  };

  // A league whose starting jobs are all worth nothing (no projections yet, a
  // window with one week left and every position flat) has no ladder to climb.
  // Reporting one would put a "League breaker" badge on a 0.00.
  if (scale.leagueBreaker <= DISPLAY_ZERO) return null;
  return scale;
}

/** Just enough of a curve point to tier it. */
export type TierablePoint = Pick<
  WarCurvePoint,
  "war" | "projectedPointsPerWeek" | "replacementPointsPerWeek"
>;

/**
 * Which tier a player falls in.
 *
 * Checked best-first, so a player above a percentile boundary takes the higher
 * band even if his projected points sit under replacement. That ordering
 * matters: a player who is below replacement on AVERAGE but well above it in
 * most weeks (a boom-and-bye profile) earns real WAR, and the tier should
 * report the wins, not the average.
 */
export function tierFor(point: TierablePoint, scale: WarTierScale | null): WarTier {
  if (scale) {
    if (point.war >= scale.leagueBreaker) return "league-breaker";
    if (point.war >= scale.elite) return "elite";
    if (point.war >= scale.strong) return "strong";
    if (point.war >= scale.starter && point.war > DISPLAY_ZERO) return "starter";
  }
  if (point.projectedPointsPerWeek < point.replacementPointsPerWeek) return "below";
  return "replacement";
}

/**
 * The one sentence explaining the ladder, for the legend under the table.
 *
 * Names the count it was built from, because "the players this league starts"
 * is the whole basis of the scale and a number makes it checkable.
 */
export function describeTierScale(scale: WarTierScale | null): string {
  if (!scale) {
    return "Tiers need a calculated curve. Nothing to rank yet.";
  }
  return `Tiers compare each player against the ${scale.starterCount} starting jobs this league hands out every week.`;
}
