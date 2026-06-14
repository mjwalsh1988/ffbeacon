/**
 * stat_value producer (B3 scope: K and DEF). These positions have no external
 * source values, so a recency-weighted re-score of their own stat history is the
 * only base signal. Plan v3.1 sections 3, 5; "value everything" Q1.
 *
 * Pulls the latest two regular seasons of kicking / team-defense stats, sums
 * each scorable column per (player, season), scores the season line with the
 * admin-tunable config, then recency-weights across seasons. Returns a single
 * score per player which the engine normalizes within position into the K/DEF
 * band. Independent of KTC / FantasyCalc / DynastyProcess, so K/DEF survive a
 * total external-source outage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { withRetry } from "../../supabase/retry";
import {
  KICKER_STAT_COLUMNS,
  DEFENSE_STAT_COLUMNS,
  scoreSeasonLine,
  recencyWeightedScore,
  type StatScoringConfig,
} from "../scoring";

export interface StatValueResult {
  pointsByPlayer: Map<string, number>;
  positionByPlayer: Map<string, "K" | "DEF">;
  seasonsUsed: number[];
}

const STAT_COLUMNS = Array.from(new Set([...KICKER_STAT_COLUMNS, ...DEFENSE_STAT_COLUMNS]));

export async function gatherStatValues(
  supabase: SupabaseClient<Database>,
  config: StatScoringConfig,
): Promise<StatValueResult> {
  // 1. K/DEF players.
  const positionByPlayer = new Map<string, "K" | "DEF">();
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, position")
          .in("position", ["K", "DEF"])
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `K/DEF players page ${from}` },
    );
    for (const p of page) {
      positionByPlayer.set(p.id, p.position as "K" | "DEF");
      ids.push(p.id);
    }
    if (page.length < PAGE) break;
  }
  if (ids.length === 0) {
    return { pointsByPlayer: new Map(), positionByPlayer, seasonsUsed: [] };
  }

  // 2. Latest two regular seasons present (season-agnostic).
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
    { label: "max season" },
  );
  if (maxSeason === null) {
    return { pointsByPlayer: new Map(), positionByPlayer, seasonsUsed: [] };
  }
  const recentSeasons = [maxSeason, maxSeason - 1];

  // 3. Load the relevant stat rows.
  const selectCols = ["player_id", "season", "week", ...STAT_COLUMNS].join(", ");
  type StatRow = Record<string, number | string | null> & { player_id: string; season: number };
  const rows: StatRow[] = [];
  // A K/DEF player carries ~17 weekly rows per season, so even a modest id chunk
  // blows past PostgREST's 1000-row default. Page every chunk with range() and a
  // stable order so nothing is silently truncated (the 1000-row gotcha).
  const PAGE_ROWS = 1000;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let from = 0; ; from += PAGE_ROWS) {
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
            .range(offset, offset + PAGE_ROWS - 1);
          if (error) throw error;
          return (data ?? []) as unknown as StatRow[];
        },
        { label: `K/DEF stats chunk ${i} page ${from}` },
      );
      rows.push(...page);
      if (page.length < PAGE_ROWS) break;
    }
  }

  // 4. Sum each scorable column per (player, season).
  const byPlayerSeason = new Map<string, Map<number, Record<string, number>>>();
  for (const row of rows) {
    let seasons = byPlayerSeason.get(row.player_id);
    if (!seasons) {
      seasons = new Map();
      byPlayerSeason.set(row.player_id, seasons);
    }
    let line = seasons.get(row.season);
    if (!line) {
      line = {};
      seasons.set(row.season, line);
    }
    for (const col of STAT_COLUMNS) {
      line[col] = (line[col] ?? 0) + Number(row[col] ?? 0);
    }
  }

  // 5. Score each season, recency-weight across seasons (most-recent first).
  const pointsByPlayer = new Map<string, number>();
  for (const [playerId, seasons] of byPlayerSeason) {
    const position = positionByPlayer.get(playerId);
    if (!position) continue;
    const seasonNums = [...seasons.keys()].sort((a, b) => b - a);
    const seasonPointsDesc = seasonNums.map((s) =>
      scoreSeasonLine(position, seasons.get(s)!, config),
    );
    pointsByPlayer.set(playerId, recencyWeightedScore(seasonPointsDesc, config.recencyWeights));
  }

  return { pointsByPlayer, positionByPlayer, seasonsUsed: recentSeasons };
}
