/**
 * Which projection source a reader gets, and which sources actually have
 * rows for a window.
 *
 * See docs/projection-engine-plan.md, section "3.9 Which source a reader
 * gets". Every read of player_weekly_projections is meant to go through
 * lib/projections/read.ts, which calls resolveProjectionSource so no caller
 * picks a source for itself and no caller reads a points column directly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ProjectionSettings } from "./default-settings";
import { BEACON_SOURCE, SLEEPER_SOURCE } from "./source-constants";

// Re-exported so every existing `import { SLEEPER_SOURCE } from "./source"`
// keeps resolving. The values themselves live in ./source-constants, a leaf
// module with no imports of its own, so lib/build-beacon-projections.ts can
// name the source it writes without pulling in this file's reader-side
// selection logic. Two declarations of a value stored in
// player_weekly_projections.source and player_projection_accuracy.source
// would be a data bug waiting to happen, so this file never redeclares them.
export { SLEEPER_SOURCE, BEACON_SOURCE };

/**
 * A Supabase client from either the request-scoped server helper or a plain
 * SupabaseClient, matching the loose type lib/trade-finder-data.ts accepts.
 * Callers reading through a Server Component, a server action, or a cron
 * script all hold one of these two shapes.
 */
export type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Which projection source a reader gets for one window.
 *
 * Pure: `available` must already be scoped to the window the caller is about
 * to query (see availableProjectionSources below). This function never
 * queries anything itself.
 *
 * The feature ships with `settings.enabled` false, so every reader gets
 * SLEEPER_SOURCE until an admin turns it on. Once enabled, a reader gets
 * BEACON_SOURCE only when it actually has rows covering the window; a league
 * whose format or season the builder has not covered yet still gets a real
 * answer instead of an empty one.
 */
export function resolveProjectionSource(params: {
  /** Sources that actually have rows covering the window. */
  available: readonly string[];
  settings: ProjectionSettings;
}): string {
  const { available, settings } = params;
  if (!settings.enabled) return SLEEPER_SOURCE;
  if (available.includes(BEACON_SOURCE)) return BEACON_SOURCE;
  return SLEEPER_SOURCE;
}

/**
 * Which sources actually COVER (season, fromWeek..toWeek), across every
 * player. This is a coverage check, not an existence check, and the
 * distinction is load bearing.
 *
 * lib/build-beacon-projections.ts only ever writes weeks from the live week
 * forward, and it writes them incrementally: a cron run that mirrors week 9
 * today does not retroactively backfill week 9 tomorrow if it was somehow
 * missed. If the daily cron misses a single day during the season, the weeks
 * that were "current" that day never get an ffbeacon row, ever. An existence
 * check ("does ffbeacon have ANY row in this window") would still route the
 * WHOLE window to ffbeacon on the strength of the weeks it DID cover, and
 * those missed weeks would silently vanish from a reader's world. That
 * directly breaks the guarantee in lib/projections/engine.ts's header:
 * switching sources can change what a number IS but must never change which
 * weeks EXIST.
 *
 * So BEACON_SOURCE is available only when its row count for the window is at
 * least Sleeper's row count for the SAME window. EXACT PARITY, not a
 * tolerance: lib/build-beacon-projections.ts mirrors every Sleeper row it
 * reads for the window one for one, and its clear-stale sweep deletes any
 * ffbeacon row this run did not touch, so a fully covered window has
 * beaconCount identically equal to sleeperCount on a clean build. There is no
 * natural threshold below that: even one missing player-week is one week that
 * disappears for a reader who gets switched to ffbeacon, which is exactly the
 * class of bug this function exists to prevent. `>=` rather than strict `===`
 * only to avoid rejecting a window where beacon's count happens to meet or
 * exceed Sleeper's (never falls short of it); it can never treat a real gap
 * as coverage, because a gap by definition means beaconCount < sleeperCount.
 *
 * SLEEPER_SOURCE keeps the plain existence check: it has nothing to be
 * "covered" against, it IS the coverage baseline every other source is
 * measured off. A window where Sleeper itself has no rows also excludes
 * BEACON_SOURCE, deliberately: there is nothing to have mirrored yet, so
 * comparing zero against zero must not read as coverage.
 *
 * Two `count: "exact", head: true` probes rather than a row scan: only
 * SLEEPER_SOURCE and BEACON_SOURCE exist today, and a head count answers "how
 * many rows does this source have here" without pulling a single row of a
 * table that can hold thousands for a wide window. A probe that errors is
 * read as "unknown", never as zero: resolveProjectionSource's SLEEPER_SOURCE
 * fallback is always safe to fall back to, so an unreadable count must never
 * be allowed to look like a covered window.
 */
export async function availableProjectionSources(
  supabase: AnySupabase,
  season: number,
  fromWeek: number,
  toWeek?: number,
): Promise<string[]> {
  const client = supabase as SupabaseClient<Database>;

  const countFor = async (source: string): Promise<number | null> => {
    let q = client
      .from("player_weekly_projections")
      .select("id", { count: "exact", head: true })
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("source", source)
      .gte("week", fromWeek);
    if (toWeek !== undefined) q = q.lte("week", toWeek);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  };

  const [sleeperCount, beaconCount] = await Promise.all([
    countFor(SLEEPER_SOURCE),
    countFor(BEACON_SOURCE),
  ]);

  const available: string[] = [];
  if (sleeperCount !== null && sleeperCount > 0) available.push(SLEEPER_SOURCE);
  if (
    sleeperCount !== null &&
    sleeperCount > 0 &&
    beaconCount !== null &&
    beaconCount >= sleeperCount
  ) {
    available.push(BEACON_SOURCE);
  }

  return available;
}
