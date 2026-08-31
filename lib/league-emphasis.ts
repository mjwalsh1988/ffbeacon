/**
 * Which number a league's readers actually came for.
 *
 * THE PROBLEM
 * Almost every surface here leads with asset value, because the product grew out
 * of dynasty tooling where "what is this worth" is the whole game. In a redraft
 * league it decides nothing. Nobody is holding a receiver through a rebuild;
 * there is no rebuild. Value still matters as a bargaining chip, so it is not
 * removed, but a redraft manager reading a rankings table wants to know who wins
 * games and is instead shown a column of trade values with the answer they came
 * for tucked in beside it.
 *
 * WHAT THIS IS NOT
 * It is not a feature flag and it does not hide anything. Both numbers appear on
 * every surface in every league, which the League Pulse rules already require.
 * This decides ORDER and LABEL: which one is the headline, which one is the
 * supporting line, and what the value column is called when it is not the point.
 *
 * Keeper leagues read as redraft. They price like redraft, they are drafted like
 * redraft, and a keeper list is a small dynasty asset attached to a redraft
 * season rather than the other way round.
 *
 * Pure, and deliberately free of any Sleeper or database type: it takes the
 * league category the rest of the site already computes.
 */

import type { LeagueCategoryKey } from "./league-category";

export type EmphasisMode = "wins" | "value";

export type LeagueEmphasis = {
  /** Which number leads. */
  mode: EmphasisMode;
  /** True when wins lead, so a caller can branch without comparing strings. */
  winsFirst: boolean;
  /**
   * What to call the asset-value column on this surface. In a dynasty league it
   * is a scoreboard; in a redraft league it is what you can get for someone, and
   * calling it a score invites a reader to treat it as one.
   */
  valueLabel: string;
  /** One line explaining the value column when it is not the headline. */
  valueHint: string;
};

const WINS_FIRST: LeagueEmphasis = {
  mode: "wins",
  winsFirst: true,
  valueLabel: "Trade leverage",
  valueHint:
    "What these players are worth in a deal. In a redraft league that is a bargaining position rather than a standing, so the table is ordered by projected wins.",
};

const VALUE_FIRST: LeagueEmphasis = {
  mode: "value",
  winsFirst: false,
  valueLabel: "Roster value",
  valueHint:
    "What this roster is worth, picks included. In a dynasty league it is the asset base every future season is built on.",
};

/**
 * Which number leads for this league.
 *
 * Dynasty and best-ball dynasty keep value first: the asset base outlives the
 * season and a reader is genuinely managing it. Redraft and best-ball redraft
 * lead with wins. An unknown category leads with wins, because a reader who
 * cannot be placed is better served by the number that is true in every format
 * than by one that is only meaningful in half of them.
 */
export function emphasisForCategory(
  category: LeagueCategoryKey | null,
): LeagueEmphasis {
  if (category === "dynasty" || category === "best-ball-dynasty")
    return VALUE_FIRST;
  return WINS_FIRST;
}

/**
 * The same answer from a plain dynasty flag, for the callers that only have one.
 *
 * On The Clock knows whether a format slug says dynasty long before it has a
 * Sleeper league object to categorise, and threading a category through every
 * one of those call sites to reach the same two-way branch would be churn.
 */
export function emphasisForDynastyFlag(isDynasty: boolean): LeagueEmphasis {
  return isDynasty ? VALUE_FIRST : WINS_FIRST;
}
