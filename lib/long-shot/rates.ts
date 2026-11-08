/**
 * Roster rates for tiering (plan 7.5).
 *
 * rate = redraft_rostered / redraft_total from the most recent
 * player_roster_rates season whose redraft_total reaches
 * settings.tiers.min_rate_leagues. In March a new season's rows exist with a
 * handful of leagues and would be noise, so the previous season is used until
 * the new one qualifies. No qualifying season means every rate is 0.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

const CHUNK = 200;

/** Pure: the newest season whose denominator qualifies, or null. */
export function pickRateSeason(
  seasons: ReadonlyArray<{ season: number; redraftTotal: number }>,
  minLeagues: number,
): number | null {
  let best: number | null = null;
  for (const s of seasons) {
    if (s.redraftTotal >= minLeagues && (best === null || s.season > best)) best = s.season;
  }
  return best;
}

export async function chooseRateSeason(admin: Client, minLeagues: number): Promise<number | null> {
  // One row per season is enough: redraft_total is the season's league count,
  // so the largest value per season is the season's denominator. Seasons are
  // few, so reading the top row of each candidate in order is cheap.
  const { data, error } = await admin
    .from("player_roster_rates")
    .select("season, redraft_total")
    .gte("redraft_total", minLeagues)
    .order("season", { ascending: false })
    .limit(1);
  if (error) throw new Error(`rate season read failed: ${error.message}`);
  const row = data?.[0];
  return row ? pickRateSeason([{ season: row.season, redraftTotal: row.redraft_total }], minLeagues) : null;
}

/** Pure: a rate from its two counts. A missing or empty denominator is 0. */
export function rateOf(rostered: number | null, total: number | null): number {
  if (!total || total <= 0 || !rostered) return 0;
  return rostered / total;
}

/** player_id -> rate for the given ids; a player with no row is absent (rate 0). */
export async function loadRosterRates(
  admin: Client,
  season: number | null,
  playerIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (season === null || playerIds.length === 0) return out;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("player_roster_rates")
      .select("player_id, redraft_rostered, redraft_total")
      .eq("season", season)
      .in("player_id", chunk);
    if (error) throw new Error(`roster rate read failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.player_id) out.set(row.player_id, rateOf(row.redraft_rostered, row.redraft_total));
    }
  }
  return out;
}
