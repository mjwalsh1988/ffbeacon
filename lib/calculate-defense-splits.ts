/**
 * Rebuild nfl_defense_vs_position: how generous each NFL defense is to each
 * fantasy position.
 *
 * Why we compute this ourselves rather than trusting the projection feed:
 * Sleeper's weekly projections barely move across a season. Measured on the
 * 2026 slate, a player's best and worst projected week differ by only 2.6% to
 * 5.4%, which means Sleeper is publishing a season average with a rounding
 * error attached rather than a real opponent adjustment. Strength of schedule
 * built on those numbers would rank every team identically.
 *
 * We have what we need to do it properly: player_stats holds 228k regular
 * season rows back to 2020, with `opponent` populated on every one.
 *
 * Method, per (season, position, scoring):
 *   1. For each game, take the fantasy points each player scored against the
 *      defense they faced.
 *   2. Keep only startable performances. A defense is not "generous" because a
 *      practice squad receiver caught one pass against them, so we rank players
 *      within each team-week and keep the top N at each position, N being how
 *      many of that position a normal lineup starts.
 *   3. Average per game faced, compare to the league average, clamp.
 *
 * Derived from internal data, so no metadata column. Run after the stats sync.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

/** The scoring bases we publish splits for. */
const SCORING_BASES = ["pts_ppr", "pts_half_ppr", "pts_std"] as const;
type ScoringBase = (typeof SCORING_BASES)[number];

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type Position = (typeof POSITIONS)[number];

/**
 * How many of each position a typical lineup starts league-wide. Used to keep
 * deep-bench performances from diluting a defense's average.
 */
const STARTABLE_PER_TEAM: Record<Position, number> = {
  QB: 1,
  RB: 3,
  WR: 4,
  TE: 2,
  K: 1,
  DEF: 1,
};

/** Multiplier bounds. A defense cannot swing a projection more than this. */
const MIN_MULTIPLIER = 0.8;
const MAX_MULTIPLIER = 1.25;

/** Seasons with fewer sampled games than this are not published. */
const MIN_GAMES = 4;

type StatRow = {
  player_id: string | null;
  season: number;
  week: number;
  opponent: string | null;
  gp: number | null;
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  position: string | null;
};

export type DefenseSplitsResult = {
  seasons: number[];
  rowsWritten: number;
  durationMs: number;
};

export async function runCalculateDefenseSplits(
  supabase: ServiceClient,
  options: { seasons?: number[] } = {},
): Promise<DefenseSplitsResult> {
  const started = Date.now();

  const seasons = options.seasons ?? (await recentSeasons(supabase));
  let rowsWritten = 0;

  for (const season of seasons) {
    const rows = await loadSeasonStats(supabase, season);
    if (rows.length === 0) {
      console.log(`  ${season}: no stats, skipped`);
      continue;
    }

    for (const scoring of SCORING_BASES) {
      const written = await buildSeasonScoring(supabase, season, scoring, rows);
      rowsWritten += written;
      console.log(`  ${season} ${scoring}: ${written} defense rows`);
    }
  }

  return { seasons, rowsWritten, durationMs: Date.now() - started };
}

/** The last three completed seasons that have stats. */
async function recentSeasons(supabase: ServiceClient): Promise<number[]> {
  const { data } = await supabase
    .from("player_stats")
    .select("season")
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .limit(1);
  const latest = data?.[0]?.season ? Number(data[0].season) : new Date().getFullYear() - 1;
  return [latest, latest - 1, latest - 2];
}

