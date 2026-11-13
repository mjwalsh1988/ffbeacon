/**
 * What each player actually cost on waivers, across the synced leagues.
 *
 * One call to `waiver_claim_market()` (migrations 0331, 0375 and 0377), which
 * does the aggregation in SQL: a single early-season week holds thousands of
 * auctions and the board needs five numbers for each of about 160 players.
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
 * ONE POOL AT A TIME. The function takes the league kind (migration 0375) and
 * reads only auctions of that kind. A redraft board quotes what redraft rooms
 * paid for him and a dynasty board what dynasty rooms paid; the two are never
 * blended, because they are prices for different decisions.
 *
 * IT READS THE KEPT SAMPLE (migration 0377), `faab_prior_auctions`, not the
 * raw transactions. Those rows are the auctions the market cells are built
 * from, grouped by the same rule and filed under a league kind by the same
 * classifier (lib/faab/priors-load.ts leagueKindFor), so a claim price and a
 * market cell can never disagree about which pool a league is in. Rebuilding
 * the auctions from `league_transactions` on every call took 12 to 31 seconds
 * for an early-season week, past PostgREST's eight. The sample is refreshed
 * hourly by /api/cron/faab-priors, so a claim shows within about two hours.
 *
 * Cached for an hour per (season, window, league kind): claims land in batches
 * on waiver night, and every format and source of one kind shares the same
 * auctions.
 */

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TTL } from "@/lib/cache-tags";
import type { PriorLeagueKind } from "@/lib/faab/priors-build";
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
  leagueKind: PriorLeagueKind,
): Promise<Array<[string, ClaimMarket]>> {
  const { data, error } = await createAdminClient().rpc("waiver_claim_market", {
    p_season: season,
    p_from_week: window.from,
    p_to_week: window.to,
    p_league_kind: leagueKind,
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
  leagueKind: PriorLeagueKind,
): Promise<Map<string, ClaimMarket>> {
  try {
    const entries = await unstable_cache(
      () => loadClaimMarketUncached(season, window, leagueKind),
      // The pool is part of the key: a redraft board and a dynasty board read
      // different auctions and must never share an entry.
      ["waiver-claim-market", String(season), String(window.from), String(window.to), leagueKind],
      { revalidate: CACHE_TTL.hourly },
    )();
    return new Map(entries);
  } catch (error) {
    console.error("[waiver-wire] claim market unavailable", error);
    return new Map();
  }
}
