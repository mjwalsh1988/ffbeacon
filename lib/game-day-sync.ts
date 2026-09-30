/**
 * What a game-day run of the weekly projections sync should refresh.
 *
 * The projections sync fires once a day at 12:00 UTC (the full remaining
 * slate) and, on Sundays, Mondays and Thursdays in season, several more times
 * around kickoff (PROJECTIONS_GAME_DAY_SCHEDULES in lib/cron-runs.ts). Those
 * extra runs exist for inactives and in-game injuries, and an injury moves the
 * live week and the next one, not week 17. Refetching all eighteen weeks five
 * extra times a game day would be about fifteen Sleeper calls and fifteen
 * thousand row rewrites a run for nothing, so a game-day run refreshes the live
 * week and the next one only: two calls. Pure, so the choice is testable.
 */

import { REGULAR_SEASON_LAST_WEEK } from "./sync-weekly-projections";

/** The UTC hour of the daily full-slate run. Must match vercel.json. */
export const DAILY_PROJECTIONS_UTC_HOUR = 12;

/** How many weeks past the live one a game-day run refreshes. */
export const GAME_DAY_WEEKS_AHEAD = 1;

export type ProjectionSyncWindow =
  /** Refresh everything the sync's own defaults choose. */
  | { scope: "full" }
  /** Refresh only these weeks of the live regular season. */
  | { scope: "near"; fromWeek: number; toWeek: number };

/**
 * The window for a run starting at `nowMs`, given Sleeper's live state.
 *
 * Full at the daily hour, and full whenever the live state is not a regular
 * season week we can name (preseason, off-season, a failed state read): a
 * narrowed run is an optimisation, and without a live week there is nothing to
 * narrow to safely.
 */
export function projectionSyncWindow(
  nowMs: number,
  state: { season_type?: string | null; week?: number | null } | null,
): ProjectionSyncWindow {
  if (new Date(nowMs).getUTCHours() === DAILY_PROJECTIONS_UTC_HOUR) return { scope: "full" };
  const week = Number(state?.week);
  if (state?.season_type !== "regular" || !Number.isInteger(week) || week < 1) {
    return { scope: "full" };
  }
  const fromWeek = Math.min(week, REGULAR_SEASON_LAST_WEEK);
  const toWeek = Math.min(fromWeek + GAME_DAY_WEEKS_AHEAD, REGULAR_SEASON_LAST_WEEK);
  return { scope: "near", fromWeek, toWeek };
}
