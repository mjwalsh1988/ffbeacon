/**
 * The rankings board read, cached (SEO-T978).
 *
 * /rankings/[format] declares generateStaticParams and force-dynamic together
 * (app/rankings/(board)/[format]/page.tsx), so none of the twelve format pages
 * prerender and every request re-runs the full board query. Partial
 * Prerendering would fix this properly; until that lands, this module wraps
 * the read in unstable_cache as the pragmatic interim
 * (docs/seo/who-should-i-start-and-site-seo-plan.md section 4.3 item 14 and
 * docs/performance/site-speed-audit-and-plan.md).
 *
 * unstable_cache forbids cookies()/headers(), so every read here goes through
 * the cookie-less anon client (createCachedReadClient). Nothing user-scoped
 * enters this module: the caller resolves format and source through the usual
 * preference chain first, then passes the resolved slugs in as arguments.
 *
 * Cache key: format_config_id, the rankings source, the value-history source,
 * and the freshest rankings.generated_at. That last one is what invalidates
 * the cache the morning after a fresh rankings run, without waiting out the
 * full 15-minute revalidate window. It is read UNFILTERED by format or
 * source: lib/seed-rankings.ts stamps a single `generatedAt` timestamp once
 * per run and writes it onto every (source, format) row that run touches, so
 * the global freshest value is the same value a per-(format, source) filtered
 * query would return, and the unfiltered form is what migration 0273's
 * `idx_rankings_generated_at` index was built to serve.
 *
 * Position is deliberately NOT part of the cache key. The board query is
 * unfiltered by position and returns EVERY ranked player, paged, so one cache
 * entry serves every position filter for a (format, source) pair; the caller
 * filters the returned rows in memory. Keying by position too would multiply
 * cache entries roughly tenfold for no benefit, since the underlying read
 * pulls every position either way.
 *
 * The read used to stop at 500 rows. Because the position filter runs AFTER
 * the read, that cap silently dropped every player at a position ranked below
 * 500 overall (287 of 817 on 2026-09-24). The overall board's 500-row display
 * cap is RANKINGS_OVERALL_ROW_CAP, for the caller to apply to the unfiltered
 * view only.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * How far back the value fallback looks for a player the trends table does not
 * carry, and how many players it asks about per request.
 *
 * The product of the two has to stay under Supabase's 1,000 row per request
 * cap for the read to be safe without paging: 25 players over 30 days is at
 * most 750 rows even at a daily capture cadence. Raising either one means
 * checking that product again.
 */
const FALLBACK_WINDOW_DAYS = 30;
const FALLBACK_PLAYER_CHUNK = 25;

/** How many rows the unfiltered (all positions) board shows. A position view
 *  shows every player at that position, however low he ranks overall. */
export const RANKINGS_OVERALL_ROW_CAP = 500;

/** 15 minutes. lib/cache-tags.ts's CACHE_TTL has no entry at this cadence
 *  (its options are 5 minutes, 1 hour, or 1 day), and this module does not own
 *  that file, so the figure is inlined here rather than added there. */
const RANKINGS_BOARD_REVALIDATE_SECONDS = 900;

export type RankingsBoardRow = {
  overall_rank: number;
  position_rank: number;
  slug: string;
  sleeper_id: string | null;
  name: string;
  position: string;
  team: string | null;
  status: string;
  value: number | null;
  /* THE 30-DAY WINDOW IS WHAT THE BOARD RENDERS. A week of market movement is
     mostly noise around one piece of news, and a week of RANK movement barely
     moves at all: the column was a screenful of plus-or-minus one. The table
     columns are 30-day for both, as of 2026-09-21. */
  change_30d_pct: number | null;
  trend_30d: string | null;
  rank_change_30d: number | null;
  show_trend_30d: boolean;
  /** Highest and lowest value over the last 30 days, for the detail sheet. */
  high_30d: number | null;
  low_30d: number | null;
  /* THE 7-DAY FIELDS THAT SURVIVE, AND ONLY THESE THREE. Nothing in the table
     reads a week any more; the Market movers panel still runs a "last 7 days"
     list beside its "last 30 days" one, because a top-five list of the week's
     biggest movers is news even when the same week rendered as a column of
     every player was noise. That panel needs a percentage, a rank delta and
     the window gate, so those three stay and the rest were dropped from the
     select: `change_7d` (the absolute figure, only ever a sort key for a
     column that no longer exists), `trend_7d` (the stable-or-not flag, read
     only by the cell that no longer renders), and `rank_7d_ago` (never
     rendered anywhere, at any point). */
  change_7d_pct: number | null;
  rank_change_7d: number | null;
  show_trend_7d: boolean;
};

