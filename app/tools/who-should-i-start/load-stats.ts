/**
 * Server-side loader for the Beacon Breakdown "Stats" tab. Pulls every
 * player's weekly regular-season stats in one paged query (never a loop of
 * awaits, one round trip per 1000-row page), maps them to the profile's
 * GameRow shape (with PPR points read from the denormalized pts_ppr column),
 * aggregates per season, and groups the weekly rows by season for the client
 * comparison UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WeeklyStatRow } from "@/lib/player-profile";
import { aggregateSeasons, type GameRow } from "@/components/player-profile/stat-shaping";
import type { PlayerStatsPayload } from "./stats-data";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** A single player's identity fields the payload needs for labeling. */
type StatsPlayer = { id: string; name: string; position: string };

/** How many rows a paged read asks for at a time. PostgREST caps a plain
 *  select() at 1000 rows and truncates silently past it (see
 *  lib/manager-ledger/load.ts for the same pattern). Two to eight players'
 *  worth of weekly regular-season rows can pass 1000 combined even though no
 *  single player's history does, so this loader pages rather than trusting
 *  one unbounded select(). */
const PAGE = 1000;

type PlayerStatRow = WeeklyStatRow & { player_id: string };

const STATS_COLUMNS =
  "player_id, season, week, opponent, snap_pct, gp, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, rec_tgt, rec_yd, rec_td, pts_ppr, pts_half_ppr, pts_std";

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
    pts_ppr: r.pts_ppr ?? 0,
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

/**
 * Every regular-season weekly stat row for a list of players (two to eight),
 * in one paged query rather than a query per player: the read is
 * `.in("player_id", ids)`, so it is a single round trip per 1000-row page
 * regardless of N, and pages loop sequentially (each page's own round trip)
 * rather than issuing N per-player queries or a loop of per-player awaits.
 */
async function loadWeeklyStatsForPlayers(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, WeeklyStatRow[]>> {
  const byPlayer = new Map<string, WeeklyStatRow[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byPlayer;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_stats")
      .select(STATS_COLUMNS)
      .in("player_id", ids)
      .eq("season_type", "regular")
      .order("player_id", { ascending: true })
      .order("season", { ascending: false })
      .order("week", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data as unknown as PlayerStatRow[]) {
      byPlayer.get(row.player_id)?.push(row);
    }
    if (data.length < PAGE) break;
  }

  return byPlayer;
}

/** Loads and shapes the Stats tab payload for every player in the board (two
 *  to eight), in one paged query wave. */
export async function loadBreakdownStats(
  supabase: AnySupabase,
  players: StatsPlayer[],
): Promise<PlayerStatsPayload[]> {
  const db = supabase as SupabaseClient<Database>;
  const rowsByPlayer = await loadWeeklyStatsForPlayers(
    db,
    players.map((p) => p.id),
  );
  return players.map((p) => shape(p, rowsByPlayer.get(p.id) ?? []));
}
