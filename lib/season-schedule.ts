/**
 * When each team plays, for one season.
 *
 * WHY THIS EXISTS. The player profile's weekly game log used to render only the
 * weeks a player had a stat line for, so a current season showed three rows in
 * week 4 and the fourteen weeks still to come were simply absent. A reader
 * could not tell a bye from a week that had not happened from a week we had
 * failed to sync. Showing every week needs two things this module supplies:
 * who the team plays, and when that game kicks off.
 *
 * WHERE THE DATA COMES FROM. `nfl_game_odds`, which the odds sync already
 * populates weekly and which carries `kickoff_at` per game. It is the only
 * table on the site with a real kickoff timestamp: `player_weekly_projections`
 * has a `game_id`, but Sleeper's is an opaque identifier rather than a date.
 *
 * WHAT IT IS NOT. Not a schedule of record. The odds feed covers the weeks a
 * book has priced, which in practice is the near future rather than all
 * eighteen, so a week with no row here is a week with no KNOWN kickoff, never
 * a week with no game. Every consumer treats a missing entry as unknown and
 * says so, rather than rendering an absence as a bye.
 *
 * The opponent still comes from the projections, which cover the full slate.
 * This adds the clock and nothing else.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { ODDS_SOURCE_SLUG } from "@/lib/nfl-game-environment";

/** Kickoff times for one season, keyed `${week}|${TEAM}`. */
export type SeasonKickoffs = Record<string, string>;

export function kickoffKey(week: number, team: string | null | undefined): string | null {
  const code = (team ?? "").trim().toUpperCase();
  if (!code) return null;
  return `${week}|${code}`;
}

async function loadSeasonKickoffs(season: number): Promise<SeasonKickoffs> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("nfl_game_odds")
    .select("week, home_team, away_team, kickoff_at")
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("source", ODDS_SOURCE_SLUG)
    .not("kickoff_at", "is", null);

  // A plain object rather than a Map, because this crosses the server to
  // client boundary as a prop and a Map does not survive serialization.
  const out: SeasonKickoffs = {};
  if (error || !data) return out;

  for (const row of data) {
    const kickoff = row.kickoff_at;
    if (!kickoff) continue;
    const week = Number(row.week);
    if (!Number.isInteger(week)) continue;
    // Both sides of the same game share the one kickoff.
    for (const team of [row.home_team, row.away_team]) {
      const key = kickoffKey(week, team);
      // First row wins. A duplicate should be impossible under the table's
      // unique key, and a page must not fail to render because one exists.
      if (key && !out[key]) out[key] = kickoff;
    }
  }
  return out;
}

/** Memoized per season. The odds sync revalidates the tag it shares. */
export function loadSeasonKickoffsCached(season: number): Promise<SeasonKickoffs> {
  return unstable_cache(
    () => loadSeasonKickoffs(season),
    ["season-kickoffs", String(season)],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerProjections] },
  )();
}
