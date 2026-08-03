/**
 * Cache tags + TTLs for the player-profile data cache (#1 performance).
 *
 * The profile page is dynamic (auth + format/source resolution vary per request),
 * but the heavy player-scoped reads behind it change at most nightly when the
 * sync jobs run. Those reads are wrapped in unstable_cache (see
 * lib/player-profile-cache.ts) keyed by these tags so repeat views are cache
 * hits instead of re-running the full query waterfall.
 *
 * Tags are coarse (one per data domain, not per player): a nightly sync touches
 * every player, so a single revalidateTag() after the sync busts the whole
 * domain. Time-based `revalidate` is the backstop when a sync route does not run
 * (local dev, a missed cron).
 */

export const CACHE_TAGS = {
  /** player_stats-derived reads: weekly game log, career aggregates. */
  playerStats: "player-stats",
  /** player_positional_finishes reads. */
  playerFinishes: "player-finishes",
  /** player_weekly_projections reads. */
  playerProjections: "player-projections",
  /** player_value_history / player_value_trends reads. */
  playerValues: "player-values",
  /** players-table reads used by the depth chart. */
  playerDepth: "player-depth",
  /** Cross-league trade lookups (league_transactions + roster identities). */
  playerTrades: "player-trades",
  /** articles / article_players reads used by the profile news teaser. */
  playerArticles: "player-articles",
} as const;

export const CACHE_TTL = {
  /** Stats, finishes, projections, depth: refreshed nightly at most. */
  daily: 86_400,
  /** Values/trends: refreshed nightly too, but shorter so a manual value sync
   *  surfaces sooner even without an explicit tag revalidation. */
  hourly: 3_600,
  /** Beacon Brief articles. The Brief curation cron runs every five minutes and
   *  its worker every minute, so this matches the fastest cadence anything on
   *  the site publishes at. Long enough to collapse a burst of profile views
   *  into one query, short enough that a fresh headline is never far behind.
   *  Time-based only: the worker publishes on most runs but not all, and busting
   *  the tag every minute regardless would make the cache pointless. */
  fiveMinutes: 300,
} as const;
