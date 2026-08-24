/**
 * The number that goes under the Contender / Bubble / Rebuilder tag, as data.
 *
 * The tag says which of three shapes a roster is. It does not say how close the
 * season is, and that is the thing a manager acts on: 2nd is a season worth
 * protecting, 6th is a season worth a trade. So each tag gets the figure that
 * answers its own question.
 *
 *   - Contender and Bubble get the projected finish. Ordered by
 *     expected wins (see lib/power-pulse/projected-order.ts), matching the
 *     Projected final standings table inside the league, so it is where we think
 *     the season ENDS rather than where the roster ranks today.
 *   - Rebuilder, and Longshot in a redraft league, gets what the roster is
 *     worth and where that sits in the league. Neither one is measured in wins,
 *     and printing a projected 11th next to that tag tells its owner nothing
 *     they did not choose.
 *
 * Every sentence names the measure it quotes ("by expected wins", "by roster
 * value"). The tag's own explanation quotes Power Pulse, and a hard schedule
 * pulls the two apart, so an unlabelled pair of ordinals in one breath reads as
 * a contradiction.
 *
 * Pure. The rendering, including which trophy colour a top-three finish gets,
 * lives in components/team-standing-figure.tsx. Same split as
 * lib/league-team-status.ts and components/team-status-badge.tsx.
 */

import { ordinal, type TeamStatusKey } from "@/lib/league-team-status";
import { formatValue } from "@/lib/format-value";

export type FigureInput = {
  statusKey: TeamStatusKey;
  /** Projected finish, 1 for the projected champion. */
  projectedSeed: number | null;
  /** How many teams that finish is out of, counting only teams Power Pulse
   *  scored. */
  rankedTeamCount: number | null;
  valueRank: number | null;
  totalValue: number | null;
  /**
   * False when the value came from a fallback rather than a row matching both
   * the league's own derived format and the reader's source. Unmatched leagues
   * (no format_config_id, about a fifth of them) can never match exactly.
   *
   * The number is shown either way; this only changes the wording, so a reader
   * is told when the figure is our closest match rather than an exact one.
   */
  valueIsExact: boolean;
  /** Teams in the league per Sleeper. The denominator for a value rank, which
   *  covers every roster, not only the ones Power Pulse could score. */
  leagueTeamCount: number;
};

/**
 * True when the rebuilder branch has a value figure to print.
 *
 * The bottom band shows value or it shows nothing useful. This used to also demand
 * an exact format-and-source match, which meant every Unmatched league quietly
 * showed a projected finish instead, and a projected finish is the single number
 * a rebuild is not measured by.
 */
export function hasValueFigure(input: FigureInput): boolean {
  return (
    input.statusKey === "rebuilder" &&
    input.totalValue != null &&
    Number.isFinite(Number(input.totalValue))
  );
}

/**
 * The figure as a sentence, for a row whose accessible name covers everything at
 * once (the public lists, where each row is a single link or button) and as the
 * screen-reader text inside the rendered figure.
 *
 * Returns an empty string when there is nothing to say, so callers can append it
 * unconditionally rather than branching.
 */
export function describeStandingFigure(input: FigureInput): string {
  if (hasValueFigure(input)) {
    const rankPart =
      input.valueRank != null
        ? `, ranked ${ordinal(input.valueRank)} of ${input.leagueTeamCount} by roster value`
        : "";
    // Says "roster value" twice on purpose. Heard on its own, next to a row that
    // also carries a projected finish, an ordinal with no measure attached is
    // exactly the thing a reader would misread as a finish.
    const caveat = input.valueIsExact
      ? ""
      : " This league's scoring does not match a format we carry values for, so this is our closest match.";
    return `Total roster value ${formatValue(input.totalValue)}${rankPart}.${caveat}`;
  }

  if (input.projectedSeed == null) return "";
  const ofPart = input.rankedTeamCount ? ` of ${input.rankedTeamCount}` : "";
  return `Projected to finish ${ordinal(input.projectedSeed)}${ofPart} by expected wins.`;
}
