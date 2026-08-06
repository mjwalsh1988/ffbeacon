/**
 * The calculator without a league connected.
 *
 * League mode can ask the exact question ("what does he add to YOUR lineup")
 * because it has your roster. Without one we cannot know whether he displaces
 * your WR2 or rots on your bench. But the old fallback, ranking him and reading
 * a bid off a curve, throws away everything we actually know about him.
 *
 * So this asks the closest answerable question: what does he add over the
 * player you could already start? That is replacement level, and it is
 * computable from projections alone. Rank every player at his position by
 * projected points a week, walk down to the spot where a league of this size
 * runs out of starters, and the gap between him and that player is what you are
 * really buying. A WR projected for 12 in a league where the last startable WR
 * projects 11 is worth almost nothing; the same 12 in a league where
 * replacement is 6 is a real add.
 *
 * This scales with league size and starter count by construction, which is what
 * the old depth multipliers were approximating by hand.
 *
 * Pure. The position curve arrives already sorted from the server.
 */

import type { ManualReplacementSettings, MarginalValue, MarginalWeek } from "./types";

/** Positions we can find a replacement level for. */
export type ManualPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export type ManualMarginalInput = {
  position: string;
  /** His own projected points a week over the rest of the regular season. */
  projectedPointsPerWeek: number | null;
  /**
   * Every player at his position, projected points a week, sorted high to low.
   * Index i holds the (i+1)th best, so the replacement rank indexes straight in.
   */
  positionCurve: number[];
  teams: number;
  offensiveStarters: number;
  weeksRemaining: number;
  /** Opponent detail per remaining week, for the matchup read. */
  weeks: MarginalWeek[];
  settings: ManualReplacementSettings;
};

export type ManualMarginalResult = {
  marginal: MarginalValue | null;
  /** Where replacement level landed, so the UI can explain the number. */
  replacementRank: number | null;
  replacementPointsPerWeek: number | null;
  /** True when he projects below the last startable player at his position. */
  isBelowReplacement: boolean;
};

/**
 * How many of this position a league starts, in total across every team.
 *
 * The shape is admin-editable rather than hardcoded because leagues differ, and
 * it scales with the starter count the reader entered: a 12-starter league runs
 * deeper at every position than a 7-starter one, so replacement level has to
 * move with it. Kickers and defenses are the exception and stay flat at one per
 * team, because no league starts two of either no matter how deep it gets.
 */
export function replacementRankFor(
  position: string,
  teams: number,
  offensiveStarters: number,
  settings: ManualReplacementSettings,
): number | null {
  const key = position.toUpperCase() as ManualPosition;
  const perTeam = settings.startersPerTeam[key];
  if (perTeam === undefined) return null;

  const scaled = settings.flatPositions.includes(key)
    ? perTeam
    : perTeam * (offensiveStarters / Math.max(1, settings.baselineStarters));

  return Math.max(1, Math.round(teams * scaled));
}

/** The projection at a given rank, falling off the end of the curve gracefully. */
function pointsAtRank(curve: number[], rank: number): number | null {
  if (curve.length === 0) return null;
  const index = Math.min(curve.length, Math.max(1, rank)) - 1;
  return curve[index] ?? curve[curve.length - 1] ?? null;
}

export function computeManualMarginal(
  input: ManualMarginalInput,
): ManualMarginalResult {
  const {
    projectedPointsPerWeek: projected,
    positionCurve,
    teams,
    offensiveStarters,
    settings,
  } = input;

  const replacementRank = replacementRankFor(
    input.position,
    teams,
    offensiveStarters,
    settings,
  );

  if (projected === null || replacementRank === null || positionCurve.length === 0) {
    return {
      marginal: null,
      replacementRank,
      replacementPointsPerWeek: null,
      isBelowReplacement: false,
    };
  }

  const replacementPoints = pointsAtRank(positionCurve, replacementRank);
  if (replacementPoints === null) {
    return {
      marginal: null,
      replacementRank,
      replacementPointsPerWeek: null,
      isBelowReplacement: false,
    };
  }

  const added = projected - replacementPoints;
  const weeksConsidered = Math.max(0, input.weeks.length || input.weeksRemaining);

  // Below replacement is a real answer, and the honest one. A player who does
  // not beat what is already sitting on the wire is not an upgrade, and saying
  // so is more useful than quoting him a percentage of the budget.
  const isBelowReplacement = added <= 0;
  const netPointsPerWeek = Math.max(0, added);

  const marginal: MarginalValue = {
    weeksConsidered,
    // Without a roster we cannot say which weeks he starts, only that a player
    // above replacement is startable. Reporting every week rather than a
    // guessed subset keeps the figure honest about what it does and does not know.
    weeksStarting: isBelowReplacement ? 0 : weeksConsidered,
    pointsPerWeek: netPointsPerWeek,
    pointsPerStartedWeek: netPointsPerWeek,
    netPointsPerWeek,
    expectedWinsAdded: null,
    playoffOddsBefore: null,
    playoffOddsAfter: null,
    titleOddsBefore: null,
    titleOddsAfter: null,
    weeks: input.weeks,
    dropCost: null,
    isBenchOnly: isBelowReplacement,
  };

  return {
    marginal,
    replacementRank,
    replacementPointsPerWeek: replacementPoints,
    isBelowReplacement,
  };
}
