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

/**
 * One season's slate: when each team plays, and which weeks we hold at all.
 *
 * `weeksCovered` is what makes a BYE distinguishable from a hole in the data.
 * A team missing from week 7 means a bye only if we hold week 7 for OTHER
 * teams; if the feed has not reached that week yet, the same absence means
 * nothing. Without the second list the two are identical and a page would
 * confidently label an unsynced week as a bye.
 */
export type SeasonSchedule = {
  kickoffs: SeasonKickoffs;
  /** Weeks the feed holds at least one game for, ascending. */
  weeksCovered: number[];
};

export function kickoffKey(week: number, team: string | null | undefined): string | null {
  const code = (team ?? "").trim().toUpperCase();
  if (!code) return null;
  return `${week}|${code}`;
}

async function loadSeasonSchedule(season: number): Promise<SeasonSchedule> {
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
  const weeks = new Set<number>();
  if (error || !data) return { kickoffs: out, weeksCovered: [] };

  for (const row of data) {
    const kickoff = row.kickoff_at;
    if (!kickoff) continue;
    const week = Number(row.week);
    if (!Number.isInteger(week)) continue;
    weeks.add(week);
    // Both sides of the same game share the one kickoff.
    for (const team of [row.home_team, row.away_team]) {
      const key = kickoffKey(week, team);
      // First row wins. A duplicate should be impossible under the table's
      // unique key, and a page must not fail to render because one exists.
      if (key && !out[key]) out[key] = kickoff;
    }
  }
  return {
    kickoffs: out,
    weeksCovered: [...weeks].sort((a, b) => a - b),
  };
}

/**
 * The weeks this team is on bye, as far as the slate can say.
 *
 * A week counts only when the feed HOLDS that week and the team is not in it.
 * An unreached week yields nothing rather than a bye, which is the whole
 * reason `weeksCovered` exists.
 *
 * Returns an empty set for a team we cannot name. A profile with no team is
 * a free agent, and a free agent has no bye.
 */
export function byeWeeksFor(
  schedule: SeasonSchedule,
  team: string | null | undefined,
): Set<number> {
  const out = new Set<number>();
  const code = (team ?? "").trim().toUpperCase();
  if (!code) return out;
  for (const week of schedule.weeksCovered) {
    if (!schedule.kickoffs[`${week}|${code}`]) out.add(week);
  }
  return out;
}

/** Memoized per season. The odds sync revalidates the tag it shares. */
export function loadSeasonScheduleCached(season: number): Promise<SeasonSchedule> {
  return unstable_cache(
    () => loadSeasonSchedule(season),
    ["season-schedule", String(season)],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerProjections] },
  )();
}
