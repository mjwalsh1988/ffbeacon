/**
 * Where the NFL season sits, read from stored data rather than Sleeper.
 *
 * NO SLEEPER CALL ON THE NORMAL PATH. Resolving "what week is it" through
 * Sleeper's state endpoint would put an external fetch on a public page's
 * critical path. We already store everything needed to answer it: the newest
 * projected season, the newest season anybody played, and the kickoff time of
 * every game on the slate. All are indexed lookups. Sleeper (memoised for 60
 * seconds in lib/sleeper.ts) is read only when the kickoff calendar is empty.
 *
 * Moved out of lib/breakdown/load-extras.ts so lib/start-sit/load.ts can read
 * the clock without importing the whole Breakdown extras module. load-extras.ts
 * re-exports resolveSeasonClock and SeasonClock so its existing importers keep
 * working unchanged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { Database } from "@/lib/database.types";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";
import {
  REGULAR_SEASON_WEEKS,
  liveWeekFromKickoffs,
  loadLastKickoffByWeek,
} from "@/lib/nfl-week";
import { getNflState } from "@/lib/sleeper";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Where the season sits, derived from our own tables. */
export type SeasonClock = {
  season: number | null;
  /**
   * The live week: week N until 11:59 PM Eastern on the day of its last
   * kickoff (the Monday night game), then N + 1. 1 in the preseason, 19 once
   * the regular season is over.
   */
  currentWeek: number;
  /** The newest season that has graded games, for the reliability read. */
  gradedSeason: number | null;
};

/**
 * Where we are in the NFL calendar, read from stored data rather than Sleeper.
 *
 * `season` is the newest season we hold regular-season projections for.
 *
 * `currentWeek` comes from the kickoff calendar (lib/nfl-week.ts). It used to
 * be one past the newest week anybody had a completed game in, which is right
 * only for the Monday game: Thursday night's box scores made every page on
 * this clock describe NEXT week from Thursday to Tuesday. A played game is not
 * the end of a week; the last kickoff's day ending is.
 */
async function resolveSeasonClockUncached(
  supabase: AnySupabase,
  nowMs: number = Date.now(),
): Promise<SeasonClock> {
  const db = supabase as SupabaseClient<Database>;

  // SLEEPER_SOURCE, deliberately and permanently. This asks which season we
  // hold projections FOR, and Sleeper is the coverage baseline every other
  // source is measured against (see availableProjectionSources in
  // lib/projections/source.ts): our own builder mirrors Sleeper's rows rather
  // than adding seasons of its own. Reading unfiltered would return the same
  // answer through twice the rows, and reading the resolved source would make
  // "what season is it" depend on a switch that is about how a number is
  // computed rather than about which weeks exist.
  const { data: projSeason } = await db
    .from("player_weekly_projections")
    .select("season")
    .eq("season_type", "regular")
    .eq("source", SLEEPER_SOURCE)
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();

  const season = projSeason ? Number(projSeason.season) : null;

  const { data: statSeason } = await db
    .from("player_stats")
    .select("season")
    .eq("season_type", "regular")
    .gt("gp", 0)
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();

  const gradedSeason = statSeason ? Number(statSeason.season) : null;

  if (season == null) return { season: null, currentWeek: 1, gradedSeason };

  const calendarWeek = liveWeekFromKickoffs(await loadLastKickoffByWeek(db, season), nowMs);
  if (calendarWeek !== null) return { season, currentWeek: calendarWeek, gradedSeason };

  return { season, currentWeek: await sleeperWeekFallback(season), gradedSeason };
}

/**
 * Only when we hold no kickoff times for the season. Sleeper's week follows
 * the same Monday-night boundary. Never the played-games rule: that is the
 * rule that flipped the site on Thursday nights.
 */
async function sleeperWeekFallback(season: number): Promise<number> {
  const state = await getNflState();
  if (!state) return 1;
  const stateSeason = Number(state.season);
  if (Number.isFinite(stateSeason) && stateSeason !== season) {
    return stateSeason > season ? REGULAR_SEASON_WEEKS + 1 : 1;
  }
  if (state.season_type === "regular") {
    return Math.max(1, Math.min(REGULAR_SEASON_WEEKS, Number(state.week) || 1));
  }
  if (state.season_type === "post") return REGULAR_SEASON_WEEKS + 1;
  return 1;
}

/**
 * Request-scoped: the page metadata, the page body, the start/sit loader and
 * the breakdown extras all ask for the clock in one render, and each call is
 * a handful of sequential reads, so they share one result per request (React
 * cache keys on the client instance, which createAdminClient already caches).
 */
export const resolveSeasonClock = cache(resolveSeasonClockUncached);
