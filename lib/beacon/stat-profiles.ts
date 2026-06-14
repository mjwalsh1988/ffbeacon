/**
 * Nightly materialization of beacon_stat_profiles: per-player, scoring-invariant
 * stat-component aggregates for the latest two regular seasons. Plan v3.1 6c.
 *
 * Storing raw summed components (not points) means any scoring config can be
 * applied later as a cheap dot product: this powers the stat_performance
 * trajectory (B4) and on-demand custom-format compute (B5). Covers skill, K, and
 * DEF. Derived table, no metadata column.
 *
 * components shape: { "<season>": { games, <scorable col>: sum, ... }, ... }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { withRetry } from "../supabase/retry";
import { PROFILE_COLUMNS } from "./scoring";

const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

export interface MaterializeResult {
  profiles: number;
  seasonsUsed: number[];
}

export async function materializeStatProfiles(
  supabase: SupabaseClient<Database>,
): Promise<MaterializeResult> {
  // 1. position map for the relevant universe.
  const positionByPlayer = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, position")
          .in("position", Array.from(RELEVANT_POSITIONS))
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `profile players page ${from}` },
    );
    for (const p of page) positionByPlayer.set(p.id, p.position);
    if (page.length < PAGE) break;
  }

  // 2. latest two regular seasons.
  const maxSeason = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("player_stats")
        .select("season")
        .eq("season_type", "regular")
        .order("season", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data && data.length > 0 ? data[0].season : null;
    },
    { label: "profile max season" },
  );
  if (maxSeason === null) return { profiles: 0, seasonsUsed: [] };
  const recentSeasons = [maxSeason, maxSeason - 1];

  // 3. page every regular-season stat row for the recent seasons (range-paged so
  // the 1000-row default never truncates), aggregate components per player+season
  // for relevant positions only. Load by id-chunk + range pagination (NOT a
  // full-table offset scan: at 80k+ rows that silently dropped ~100 players,
  // including elite TEs). .in() bounds each chunk; range() pages within it.
  const selectCols = ["player_id", "season", "gp", ...PROFILE_COLUMNS].join(", ");
  type Row = Record<string, number | string | null> & { player_id: string; season: number };
  const byPlayer = new Map<string, Map<number, Record<string, number>>>();
  const relevantIds = [...positionByPlayer.keys()];
  for (let i = 0; i < relevantIds.length; i += 100) {
    const chunk = relevantIds.slice(i, i + 100);
    for (let from = 0; ; from += PAGE) {
      const offset = from;
      const page = await withRetry(
        async () => {
          const { data, error } = await supabase
            .from("player_stats")
            .select(selectCols)
            .in("player_id", chunk)
            .in("season", recentSeasons)
            .eq("season_type", "regular")
            .order("player_id", { ascending: true })
            .order("season", { ascending: true })
            .order("week", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) throw error;
          return (data ?? []) as unknown as Row[];
        },
        { label: `profile stats chunk ${i} page ${from}` },
      );
      for (const row of page) {
        let seasons = byPlayer.get(row.player_id);
        if (!seasons) {
          seasons = new Map();
          byPlayer.set(row.player_id, seasons);
        }
        let line = seasons.get(row.season);
        if (!line) {
          line = { games: 0 };
          seasons.set(row.season, line);
        }
        line.games += Number(row.gp ?? 0) > 0 ? 1 : 0;
        for (const col of PROFILE_COLUMNS) line[col] = (line[col] ?? 0) + Number(row[col] ?? 0);
      }
      if (page.length < PAGE) break;
    }
  }

  // 4. upsert profiles.
  const rows = [...byPlayer.entries()].map(([player_id, seasons]) => {
    const components: Record<string, Record<string, number>> = {};
    let totalGames = 0;
    const seasonNums = [...seasons.keys()].sort((a, b) => b - a);
    for (const s of seasonNums) {
      components[String(s)] = seasons.get(s)!;
      totalGames += seasons.get(s)!.games ?? 0;
    }
    return {
      player_id,
      components: components as unknown as Json,
      games: totalGames,
      recency: seasonNums as unknown as Json,
      updated_at: new Date().toISOString(),
    };
  });

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("beacon_stat_profiles")
          .upsert(chunk, { onConflict: "player_id", ignoreDuplicates: false });
        if (error) throw error;
      },
      { label: `beacon_stat_profiles upsert ${i}` },
    );
    written += chunk.length;
  }

  return { profiles: written, seasonsUsed: recentSeasons };
}
