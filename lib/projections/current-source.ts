import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { resolveProjectionSourceForWindow } from "./source";
import { SLEEPER_SOURCE } from "./source-constants";

/**
 * Which projection engine the site is currently on, for surfaces that need to
 * NAME it rather than to query with it.
 *
 * THE DIFFERENCE FROM resolveProjectionSourceForWindow MATTERS. That one
 * answers "which source should THIS read use", for a specific season and week
 * window, and every data path calls it with the window it is about to query.
 * This one answers "what should this page CALL the numbers it is showing", for
 * a page whose window is the rest of the season and whose label would otherwise
 * be a hardcoded word that silently goes wrong the day an admin flips the
 * switch.
 *
 * WHY IT IS GLOBAL AND CACHED. The answer does not vary by player, by league or
 * by reader: it is one settings row plus a coverage probe. Resolving it per
 * surface per request would put three round trips on pages that only wanted a
 * noun.
 *
 * IT DOES FEED REAL READS, NOT ONLY LABELS. The player profile keys its two
 * projection caches on the value this returns, and BEAM scopes its reliability
 * rows by it. An hour of staleness therefore means an hour of the previous
 * engine after a switch, which is the same hour those caches would hold anyway;
 * it does not mean an hour of MIXED engines, because a stale answer here is
 * stale consistently for every surface that asks.
 *
 * PASS THE WINDOW WHEN YOU KNOW IT. Coverage is checked per window
 * (availableProjectionSources), and our builder only ever writes weeks from the
 * live one forward, so the whole-season answer and the rest-of-season answer
 * can legitimately differ: one missed player-week in an already-played week
 * fails the season probe while every live-window probe still passes. A caller
 * that is labelling something built over a specific window has to ask about
 * THAT window or it will name the wrong engine. The no-argument form is for a
 * surface whose own window really is the whole season, which is what the player
 * profile shows.
 *
 * FREE WHILE THE FEATURE IS OFF. `settings.beaconProjections.enabled` is
 * checked first and short circuits before any coverage probe, which is the same
 * short circuit resolveProjectionSourceForWindow makes.
 *
 * EVERY FAILURE DEGRADES TO SLEEPER, which is always safe: it is the coverage
 * baseline every other source is measured against, and it is what an unreadable
 * settings row means by definition.
 *
 * ADMIN CLIENT, because `league_power_pulse_settings` is service-role only. It
 * is cookie-free, which unstable_cache requires, and nothing about the reader
 * reaches it, so there is nothing per-user in the cached value.
 */
export function currentProjectionSourceCached(window?: {
  season: number;
  fromWeek: number;
  toWeek?: number;
}): Promise<string> {
  const key = window
    ? `${window.season}|${window.fromWeek}|${window.toWeek ?? "end"}`
    : "latest-season";

  return unstable_cache(
    async (): Promise<string> => {
      const admin = createAdminClient();
      const settings = await loadPowerPulseSettings(admin);
      if (!settings.beaconProjections?.enabled) return SLEEPER_SOURCE;

      if (window) {
        return resolveProjectionSourceForWindow({
          supabase: admin,
          season: window.season,
          fromWeek: window.fromWeek,
          toWeek: window.toWeek,
          settings: settings.beaconProjections,
        });
      }

      // The newest season we hold projections FOR. Scoped to Sleeper because
      // that is the coverage baseline: our own builder mirrors Sleeper's rows
      // rather than adding seasons of its own, so this is the same answer
      // through half the rows.
      const { data } = await admin
        .from("player_weekly_projections")
        .select("season")
        .eq("season_type", "regular")
        .eq("source", SLEEPER_SOURCE)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      const season = data ? Number(data.season) : null;
      if (season === null || !Number.isFinite(season)) return SLEEPER_SOURCE;

      return resolveProjectionSourceForWindow({
        supabase: admin,
        season,
        fromWeek: 1,
        settings: settings.beaconProjections,
      });
    },
    // The window is IN THE KEY. Without it every caller would share one entry
    // and the first one through the door would decide the answer for the rest.
    ["current-projection-source", key],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerProjections] },
  )();
}