async function loadSeasonStats(supabase: ServiceClient, season: number): Promise<StatRow[]> {
  const out: StatRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_stats")
      .select("player_id, season, week, opponent, gp, pts_ppr, pts_half_ppr, pts_std, players(position)")
      .eq("season", season)
      .eq("season_type", "regular")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`defense splits stat load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      const joined = (row as unknown as { players?: { position?: string } | null }).players;
      out.push({
        player_id: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        opponent: row.opponent,
        gp: row.gp === null ? null : Number(row.gp),
        pts_ppr: row.pts_ppr === null ? null : Number(row.pts_ppr),
        pts_half_ppr: row.pts_half_ppr === null ? null : Number(row.pts_half_ppr),
        pts_std: row.pts_std === null ? null : Number(row.pts_std),
        position: joined?.position ?? null,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

function pointsFor(row: StatRow, scoring: ScoringBase): number | null {
  const value =
    scoring === "pts_half_ppr" ? row.pts_half_ppr : scoring === "pts_std" ? row.pts_std : row.pts_ppr;
  return value === null || !Number.isFinite(value) ? null : value;
}

async function buildSeasonScoring(
  supabase: ServiceClient,
  season: number,
  scoring: ScoringBase,
  rows: StatRow[],
): Promise<number> {
  // Group performances by (opponent, week, position) so we can keep only the
  // startable ones per game.
  type Bucket = { points: number[] };
  const byGame = new Map<string, Bucket>();

  for (const row of rows) {
    if (!row.opponent || !row.position) continue;
    const position = row.position.toUpperCase() as Position;
    if (!POSITIONS.includes(position)) continue;
    if (!row.gp || row.gp <= 0) continue;
    const points = pointsFor(row, scoring);
    if (points === null) continue;

    const key = `${row.opponent}|${row.week}|${position}`;
    const bucket = byGame.get(key) ?? { points: [] };
    bucket.points.push(points);
    byGame.set(key, bucket);
  }

  // Sum the startable performances each defense allowed per game.
  type Accum = { total: number; games: number };
  const byDefense = new Map<string, Accum>();

  for (const [key, bucket] of byGame) {
    const [team, , position] = key.split("|");
    const cap = STARTABLE_PER_TEAM[position as Position] ?? 3;
    const top = bucket.points.sort((a, b) => b - a).slice(0, cap);
    const total = top.reduce((sum, p) => sum + p, 0);

    const defenseKey = `${team}|${position}`;
    const accum = byDefense.get(defenseKey) ?? { total: 0, games: 0 };
    accum.total += total;
    accum.games += 1;
    byDefense.set(defenseKey, accum);
  }

  // League average per position, then the multiplier for each defense.
  const perPosition = new Map<Position, number[]>();
  for (const [key, accum] of byDefense) {
    if (accum.games < MIN_GAMES) continue;
    const position = key.split("|")[1] as Position;
    const perGame = accum.total / accum.games;
    const list = perPosition.get(position) ?? [];
    list.push(perGame);
    perPosition.set(position, list);
  }

  const averages = new Map<Position, number>();
  for (const [position, values] of perPosition) {
    const sum = values.reduce((a, b) => a + b, 0);
    averages.set(position, values.length > 0 ? sum / values.length : 0);
  }

  const inserts: Database["public"]["Tables"]["nfl_defense_vs_position"]["Insert"][] = [];
  const rankPool = new Map<Position, Array<{ team: string; perGame: number }>>();

  for (const [key, accum] of byDefense) {
    if (accum.games < MIN_GAMES) continue;
    const [team, positionRaw] = key.split("|");
    const position = positionRaw as Position;
    const average = averages.get(position) ?? 0;
    if (average <= 0) continue;

    const perGame = accum.total / accum.games;
    const raw = perGame / average;
    const multiplier = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, raw));

    const pool = rankPool.get(position) ?? [];
    pool.push({ team, perGame });
    rankPool.set(position, pool);

    inserts.push({
      team,
      season,
      position,
      scoring,
      points_allowed_per_game: round(perGame, 3),
      league_average: round(average, 3),
      multiplier: round(multiplier, 4),
      generosity_rank: null,
      games_sampled: accum.games,
      computed_at: new Date().toISOString(),
    });
  }

  // Rank 1 = most generous to the position.
  const rankByKey = new Map<string, number>();
  for (const [position, pool] of rankPool) {
    pool.sort((a, b) => b.perGame - a.perGame);
    pool.forEach((entry, i) => rankByKey.set(`${entry.team}|${position}`, i + 1));
  }
  for (const insert of inserts) {
    insert.generosity_rank = rankByKey.get(`${insert.team}|${insert.position}`) ?? null;
  }

  if (inserts.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from("nfl_defense_vs_position")
      .upsert(inserts.slice(i, i + CHUNK), { onConflict: "team,season,position,scoring" });
    if (error) throw new Error(`nfl_defense_vs_position upsert failed: ${error.message}`);
  }
  return inserts.length;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
