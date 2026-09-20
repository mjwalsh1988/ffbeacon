/**
 * Why this number.
 *
 * Three to five one-line reasons under every bid, each citing a figure that is
 * on the same screen. Deterministic templates, never a language model: a
 * reader has to be able to check every sentence against the numbers beside it,
 * and a generated sentence is exactly the kind that sounds right and cannot be
 * checked. A figure we do not have means the reason does not fire, rather than
 * a reason hedged into meaninglessness.
 *
 * Ordered by effect size, so the first line is the biggest thing driving the
 * bid rather than whichever fact happened to be cheap to compute.
 *
 * Pure.
 */

export type ReasonInput = {
  /** Rivals whose lineup he would crack. */
  interestedRivals: number | null;
  /** How many of those have a starter out at his position this week. */
  rivalsWithStarterOut?: number | null;
  /** Points a week he adds over the current lineup. */
  netPointsPerWeek: number | null;
  /** The player being cut to make room, when one is needed. */
  dropName?: string | null;
  /** True when playoff weeks were counted in the points figure. */
  includesPlayoffWeeks?: boolean;
  playoffOddsBefore?: number | null;
  playoffOddsAfter?: number | null;
  /** Chopped leagues: the chance of being chopped this week, as percentages. */
  choppedBefore?: number | null;
  choppedAfter?: number | null;
  /** The league's own price level against the wider market. */
  heat?: number | null;
  heatSamples?: number | null;
  /** Dollars. */
  richestRivalBudget?: number | null;
  yourBudget?: number | null;
  /** What the time of season does to prices. 1 is neutral. */
  calendarMultiplier?: number | null;
  currentWeek?: number | null;
  /** The teammate whose absence created the opening. */
  teammateName?: string | null;
  teammateStatus?: string | null;
  /** Dynasty blend: how much of the bid comes from long-term value. */
  dynastyBlendWeight?: number | null;
  dynastyValuePct?: number | null;
  pointsWorthPct?: number | null;
  /** Chopped money. */
  aliveCount?: number | null;
  moneyLeftInLeague?: number | null;
  yourShareOfMoney?: number | null;
};

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function one(n: number): string {
  return n.toFixed(1);
}

/** Each returns a sentence or null. Null means we do not have the figure. */
const TEMPLATES: Array<(r: ReasonInput) => string | null> = [
  // Rivals first: the single biggest driver of what a claim costs.
  (r) => {
    if (r.interestedRivals === null || r.interestedRivals === undefined) return null;
    if (r.interestedRivals === 0) return "Nobody else would start him.";
    const teams = r.interestedRivals === 1 ? "1 team" : `${r.interestedRivals} teams`;
    const withOut = r.rivalsWithStarterOut ?? 0;
    return withOut > 0
      ? `${teams} would start him, ${withOut} of them with a starter out.`
      : `${teams} would start him.`;
  },

  // The upgrade itself.
  (r) => {
    if (r.netPointsPerWeek === null || r.netPointsPerWeek === undefined) return null;
    const over = r.dropName ? r.dropName : "your current lineup";
    const playoffs = r.includesPlayoffWeeks ? ", playoffs included" : "";
    return `Adds ${one(r.netPointsPerWeek)} points a week over ${over}${playoffs}.`;
  },

  // What it does to the season. Chopped leagues answer a different question,
  // and must never be told about playoff odds they do not have.
  (r) => {
    // A line that prints the same number twice ("from 2% to 2%") is worse
    // than no line: it looks like a broken calculator and it takes the place
    // of a reason that would have told the reader something.
    if (r.choppedBefore != null && r.choppedAfter != null) {
      if (Math.round(r.choppedBefore) === Math.round(r.choppedAfter)) {
        return `He barely moves your chance of being chopped this week, which sits at ${pct(r.choppedBefore)}.`;
      }
      return `Cuts your chance of being chopped this week from ${pct(r.choppedBefore)} to ${pct(r.choppedAfter)}.`;
    }
    if (r.playoffOddsBefore != null && r.playoffOddsAfter != null) {
      if (Math.round(r.playoffOddsBefore) === Math.round(r.playoffOddsAfter)) {
        return `Your playoff odds stay at ${pct(r.playoffOddsBefore)} either way.`;
      }
      return `Playoff odds ${pct(r.playoffOddsBefore)} to ${pct(r.playoffOddsAfter)}.`;
    }
    return null;
  },

  // Chopped money.
  (r) => {
    if (r.aliveCount == null || r.moneyLeftInLeague == null || r.yourShareOfMoney == null) {
      return null;
    }
    return `${r.aliveCount} teams left, holding ${r.moneyLeftInLeague} between them; you hold ${pct(r.yourShareOfMoney * 100)}.`;
  },

  // The room's own price level, but only when we have seen enough of it and
  // the difference is big enough to change a bid.
  (r) => {
    if (r.heat == null || (r.heatSamples ?? 0) < 10) return null;
    if (Math.abs(r.heat - 1) < 0.15) return null;
    return r.heat > 1
      ? `Your league pays ${r.heat.toFixed(1)} times the usual price for contested adds.`
      : `Your league pays ${r.heat.toFixed(1)} times the usual price for contested adds, so this one is cheaper than most.`;
  },

  // Who can outbid you.
  (r) => {
    if (r.richestRivalBudget == null || r.yourBudget == null) return null;
    return r.richestRivalBudget > r.yourBudget
      ? `The richest rival holds ${r.richestRivalBudget}; you hold ${r.yourBudget}.`
      : `You hold ${r.yourBudget}, and nobody left in the league can outbid you.`;
  },

  // The teammate whose absence made the opening.
  (r) => {
    if (!r.teammateName || !r.teammateStatus) return null;
    return `His starter, ${r.teammateName}, is ${r.teammateStatus.toLowerCase()}.`;
  },

  // Time of season.
  (r) => {
    if (r.calendarMultiplier == null || Math.abs(r.calendarMultiplier - 1) < 0.01) return null;
    const week = r.currentWeek ?? 0;
    if (week >= 14) return "From week 14 leftover FAAB buys nothing.";
    if (r.calendarMultiplier > 1) return "Weeks 2 to 6 are the busiest bidding of the season.";
    return "The middle of the season is the cheapest stretch to buy in.";
  },

  // The dynasty half of the answer.
  (r) => {
    if (r.dynastyBlendWeight == null || r.dynastyBlendWeight < 0.3) return null;
    if (r.dynastyValuePct == null || r.pointsWorthPct == null) return null;
    if (r.dynastyValuePct <= r.pointsWorthPct) return null;
    return "In a dynasty league his long-term value adds to the bid.";
  },
];

/** Three to five lines, biggest effect first, no invented figures. */
export function buildReasons(input: ReasonInput, max = 5): string[] {
  const out: string[] = [];
  for (const template of TEMPLATES) {
    const line = template(input);
    if (line) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}
