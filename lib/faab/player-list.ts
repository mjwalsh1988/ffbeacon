/**
 * The ranked player list behind the FAAB calculator's search box.
 *
 * This was three sequential queries inline in the page, and it was the slowest
 * thing on the route. Two of them were avoidable:
 *
 *   1. The rankings query selected the player's slug but not their id, so a
 *      second round trip resolved 800 slugs back to ids. The join can just
 *      return the id.
 *
 *   2. Current value was read from `player_value_history`, which holds one row
 *      per player PER NIGHTLY SNAPSHOT. Asking for 800 players meant asking for
 *      tens of thousands of rows, sorted, so the newest could be picked per
 *      player in JS. It also sat right on PostgREST's 1000-row default cap, so
 *      the answer was one bad ordering away from silently dropping most of the
 *      values. `player_value_trends` already holds exactly one row per
 *      (player, format, source) with the current value on it, which is what
 *      that pre-calc table is for.
 *
 * The result is identical for every visitor on a given (format, rankings
 * source, value source), and the underlying data changes at most nightly, so
 * the whole thing is memoized in the Next data cache. unstable_cache forbids
 * cookies(), hence the cookie-less read client; every table read here is
 * RLS-public.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";

/** One searchable player, as the calculator's combobox needs it. */
export type FaabListPlayer = {
  slug: string;
  player_id: string | null;
  name: string;
  position: string;
  team: string | null;
  sleeper_id: string | null;
  overall_rank: number;
  position_rank: number;
  value: number | null;
};

/**
 * How deep the search goes.
 *
 * 300 was the old cap and it is the wrong depth for a FAAB tool: the top 300
 * are the players already rostered everywhere, and the ones you actually bid on
 * rank below them. 800 covers the startable universe plus the waiver tier.
 */
export const SEARCHABLE_PLAYERS = 800;

function sleeperIdOf(external: unknown): string | null {
  if (!external || typeof external !== "object") return null;
  const value = (external as Record<string, unknown>).sleeper;
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return null;
}

type RankedRow = {
  overall_rank: number;
  position_rank: number;
  players: {
    id: string;
    slug: string;
    first_name: string | null;
    last_name: string | null;
    position: string | null;
    team: string | null;
    external_ids: Record<string, unknown> | null;
  };
};

async function loadFaabPlayerList({
  formatConfigId,
  rankingsSource,
  valueSource,
}: {
  formatConfigId: string;
  rankingsSource: string;
  valueSource: string | null;
}): Promise<FaabListPlayer[]> {
  const supabase = createCachedReadClient();

  const { data } = await supabase
    .from("rankings")
    .select(
      "overall_rank, position_rank, players!inner(id, slug, first_name, last_name, position, team, external_ids)",
    )
    .eq("format_config_id", formatConfigId)
    .eq("source", rankingsSource)
    .order("overall_rank")
    .limit(SEARCHABLE_PLAYERS);

  const rows = (data ?? []) as unknown as RankedRow[];
  if (rows.length === 0) return [];

  const players: FaabListPlayer[] = rows.map((row) => ({
    slug: row.players.slug,
    player_id: row.players.id,
    name: `${row.players.first_name ?? ""} ${row.players.last_name ?? ""}`.trim(),
    position: row.players.position ?? "",
    team: row.players.team ?? null,
    sleeper_id: sleeperIdOf(row.players.external_ids),
    overall_rank: row.overall_rank,
    position_rank: row.position_rank,
    value: null,
  }));

  // One row per player rather than one row per player per nightly snapshot.
  if (valueSource) {
    const byId = new Map(players.map((p) => [p.player_id as string, p]));
    const { data: trends } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", formatConfigId)
      .eq("source", valueSource)
      .in("player_id", [...byId.keys()]);

    for (const trend of trends ?? []) {
      const player = byId.get(trend.player_id);
      if (player && typeof trend.current_value === "number") {
        player.value = trend.current_value;
      }
    }
  }

  return players.sort((a, b) => a.overall_rank - b.overall_rank);
}

/** Memoized per (format, rankings source, value source). */
export function loadFaabPlayerListCached(args: {
  formatConfigId: string;
  rankingsSource: string;
  valueSource: string | null;
}) {
  return unstable_cache(
    () => loadFaabPlayerList(args),
    [
      "faab-player-list",
      args.formatConfigId,
      args.rankingsSource,
      args.valueSource ?? "none",
    ],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

/**
 * How deep the league free-agent search looks.
 *
 * Deeper than the manual list on purpose: the whole point of that view is the
 * players below the startable tier, and sources rank roughly 500 to 900 per
 * format. The ceiling just stops a misconfigured source returning the world.
 */
export const RANKED_UNIVERSE_LIMIT = 2000;

/** One ranked player, before any league has been subtracted from the list. */
export type RankedUniverseEntry = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  overallRank: number;
  positionRank: number;
};

async function loadRankedUniverse({
  formatConfigId,
  source,
}: {
  formatConfigId: string;
  source: string;
}): Promise<RankedUniverseEntry[]> {
  const supabase = createCachedReadClient();
  const out: RankedUniverseEntry[] = [];
  const PAGE = 1000;

  for (let from = 0; from < RANKED_UNIVERSE_LIMIT; from += PAGE) {
    const size = Math.min(PAGE, RANKED_UNIVERSE_LIMIT - from);
    const { data, error } = await supabase
      .from("rankings")
      .select(
        "overall_rank, position_rank, players!inner(id, slug, first_name, last_name, full_name, position, team, external_ids)",
      )
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .order("overall_rank")
      .range(from, from + size - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data as unknown as RankedRow[]) {
      const p = row.players as RankedRow["players"] & { full_name?: string | null };
      out.push({
        playerId: p.id,
        slug: p.slug,
        name:
          p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        position: (p.position ?? "").toUpperCase(),
        team: p.team ?? null,
        sleeperId: sleeperIdOf(p.external_ids),
        overallRank: row.overall_rank,
        positionRank: row.position_rank,
      });
    }
    if (data.length < size) break;
  }

  return out;
}

/**
 * The ranked universe for a (format, source), memoized.
 *
 * Split out from the league free-agent list on purpose. The rankings half is
 * the same for everyone and changes nightly, so it caches well; the roster half
 * changes the moment a waiver clears, so it is always read live. Caching them
 * together would serve a stale ownership picture, which is exactly the bug the
 * free-agent list exists to avoid.
 */
export function loadRankedUniverseCached(args: {
  formatConfigId: string;
  source: string;
}) {
  return unstable_cache(
    () => loadRankedUniverse(args),
    ["faab-ranked-universe", args.formatConfigId, args.source],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}
