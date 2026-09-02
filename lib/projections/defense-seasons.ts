/**
 * Candidate seasons for an opponent-strength lookup, most recent first.
 *
 * The CALLER does not decide which of these has data. opponentMultiplier in
 * lib/power-pulse/project.ts walks them in order and takes the first two that
 * actually carry a usable row (a stored split that clears
 * settings.opponent.minGamesSampled). In the preseason nfl_defense_vs_position
 * has nothing for the season in progress yet, so the walk falls through to the
 * two prior seasons and the answer is identical to what a hardcoded
 * [season - 1, season - 2] used to return. From roughly week 8 on, the
 * current season has enough sampled games to be usable on its own, and it
 * takes the current-season slot without anyone here needing to know what week
 * it is.
 *
 * Pure. No clock, no I/O.
 */
export function defenseSeasonsFor(season: number): number[] {
  return [season, season - 1, season - 2];
}