export type RankingsBoardData = {
  /** Every ranked player for the (format, source), unfiltered by position
   *  and uncapped. Apply RANKINGS_OVERALL_ROW_CAP to the unfiltered view. */
  rows: RankingsBoardRow[];
  /** Freshest player_value_history.captured_at for this (format, source),
   *  for the "Updated" stat. Null when there is no value-history source. */
  lastCapturedAt: string | null;
};

export type RankingsBoardParams = {
  formatConfigId: string;
  /** Source resolved for the `rankings` table. Null when none is available. */
  rankingsSource: string | null;
  /** Source resolved for `player_value_history` / `player_value_trends`.
   *  Null when none is available. */
  valueHistorySource: string | null;
};

/**
 * Freshest `rankings.generated_at`, site-wide.
 *
 * Deliberately unfiltered: see the module comment on why every row from one
 * seed-rankings run shares the same timestamp, which makes the unfiltered
 * query both correct and the one migration 0273 indexed. One row, ordered
 * descending, so this is cheap enough to run on every request outside the
 * cache; it is what makes the cache key below possible.
 */
export async function loadFreshestRankingsGeneratedAt(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const { data } = await supabase
    .from("rankings")
    .select("generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.generated_at ?? null;
}

/**
 * Every `player_value_trends` row for one (format, source), paged.
 *
 * PostgREST caps a response at 1,000 rows and says nothing when it does, so
 * the unpaged version of this read had a silent cliff waiting for it. The
 * biggest live pairing is 615 rows today, which is comfortably under, but the
 * failure mode past the cap is the quiet kind: the players who fell off the
 * end would keep their Value (the chunked history fallback below still finds
 * it) and silently lose their tier, their gap and both movement columns, on a
 * board that otherwise looked completely normal.
 *
 * One request in every realistic case. The loop only asks for a second page
 * when the first came back exactly full, which is the only situation where
 * there might be more. `order("player_id")` is what makes the paging sound:
 * `range()` over an unordered result can repeat or skip rows between pages.
 *
 * A failed page THROWS. loadRankingsBoard catches it and drops every trend
 * row, so the board never mixes players with movement columns and players
 * silently without them.
 */

type TrendRow = {
  player_id: string;
  current_value: number;
  change_30d_pct: number | null;
  trend_30d: string | null;
  rank_change_30d: number | null;
  show_trend_30d: boolean;
  high_30d: number | null;
  low_30d: number | null;
  change_7d_pct: number | null;
  rank_change_7d: number | null;
  show_trend_7d: boolean;
};

async function loadTrendRows(
  supabase: SupabaseClient<Database>,
  formatConfigId: string,
  source: string,
): Promise<TrendRow[]> {
  const rows = await fetchAllRows("rankings board trends", (from, to) =>
    supabase
      .from("player_value_trends")
      .select(
        "player_id, current_value, change_30d_pct, trend_30d, rank_change_30d, show_trend_30d, high_30d, low_30d, change_7d_pct, rank_change_7d, show_trend_7d",
      )
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .order("player_id", { ascending: true })
      .range(from, to),
  );
  return rows as TrendRow[];
}

type RankedBoardRow = {
  overall_rank: number;
  position_rank: number;
  players: {
    id: string;
    slug: string;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
    status: string;
    external_ids: Record<string, unknown> | null;
  };
};

/**
 * Every ranked player for one (format, source), paged. Uncapped on purpose:
 * see the module comment on why a cap here empties the position views.
 */
async function loadRankedRows(
  supabase: SupabaseClient<Database>,
  formatConfigId: string,
  source: string,
): Promise<RankedBoardRow[]> {
  const rows = await fetchAllRows("rankings board", (from, to) =>
    supabase
      .from("rankings")
      .select(
        "overall_rank, position_rank, players!inner(id, slug, first_name, last_name, position, team, status, external_ids)",
      )
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .is("week", null)
      .order("overall_rank")
      // Tiebreak, so pages over a tied rank cannot repeat or skip a player.
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows as unknown as RankedBoardRow[];
}

/**
 * The uncached read. Exported for tests; callers wanting the cache should use
 * loadRankingsBoardCached below.
 */
export async function loadRankingsBoard(
  supabase: SupabaseClient<Database>,
  { formatConfigId, rankingsSource, valueHistorySource }: RankingsBoardParams,
): Promise<RankingsBoardData> {
  // No season filter, for the same reason components/rankings/rankings-view.tsx
  // never applied one: lib/seed-rankings.ts sweeps every other season out of the
  // table, so it holds exactly one. Pinning a constant here risks this reader and
  // that writer drifting apart.
  const [rankedRows, trendRows, capturedResult] = await Promise.all([
    rankingsSource
      ? loadRankedRows(supabase, formatConfigId, rankingsSource).catch((error) => {
          // Same posture as before paging: an empty board, never a partial one.
          console.error("[rankings-board] rankings read failed", error);
          return [] as RankedBoardRow[];
        })
      : Promise.resolve([] as RankedBoardRow[]),
    valueHistorySource
      ? loadTrendRows(supabase, formatConfigId, valueHistorySource).catch((error) => {
          // A missing trend row degrades to a dash and the history fallback
          // below still recovers every value, so a failed trends read drops
          // ALL trend rows rather than failing the render or keeping some.
          console.error("[rankings-board] trends read failed", error);
          return [] as TrendRow[];
        })
      : Promise.resolve([] as TrendRow[]),
    // ONE ROW, for the "Values as of" date and nothing else. See the note in
    // the previous version of this read (now here) for why the trends row's
    // own updated_at is the wrong timestamp for that chip.
    valueHistorySource
      ? supabase
          .from("player_value_history")
          .select("captured_at")
          .eq("format_config_id", formatConfigId)
          .eq("source", valueHistorySource)
          .order("captured_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [] as never }),
  ]);

  const valueByPlayer = new Map<string, { value: number }>();
  for (const t of trendRows) {
    valueByPlayer.set(t.player_id, { value: t.current_value });
  }

  // The gap between "ranked" and "has a trend row": a player can sit in
  // rankings with real captured values while having no player_value_trends
  // row (the trend calc needs a run of history it does not always have, or the
  // source stopped publishing him). Filled here with one bounded fallback read,
  // chunked so the row count stays under Supabase's 1,000 row cap regardless of
  // how many players are uncovered. See FALLBACK_WINDOW_DAYS above.
  const uncovered = [
    ...new Set(
      rankedRows
        .map((r) => r.players?.id ?? null)
        .filter((id): id is string => Boolean(id) && !valueByPlayer.has(id)),
    ),
  ];
  if (uncovered.length > 0 && valueHistorySource) {
    const source = valueHistorySource;
    const cutoff = new Date(
      Date.now() - FALLBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const chunks: string[][] = [];
    for (let i = 0; i < uncovered.length; i += FALLBACK_PLAYER_CHUNK) {
      chunks.push(uncovered.slice(i, i + FALLBACK_PLAYER_CHUNK));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("player_value_history")
          .select("player_id, value")
          .eq("format_config_id", formatConfigId)
          .eq("source", source)
          .in("player_id", chunk)
          .gte("captured_at", cutoff)
          .order("captured_at", { ascending: false }),
      ),
    );
    for (const page of pages) {
      for (const row of page.data ?? []) {
        // Newest first, so the first row seen for a player is the one to keep.
        if (valueByPlayer.has(row.player_id)) continue;
        valueByPlayer.set(row.player_id, { value: row.value });
      }
    }
  }

  type TrendFields = Omit<
    RankingsBoardRow,
    | "overall_rank"
    | "position_rank"
    | "slug"
    | "sleeper_id"
    | "name"
    | "position"
    | "team"
    | "status"
    | "value"
  >;
  const trendByPlayer = new Map<string, TrendFields>();
  for (const t of trendRows) {
    trendByPlayer.set(t.player_id, {
      change_30d_pct: t.change_30d_pct,
      trend_30d: t.trend_30d,
      rank_change_30d: t.rank_change_30d,
      show_trend_30d: t.show_trend_30d,
      high_30d: t.high_30d,
      low_30d: t.low_30d,
      change_7d_pct: t.change_7d_pct,
      rank_change_7d: t.rank_change_7d,
      show_trend_7d: t.show_trend_7d,
    });
  }

  const rows: RankingsBoardRow[] = rankedRows.map((r) => {
    const player = r.players;
    const value = valueByPlayer.get(player.id);
    const trend = trendByPlayer.get(player.id);
    const sleeperExt = player.external_ids?.sleeper;
    const sleeper_id =
      typeof sleeperExt === "string" && sleeperExt
        ? sleeperExt
        : typeof sleeperExt === "number"
          ? String(sleeperExt)
          : null;
    return {
      overall_rank: r.overall_rank,
      position_rank: r.position_rank,
      slug: player.slug,
      sleeper_id,
      name: `${player.first_name} ${player.last_name}`,
      position: player.position,
      team: player.team,
      status: player.status,
      value: value?.value ?? null,
      change_30d_pct: trend?.change_30d_pct ?? null,
      trend_30d: trend?.trend_30d ?? null,
      rank_change_30d: trend?.rank_change_30d ?? null,
      show_trend_30d: trend?.show_trend_30d ?? false,
      high_30d: trend?.high_30d ?? null,
      low_30d: trend?.low_30d ?? null,
      change_7d_pct: trend?.change_7d_pct ?? null,
      rank_change_7d: trend?.rank_change_7d ?? null,
      show_trend_7d: trend?.show_trend_7d ?? false,
    };
  });

  return {
    rows,
    lastCapturedAt: capturedResult.data?.[0]?.captured_at ?? null,
  };
}

/**
 * Cached wrapper. `generatedAt` comes from loadFreshestRankingsGeneratedAt,
 * read by the caller BEFORE this call so it can be part of the key: resolving
 * it inside the cached function would key each entry on a value the key could
 * not see, serving yesterday's board for up to 15 minutes after a fresh run.
 */
export function loadRankingsBoardCached(
  params: RankingsBoardParams & { generatedAt: string | null },
): Promise<RankingsBoardData> {
  const { formatConfigId, rankingsSource, valueHistorySource, generatedAt } =
    params;
  return unstable_cache(
    () =>
      loadRankingsBoard(createCachedReadClient(), {
        formatConfigId,
        rankingsSource,
        valueHistorySource,
      }),
    [
      // THE SHAPE OF THE ROW IS PART OF THE KEY, via this literal, and it is
      // bumped whenever the select changes. Vercel's Data Cache outlives a
      // deployment, so entries written by the previous build come back as
      // rows missing whatever columns the new build added: the 30-day cells
      // would all render "-", the pulse strip and the movers panel would
      // return null, and two FAQ items would vanish, for up to the revalidate
      // window after every deploy. "v2" is the 2026-09-21 change that added
      // the 30-day columns and dropped the 7-day ones.
      "rankings-board-v2",
      formatConfigId,
      rankingsSource ?? "none",
      valueHistorySource ?? "none",
      generatedAt ?? "none",
    ],
    {
      revalidate: RANKINGS_BOARD_REVALIDATE_SECONDS,
      // The exact tag app/api/cron/recalculate-derived/route.ts revalidates
      // after runSeedRankings + runCalculateTrends finish, i.e. the nightly
      // rankings rebuild this cache exists to sit in front of.
      tags: [CACHE_TAGS.playerValues],
    },
  )();
}
