/**
 * Rebuilding `player_roster_rates`.
 *
 * The whole aggregate lives in the `refresh_player_roster_rates` SQL function
 * (migration 0292). This file is the thin caller the cron and the CLI share, so
 * there is exactly one place that decides WHICH seasons get rebuilt and what a
 * failure means.
 *
 * WHY IT IS NOT A PER-LEAGUE JOB. CLAUDE.md forbids wiring per-league
 * recomputation into a nightly cron. This iterates no league: it is one GROUP BY
 * over whatever rosters are stored, it makes no Sleeper request, and it writes
 * to no league's own rows. It sits beside the roster-exposure rebuild and the
 * FAAB priors rebuild in `/api/cron/recalculate-derived` for the same reason
 * those two do.
 *
 * WHICH SEASONS. The current one always, because that is the only one any
 * waiver board reads. The one before it as well, and only in the preseason
 * window where the current season has no leagues yet, so a board rendered in
 * August is not staring at an empty table. Older seasons are left exactly as
 * they were: nothing reads them, and rebuilding them would churn rows to
 * produce the same answer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type ServiceClient = SupabaseClient<Database>;

export type RosterRateRefreshResult = {
  season: number;
  written: number;
  error: string | null;
};

/** Rebuild one season. Never throws; the caller decides what a failure means. */
export async function refreshRosterRatesForSeason(
  admin: ServiceClient,
  season: number,
): Promise<RosterRateRefreshResult> {
  const { data, error } = await admin.rpc("refresh_player_roster_rates", {
    p_season: season,
  });
  if (error) {
    return { season, written: 0, error: error.message };
  }
  return { season, written: typeof data === "number" ? data : 0, error: null };
}

/**
 * The seasons worth rebuilding right now.
 *
 * Reads the newest season we actually hold leagues for and returns it, plus the
 * prior season when the newest one is still thin. "Thin" is fewer than
 * `MIN_LEAGUES_FOR_SEASON` leagues, which is the August state: a handful of
 * early adopters have synced next season's league and everybody else's rosters
 * still describe the one that just ended.
 */
const MIN_LEAGUES_FOR_SEASON = 25;

export async function seasonsToRefresh(admin: ServiceClient): Promise<number[]> {
  const { data, error } = await admin
    .from("leagues")
    .select("season")
    .order("season", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return [];

  const newest = Number(data[0].season);
  if (!Number.isInteger(newest)) return [];

  const { count } = await admin
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("season", newest);

  return (count ?? 0) >= MIN_LEAGUES_FOR_SEASON ? [newest] : [newest, newest - 1];
}

/** Rebuild every season worth rebuilding. Never throws. */
export async function refreshRosterRates(
  admin: ServiceClient,
): Promise<RosterRateRefreshResult[]> {
  const seasons = await seasonsToRefresh(admin);
  const out: RosterRateRefreshResult[] = [];
  for (const season of seasons) {
    out.push(await refreshRosterRatesForSeason(admin, season));
  }
  return out;
}
