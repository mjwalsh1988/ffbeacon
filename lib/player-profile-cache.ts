/**
 * Cached wrappers around the player-profile data loaders (#1 performance).
 *
 * The profile route stays dynamic (auth + format/source resolution vary per
 * request), but the heavy player-scoped reads behind it change at most nightly.
 * Each wrapper memoizes its loader in the Next data cache keyed by the loader's
 * inputs, so repeat views (and the page + stats-tab both needing finishes) are
 * cache hits instead of re-running the query waterfall. unstable_cache forbids
 * cookies(), so every wrapper reads through the cookie-less anon client
 * (createCachedReadClient); all of these loaders read public, RLS-public tables.
 *
 * Invalidation: the nightly sync routes call revalidateTag() on the matching
 * CACHE_TAGS domain; the `revalidate` TTL is the time-based backstop.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import {
  loadPositionalFinishes,
  loadWeeklyStats,
  loadWeeklyProjections,
  loadProjectionsMap,
  loadDepthChart,
  loadValueSeries,
  loadTrends,
  loadLatestValue,
  loadLatestArticle,
  type PlayerRow,
} from "@/lib/player-profile";
import { findPlayerTrades, type PlayerTrade } from "@/lib/player-trades";

export function loadPositionalFinishesCached(playerId: string) {
  return unstable_cache(
    () => loadPositionalFinishes(createCachedReadClient(), playerId),
    ["player-positional-finishes", playerId],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerFinishes] },
  )();
}

export function loadWeeklyStatsCached(playerId: string) {
  return unstable_cache(
    () => loadWeeklyStats(createCachedReadClient(), playerId),
    ["player-weekly-stats", playerId],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerStats] },
  )();
}

export function loadWeeklyProjectionsCached(playerId: string) {
  return unstable_cache(
    () => loadWeeklyProjections(createCachedReadClient(), playerId),
    ["player-weekly-projections", playerId],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerProjections] },
  )();
}

export async function loadProjectionsMapCached(playerId: string) {
  // unstable_cache JSON-serializes its result, and a Map does not survive that
  // round trip (it comes back as {} with no .get). Cache the entries array
  // instead and rebuild the Map on the way out so callers get a real Map.
  const entries = await unstable_cache(
    async () =>
      Array.from((await loadProjectionsMap(createCachedReadClient(), playerId)).entries()),
    ["player-projections-map", playerId],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerProjections] },
  )();
  return new Map(entries);
}

export function loadDepthChartCached(player: Pick<PlayerRow, "slug" | "team" | "position">) {
  return unstable_cache(
    () => loadDepthChart(createCachedReadClient(), player),
    ["player-depth-chart", player.team ?? "none", player.position, player.slug],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerDepth] },
  )();
}

export function loadValueSeriesCached(
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
  days = 30,
) {
  return unstable_cache(
    () => loadValueSeries(createCachedReadClient(), playerId, formatConfigId, source, days),
    ["player-value-series", playerId, formatConfigId ?? "none", source ?? "none", String(days)],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

export function loadTrendsCached(
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
) {
  return unstable_cache(
    () => loadTrends(createCachedReadClient(), playerId, formatConfigId, source),
    ["player-value-trends", playerId, formatConfigId ?? "none", source ?? "none"],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

export function loadLatestValueCached(
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
) {
  return unstable_cache(
    () => loadLatestValue(createCachedReadClient(), playerId, formatConfigId, source),
    ["player-latest-value", playerId, formatConfigId ?? "none", source ?? "none"],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

export function loadLatestArticleCached(playerId: string) {
  return unstable_cache(
    () => loadLatestArticle(createCachedReadClient(), playerId),
    ["player-latest-article", playerId],
    { revalidate: CACHE_TTL.fiveMinutes, tags: [CACHE_TAGS.playerArticles] },
  )();
}

/**
 * Cross-league trades for a player.
 *
 * This is the most expensive read on the profile and it was the only one not
 * cached: a jsonb key-match across league_transactions, then roster and user
 * identities for every league that came back, then a name lookup for every
 * player on both sides of every trade. It ran on every Overview render and again
 * on every Trades tab render.
 *
 * Cached per (sleeperId, limit) so the Overview's short list and the Trades tab's
 * long list are separate entries rather than one evicting the other. Reads only
 * public, RLS-public tables, so the cookie-less anon client is enough; the Signal
 * Check grading layered on top in the Trades tab still runs per request against
 * service-role config and is deliberately NOT cached here.
 *
 * TTL only, no tag revalidation: trades arrive through lib/league-pulse.ts, which
 * runs inside a page render, and revalidateTag() cannot be called from there.
 */
export function findPlayerTradesCached(sleeperId: string, limit: number): Promise<PlayerTrade[]> {
  return unstable_cache(
    () => findPlayerTrades(createCachedReadClient(), sleeperId, { limit }),
    ["player-trades", sleeperId, String(limit)],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerTrades] },
  )();
}
