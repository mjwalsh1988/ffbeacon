/**
 * Where the NFL season sits, read from stored data rather than Sleeper.
 *
 * NO SLEEPER CALL. Resolving "what week is it" through Sleeper's state endpoint
 * would put an uncached external fetch on a public page's critical path. We
 * already store everything needed to answer it: the newest projected season, and
 * the newest week anybody actually played. Both are indexed lookups.
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

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Sleeper publishes an 18-week regular season. */
const MAX_WEEK = 18;

/** Where the season sits, derived from our own tables. */
export type SeasonClock = {
  season: number | null;
  /** The first week we have not seen a completed game for. 1 in the preseason. */
  currentWeek: number;
  /** The newest season that has graded games, for the reliability read. */
  gradedSeason: number | null;
};

/**
 * Where we are in the NFL calendar, read from stored data rather than Sleeper.
 *
 * `season` is the newest season we hold regular-season projections for.
 * `currentWeek` is one past the newest week anybody has a completed game in,
 * clamped into the regular season. In the preseason nothing has been played, so
 * it resolves to week 1 and the whole slate is "remaining", which is exactly the
 * behaviour the profile's projection outlook already has.
 */
async function resolveSeasonClockUncached(supabase: AnySupabase): Promise<SeasonClock> {
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

  // Only weeks inside the projected season count toward "what week is it".
  let currentWeek = 1;
  if (gradedSeason === season) {
    const { data: playedWeek } = await db
      .from("player_stats")
      .select("week")
      .eq("season", season)
      .eq("season_type", "regular")
      .gt("gp", 0)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (playedWeek) {
      currentWeek = Math.min(MAX_WEEK + 1, Number(playedWeek.week) + 1);
    }
  }

  return { season, currentWeek, gradedSeason };
}

/**
 * Request-scoped: the page metadata, the page body, the start/sit loader and
 * the breakdown extras all ask for the clock in one render, and each call is
 * up to three sequential reads, so they share one result per request (React
 * cache keys on the client instance, which createAdminClient already caches).
 */
export const resolveSeasonClock = cache(resolveSeasonClockUncached);
