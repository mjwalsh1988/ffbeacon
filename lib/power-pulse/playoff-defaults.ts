/**
 * What to assume about a league's bracket when Sleeper has not told us.
 *
 * ONE NUMBER, THREE READERS, AND THEY ALL HAVE TO AGREE. Sleeper writes
 * `playoff_teams: 0`, or omits it entirely, on a league whose bracket has not
 * been configured, so something has to be assumed. Three places assume it and
 * they are all visible on the same screen:
 *
 *   - lib/power-pulse/load.ts, which feeds the Monte Carlo season, so this is
 *     the field every playoff percentage on the page was simulated against.
 *   - app/leagues/[league_id]/power-pulse/page.tsx, which draws the visible cut
 *     line across the Projected standings table.
 *   - lib/league-team-status.ts, which draws the Contender and Bubble cut lines
 *     for the tag beside a team's name.
 *
 * They disagreed once. The status tag assumed half the league while the other
 * two assumed a flat six, which is the same answer only at 11, 12 and 13 teams.
 * All nine live leagues with no configured bracket are 13 to 18 teams, so in
 * every one of them the tag called rank 11 a Bubble team on a page whose own
 * table said the top 6 make the playoffs. Splitting the constant out is what
 * stops that happening again quietly.
 *
 * Deliberately a plain module with no imports and no `server-only`, so the
 * client-safe classifier can read it without pulling in a Supabase client.
 */

/** Sleeper's own default bracket size. A flat count, never a share of the league. */
export const DEFAULT_PLAYOFF_TEAMS = 6;

/** Sleeper's own default first playoff week. */
export const DEFAULT_PLAYOFF_WEEK_START = 15;

/**
 * The league's own first playoff week, read off its stored Sleeper object.
 *
 * Sleeper writes `playoff_week_start: 0` on a league whose bracket has not been
 * set up, and zero is a number, so a plain `?? 15` never fires. A cut line drawn
 * at week zero marks every week of the season a playoff week, which looks like a
 * deliberate answer and is not one. Anything at or below zero is an unset field.
 *
 * Five pages carried their own copy of this until the Leaderboards section
 * needed a sixth.
 */
export function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : DEFAULT_PLAYOFF_WEEK_START;
}
