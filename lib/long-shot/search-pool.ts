/**
 * The Long Shot search pool (plan 17.5 and 7.4).
 *
 * NOT the Signal Scout rankings window: rankedPlayerIdSet keeps only players
 * some source ranked in the last 90 days, which drops the retired players
 * who ARE the long_shot tier of a historical prompt. This pool is every
 * QB, RB, WR or TE with at least one player_stats row since 2020.
 *
 * Every answer set is intersected with this pool before its bounds are
 * checked, so an answer that cannot be typed into the combobox is never an
 * answer. Memoised in process for five minutes like rankedPlayerIdSet; it
 * says nothing about who is asking.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ELIGIBLE_POSITIONS, STATS_FLOOR_SEASON } from "./types";

type Client = SupabaseClient<Database>;

const POOL_TTL_MS = 5 * 60 * 1000;

export async function longShotSearchPool(admin: Client): Promise<Set<string>> {
  return memoTtl("ref:long-shot-pool", POOL_TTL_MS, async () => {
    // An inner embed with a filter keeps only players who have a qualifying
    // stats row; the embed is capped at one row per player so the payload is
    // ids, not stat lines. Paged on the unique id.
    const rows = await fetchAllRows("long shot search pool", (from, to) =>
      admin
        .from("players")
        .select("id, player_stats!inner(season)")
        .in("position", [...ELIGIBLE_POSITIONS])
        .gte("player_stats.season", STATS_FLOOR_SEASON)
        .limit(1, { referencedTable: "player_stats" })
        .order("id", { ascending: true })
        .range(from, to),
    );
    return new Set(rows.map((r) => r.id));
  });
}

/** Pure: keep only ids the pool contains, in their original order. */
export function intersectPool(ids: readonly string[], pool: ReadonlySet<string>): string[] {
  return ids.filter((id) => pool.has(id));
}
