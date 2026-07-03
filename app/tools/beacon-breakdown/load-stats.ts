/**
 * Server-side loader for the Beacon Breakdown "Stats" tab. Pulls each player's
 * weekly regular-season stats, maps them to the profile's GameRow shape (with
 * PPR points read from the metadata jsonb), aggregates per season, and groups
 * the weekly rows by season for the client comparison UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  loadWeeklyStats,
  readPoints,
  type WeeklyStatRow,
} from "@/lib/player-profile";
import { aggregateSeasons, type GameRow } from "@/components/player-profile/stat-shaping";
import type { PlayerStatsPayload } from "./stats-data";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** A single player's identity fields the payload needs for labeling. */
type StatsPlayer = { id: string; name: string; position: string };

function toGameRow(r: WeeklyStatRow): GameRow {
  return {
    season: r.season,
    week: r.week,
    opponent: r.opponent,
    snap_pct: r.snap_pct,
    gp: r.gp,
    pass_cmp: r.pass_cmp ?? 0,
    pass_att: r.pass_att ?? 0,
    pass_yd: r.pass_yd ?? 0,
    pass_td: r.pass_td ?? 0,
    pass_int: r.pass_int ?? 0,
    rush_att: r.rush_att ?? 0,
    rush_yd: r.rush_yd ?? 0,
    rush_td: r.rush_td ?? 0,
    rec: r.rec ?? 0,
    rec_tgt: r.rec_tgt ?? 0,
    rec_yd: r.rec_yd ?? 0,
    rec_td: r.rec_td ?? 0,
    pts_ppr: readPoints(r.metadata, "pts_ppr"),
  };
}

function shape(player: StatsPlayer, rows: WeeklyStatRow[]): PlayerStatsPayload {
  const gameRows = rows.map(toGameRow);
  const seasonAggs = aggregateSeasons(gameRows);

  const weeklyBySeason: Record<number, GameRow[]> = {};
  for (const r of gameRows) {
    (weeklyBySeason[r.season] ??= []).push(r);
  }
  // Weeks ascending within each season for a natural game-log reading order.
  for (const season of Object.keys(weeklyBySeason)) {
    weeklyBySeason[Number(season)].sort((a, b) => a.week - b.week);
  }

  const seasons = Object.keys(weeklyBySeason)
    .map(Number)
    .sort((a, b) => b - a);

  return {
    name: player.name,
    position: player.position,
    seasons,
    seasonAggs,
    weeklyBySeason,
  };
}

export async function loadBreakdownStats(
  supabase: AnySupabase,
  a: StatsPlayer,
  b: StatsPlayer,
): Promise<{ a: PlayerStatsPayload; b: PlayerStatsPayload }> {
  const db = supabase as SupabaseClient<Database>;
  const [rowsA, rowsB] = await Promise.all([
    loadWeeklyStats(db, a.id),
    loadWeeklyStats(db, b.id),
  ]);
  return { a: shape(a, rowsA), b: shape(b, rowsB) };
}
