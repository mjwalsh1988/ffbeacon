/**
 * What the board recommends bidding, and what it is allowed to claim.
 *
 * ONE ENGINE. Every figure here comes from
 * `lib/faab/calculate-faab.ts calculateFaabRecommendation`, the same function
 * the FAAB calculator runs, with the same admin-edited settings row behind it.
 * A second implementation would put an article and a tool on the same site
 * quoting different prices for the same player with nothing to say which is
 * right, which is the failure this whole codebase keeps designing against.
 *
 * WHAT IT CANNOT KNOW, STATED RATHER THAN PAPERED OVER. The calculator's real
 * answer depends on the reader's roster: whether this player would start, who
 * would come off for him, what the rivals bidding against them have left. A
 * public page has none of that. So the board prices a STANDARD LEAGUE, names
 * it in `BoardAssumptions`, prints it on the page, and links to the calculator
 * for the reader's own. The number is honest about being a starting point.
 *
 * THE BUDGET IS $100 BECAUSE THAT MAKES DOLLARS AND PERCENTAGES THE SAME
 * NUMBER. A $12 bid in a $100 league and a $120 bid in a $1,000 league are the
 * same decision, and the calculator works in shares of the remaining budget
 * throughout. Passing 100 means the row can print "$12" and "12% of what you
 * have left" without computing anything twice or rounding them apart.
 *
 * Pure: takes settings and plain numbers, returns plain numbers.
 */

import { calculateFaabRecommendation } from "@/lib/faab/calculate-faab";
import type { FaabPoolEntry, FaabSettings } from "@/lib/faab/types";
import type { BoardBid } from "./types";

/**
 * The league the board prices for, in one place.
 *
 * Twelve teams and nine offensive starters is the most common Sleeper
 * configuration and the one the calculator's own defaults assume. The budget is
 * the standard $100. None of this is guessed at render time: it is a constant a
 * reader can see on the page and disagree with.
 */
export const STANDARD_LEAGUE = {
  teams: 12,
  offensiveStarters: 9,
  budget: 100,
} as const;

/**
 * Where a player has to sit before we stop calling him available.
 *
 * Not 100. A player rostered everywhere is not a waiver claim, and a board that
 * listed him would be a ranking page with the wrong title. Not 20 either: a
 * player rostered in half the leagues is genuinely free in the other half, and
 * those readers are the ones a waiver page is for. Seventy is where the list
 * stops being about the wire.
 */
export const AVAILABILITY_CEILING_PCT = 70;

/**
 * Price one claim.
 *
 * `needLevel` is fixed at medium and that is deliberate. Need is the reader's
 * own fact (a manager whose starting running back tore an ACL on Sunday has a
 * different need from one who is nine and nothing), and guessing it for a
 * stranger would swing the number by a third for no reason anybody could
 * inspect. Medium is the neutral setting, the page says so, and the calculator
 * asks the question properly.
 */
export function boardBid(params: {
  overallRank: number;
  positionRank: number;
  value: number | null;
  settings: FaabSettings;
  playerPool: FaabPoolEntry[];
}): BoardBid {
  const result = calculateFaabRecommendation({
    player: {
      overallRank: params.overallRank,
      positionRank: params.positionRank,
      value: params.value,
    },
    remainingBudget: STANDARD_LEAGUE.budget,
    needLevel: "medium",
    teams: STANDARD_LEAGUE.teams,
    offensiveStarters: STANDARD_LEAGUE.offensiveStarters,
    settings: params.settings,
    playerPool: params.playerPool,
  });

  return {
    lowPct: result.lowBid,
    highPct: result.highBid,
    tierLabel: result.tierLabel,
    isDumpCandidate: result.isDumpCandidate,
  };
}

/**
 * The last startable player at a position, in a league of this size.
 *
 * Walks the position's projections high to low and reads the one sitting where
 * the league runs out of starting spots. Everything above him is an upgrade
 * over what a manager can already field; everything below him is a bench
 * player with a good week, which is a different purchase.
 *
 * The starter counts come from the same admin-edited
 * `settings.manualReplacement` block the calculator's no-league mode uses, so
 * the two agree about where replacement level is by construction.
 *
 * Returns null when the position has fewer projected players than the league
 * needs starters, which happens for kickers and defenses in a week with byes.
 * Null is the right answer there: we cannot say what the last startable one
 * scores if we cannot see him.
 */
export function replacementPoints(
  sortedDescending: number[],
  replacementRank: number | null,
): number | null {
  if (replacementRank == null || replacementRank < 1) return null;
  if (sortedDescending.length === 0) return null;
  const index = Math.min(replacementRank - 1, sortedDescending.length - 1);
  const value = sortedDescending[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
