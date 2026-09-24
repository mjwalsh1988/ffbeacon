/**
 * The one line under the profile's game log heading (plan IDP-128).
 *
 * The fallback branch used to say "the next season's schedule has not been
 * published yet" for ANY player with no projection rows. That is true in the
 * spring. In week 3 it is false, and it was the line every defender got, since
 * no projection rows existed for defenders at all. Pure, so the three cases
 * are tested without rendering the panel.
 */
export function gameLogHelper(input: {
  /** The season the log shows. */
  season: number;
  /** True when the log fell back to the newest season with stats (no projections held). */
  isFallback: boolean;
  /** True when a later season than `season` already has a published schedule. */
  laterSeasonScheduled: boolean;
}): string {
  const { season, isFallback, laterSeasonScheduled } = input;
  if (!isFallback) return `${season} week by week, with the rest of the schedule and each week's opponent.`;
  if (laterSeasonScheduled) return `${season} week by week. No upcoming games are projected for this player.`;
  return `${season} week by week. This is last season: the ${season + 1} schedule has not been published yet.`;
}
