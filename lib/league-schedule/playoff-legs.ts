/**
 * Two-week playoff rounds.
 *
 * Sleeper's `playoff_round_type`: 0 is one week per round, 1 is a two-week
 * championship only, 2 is two weeks for every round. In a two-week round the
 * same two teams play both weeks and the round goes to the higher combined
 * score, so a result read off one week alone can name the wrong winner. Every
 * surface that reports a playoff result (the Schedule board, the Lineups recap,
 * the Leaderboards games) asks this module which weeks belong together. Pure.
 */

export type PlayoffShape = {
  /** First playoff week. Null for a league with no bracket (chopped). */
  playoffWeekStart: number | null;
  /** Sleeper's playoff_round_type, 0 when unset. */
  playoffRoundType: number;
  /** Teams in the bracket, which sets how many rounds there are. */
  playoffTeams: number;
};

/** How many rounds a bracket of this size plays. */
export function playoffRoundCount(playoffTeams: number): number {
  if (!Number.isFinite(playoffTeams) || playoffTeams < 2) return 1;
  return Math.ceil(Math.log2(playoffTeams));
}

/**
 * The weeks of the playoff round `week` falls in, in order. One week for an
 * ordinary round, two for a two-week round, and null for a regular season week
 * or a league with no bracket.
 */
export function playoffRoundWeeks(week: number, shape: PlayoffShape): number[] | null {
  const start = shape.playoffWeekStart;
  if (start === null || !Number.isFinite(start) || week < start) return null;
  const rounds = playoffRoundCount(shape.playoffTeams);
  let cursor = start;
  for (let round = 1; round <= rounds; round += 1) {
    const twoWeeks =
      shape.playoffRoundType === 2 || (shape.playoffRoundType === 1 && round === rounds);
    const length = twoWeeks ? 2 : 1;
    if (week < cursor + length) {
      return Array.from({ length }, (_, i) => cursor + i);
    }
    cursor += length;
  }
  // Past the last round: consolation weeks, one at a time.
  return [week];
}

/**
 * Which leg of its round a week is: 1 or 2 in a two-week round, null in an
 * ordinary one or outside the playoffs.
 */
export function playoffLeg(week: number, shape: PlayoffShape): 1 | 2 | null {
  const weeks = playoffRoundWeeks(week, shape);
  if (!weeks || weeks.length < 2) return null;
  return weeks[0] === week ? 1 : 2;
}

/** The other week of a two-week round, or null. */
export function otherLegWeek(week: number, shape: PlayoffShape): number | null {
  const weeks = playoffRoundWeeks(week, shape);
  if (!weeks || weeks.length < 2) return null;
  return weeks[0] === week ? weeks[1] : weeks[0];
}
