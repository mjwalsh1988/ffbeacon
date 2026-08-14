/**
 * What "last year" means, resolved once per request.
 *
 * Three different numbers hide behind that phrase and conflating them is the
 * easiest way for BEAM to be confidently wrong:
 *
 *   currentSeason     what the NFL is in right now (Sleeper's answer)
 *   previousSeason    currentSeason - 1
 *   latestStatSeason  the newest season we actually hold game logs for
 *
 * In August those are 2026, 2025, and 2025. A question with no season in it must
 * land on latestStatSeason, and the answer has to SAY which season it used,
 * because someone asking in the preseason usually means "the year that just
 * finished" even when they type "this year".
 *
 * The stat-season bounds change at most once a week, so they are memoised
 * in-process for an hour rather than queried per request. Sleeper's state is
 * already memoised inside getNflState() for 60 seconds. A failure of either is
 * survivable: the bounds fall back to the stored min/max we last saw, and a dead
 * Sleeper leaves currentSeason equal to latestStatSeason, which degrades to
 * "there is no newer season" rather than to an error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getNflState } from "@/lib/sleeper";
import type { BeamSeasonClock } from "./types";

const BOUNDS_TTL_MS = 60 * 60 * 1000;

type StatBounds = {
  earliest: number;
  latest: number;
};

let boundsCache: { at: number; value: StatBounds } | null = null;
let boundsInFlight: Promise<StatBounds | null> | null = null;

/**
 * The oldest and newest seasons we hold regular-season stats for.
 *
 * A range, not a set: it answers "is 2019 outside what we have", which is all
 * the capability layer asks. A season missing from the MIDDLE of the range would
 * not be caught here, and would surface as an ordinary "we do not have that for
 * him" per player rather than as a stated gap. That is acceptable because our
 * ingestion is season-complete or absent, never partial.
 */
async function loadStatBounds(
  db: SupabaseClient<Database>,
): Promise<StatBounds | null> {
  if (boundsCache && Date.now() - boundsCache.at < BOUNDS_TTL_MS) {
    return boundsCache.value;
  }
  if (!boundsInFlight) {
    boundsInFlight = (async () => {
      // Two indexed reads against idx_stats_season_type, issued together.
      // They do not depend on each other, and this runs on a cold request,
      // which is already the slowest one.
      const [newestRes, oldestRes] = await Promise.all([
        db.from("player_stats").select("season").eq("season_type", "regular")
          .order("season", { ascending: false }).limit(1),
        db.from("player_stats").select("season").eq("season_type", "regular")
          .order("season", { ascending: true }).limit(1),
      ]);
      const { data, error } = newestRes;
      if (error || !data || data.length === 0) return null;

      const latest = Number(data[0].season);
      const oldest = oldestRes.data;
      const earliest =
        oldest && oldest.length > 0 ? Number(oldest[0].season) : latest;

      const value: StatBounds = { earliest, latest };
      boundsCache = { at: Date.now(), value };
      return value;
    })()
      .catch((err) => {
        console.error("[beam] stat bounds read failed", err);
        return null;
      })
      .finally(() => {
        boundsInFlight = null;
      });
  }
  return boundsInFlight;
}

/** Test seam. Clears the in-process bounds memo. */
export function resetBeamClockCache(): void {
  boundsCache = null;
  boundsInFlight = null;
}

export async function resolveBeamClock(
  db: SupabaseClient<Database>,
): Promise<BeamSeasonClock> {
  const [state, bounds] = await Promise.all([
    getNflState().catch(() => null),
    loadStatBounds(db),
  ]);

  // Last resort when both the DB read and Sleeper fail: the calendar. An NFL
  // season is named for the year it starts, so before September the season that
  // matters is the previous calendar year.
  const now = new Date();
  const calendarSeason =
    now.getUTCMonth() + 1 >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

  const latestStatSeason = bounds?.latest ?? calendarSeason;
  const earliestStatSeason = bounds?.earliest ?? latestStatSeason;

  const sleeperSeason = state?.season ? Number(state.season) : NaN;
  const currentSeason = Number.isFinite(sleeperSeason)
    ? sleeperSeason
    : Math.max(latestStatSeason, calendarSeason);

  return {
    currentSeason,
    previousSeason: currentSeason - 1,
    latestStatSeason,
    earliestStatSeason,
    currentSeasonHasStats: latestStatSeason >= currentSeason,
    phase: state?.season_type ?? null,
    week: typeof state?.week === "number" ? state.week : null,
  };
}

/**
 * The season a question means when it did not name one.
 *
 * Not simply "the current season": in the preseason that season has no games in
 * it, and answering "0 yards" to "how many yards did Purdy throw for" would be
 * true and useless. Callers pair this with seasonCaveat() so the answer states
 * which season it landed on.
 */
export function defaultSeason(clock: BeamSeasonClock): number {
  return clock.currentSeasonHasStats ? clock.currentSeason : clock.latestStatSeason;
}

/**
 * The caveat that belongs on an answer when the reader said "this year" (or said
 * nothing) during a season that has not produced games yet. Null when the season
 * used is the one they would have expected.
 */
export function seasonCaveat(
  clock: BeamSeasonClock,
  seasonUsed: number,
  askedFor: "explicit" | "current" | "none",
): string | null {
  if (askedFor === "explicit") return null;
  if (clock.currentSeasonHasStats) return null;
  if (seasonUsed >= clock.currentSeason) return null;
  return `The ${clock.currentSeason} season has not produced any games yet, so this is the ${seasonUsed} season.`;
}
