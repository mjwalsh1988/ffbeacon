/**
 * What each player actually cost on waivers, across the synced leagues.
 *
 * One call to `waiver_claim_market()` (migration 0331), which does the
 * grouping in SQL: a single early-season week holds tens of thousands of
 * waiver rows and the board needs five numbers for each of about 160 players.
 * The function is service-role only, so this is the admin client, and nothing
 * it returns identifies a league, roster or manager.
 *
 * THE WINDOW. The waiver run for week N and the one before it. Sleeper stamps
 * a claim with the week it was made in, so on the Wednesday of week 4 the
 * week-4 run may be half processed and the week-3 run is the latest complete
 * one; reading both means the board never goes quiet for the day a run is in
 * flight. A past week's page reads the runs around that week, so its prices
 * describe the week it describes.
 *
 * NEVER A PARTIAL ANSWER, AND NEVER A CACHED FAILURE. A failed call throws
 * inside the cached function, so Next stores nothing, and the caller turns it
 * into an empty map, which the bid reads as "no auctions of his own" and prices
 * from the market cells alone. Returning the empty map from inside the cache
 * would have pinned one timeout to every reader for an hour.
 *
 * Cached for an hour per (season, window): claims land in batches on waiver
 * night, and every format and source shares the same auctions.
 */

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TTL } from "@/lib/cache-tags";
import type { ClaimMarket } from "./types";

export type ClaimWindow = { from: number; to: number };

export function claimWindowFor(week: number): ClaimWindow {
  return { from: Math.max(1, week - 1), to: Math.max(1, week) };
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function loadClaimMarketUncached(
  season: number,
  window: ClaimWindow,
): Promise<Array<[string, ClaimMarket]>> {
  const { data, error } = await createAdminClient().rpc("waiver_claim_market", {
    p_season: season,
    p_from_week: window.from,
    p_to_week: window.to,
  });
  if (error) throw new Error(`waiver claim market read failed: ${error.message}`);
  return (data ?? []).map((row) => [
    String(row.sleeper_player_id),
    {
      auctions: num(row.auctions),
      leagues: num(row.leagues),
      avgBidders: num(row.avg_bidders),
      contestedShare: num(row.contested_share),
      p25: num(row.p25),
      p50: num(row.p50),
      p75: num(row.p75),
      p90: num(row.p90),
      latestWeek: num(row.latest_week),
    },
  ]);
}

/** Keyed by Sleeper player id. unstable_cache cannot hold a Map, so entries are cached. */
export async function loadClaimMarketCached(
  season: number,
  window: ClaimWindow,
): Promise<Map<string, ClaimMarket>> {
  try {
    const entries = await unstable_cache(
      () => loadClaimMarketUncached(season, window),
      ["waiver-claim-market", String(season), String(window.from), String(window.to)],
      { revalidate: CACHE_TTL.hourly },
    )();
    return new Map(entries);
  } catch (error) {
    console.error("[waiver-wire] claim market unavailable", error);
    return new Map();
  }
}
