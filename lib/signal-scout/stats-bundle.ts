/**
 * Stats bundle for Signal Scout clue generation.
 *
 * Loads one player's 2020+ regular-season weekly stats, aggregates them with
 * the shared aggregateSeasons helper, and derives the season-level, career-high,
 * and positional-finish facts the stat clue generator needs. Everything here is
 * a frozen read at round-start time; nothing is cached.
 *
 * loadWeeklyStats (lib/player-profile.ts) has no season-floor parameter, so the
 * 2020+ query is built locally here rather than adding one there. The weekly
 * row to GameRow mapping intentionally mirrors the existing duplicates in
 * components/player-profile/stats-tab.tsx and
 * app/tools/beacon-breakdown/load-stats.ts field-for-field; it is a third copy
 * kept in sync by hand until those are extracted, not a divergent reading of
 * the same rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readPoints, type WeeklyStatRow } from "@/lib/player-profile";
import { aggregateSeasons, type GameRow, type SeasonAgg } from "@/components/player-profile/stat-shaping";

const STATS_FLOOR_SEASON = 2020;

export type CareerHighEntry = { season: number; value: number };

export type FinishRow = { season: number; finish: number; playersRanked: number };

export type StatsBundle = {
  /** False when the player has no 2020+ regular-season weekly rows at all. */
  hasData: boolean;
  /** Season aggregates, most recent first (aggregateSeasons' own ordering). */
  seasons: SeasonAgg[];
  /** The most recent season with at least one game played (gp > 0), or null. */
  lastSeason: SeasonAgg | null;
  careerHighs: {
    points: CareerHighEntry | null;
    totalYards: CareerHighEntry | null;
  };
  /** One-decimal PPR points per game, keyed by season. */
  pointsPerGame: Record<number, number | null>;
  finishes: {
    /** PPR-only finish rows, most recent season first. */
    seasons: FinishRow[];
    /** Lowest finish number (best) since 2020; ties keep the more recent season. */
    bestFinish: FinishRow | null;
  };
};

/** Mirrors the toGameRow mapping in stats-tab.tsx / load-stats.ts field-for-field. */
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

/**
 * PPR points per game, one decimal, matching the rounding stats-tab.tsx uses
 * for the same figure (`.toFixed(1)`). Null when no games were played.
 */
export function pointsPerGame(totalPoints: number, games: number): number | null {
  if (games <= 0) return null;
  return Number((totalPoints / games).toFixed(1));
}

/**
 * Career-high fantasy points and total yards (pass + rush + rec) across the
 * given seasons. Pure and order-sensitive: ties are broken by keeping the
 * first season encountered, so callers should pass seasons most-recent-first
 * (aggregateSeasons' own ordering) to make "more recent season wins ties" the
 * effective rule.
 */
export function deriveCareerHighs(seasons: SeasonAgg[]): StatsBundle["careerHighs"] {
  let points: CareerHighEntry | null = null;
  let totalYards: CareerHighEntry | null = null;

  for (const s of seasons) {
    if (points === null || s.line.pts_ppr > points.value) {
      points = { season: s.season, value: s.line.pts_ppr };
    }
    const yards = s.line.pass_yd + s.line.rush_yd + s.line.rec_yd;
    if (totalYards === null || yards > totalYards.value) {
      totalYards = { season: s.season, value: yards };
    }
  }

  return { points, totalYards };
}

/**
 * PPR positional finishes for the given seasons via the get_player_positional_finishes
 * RPC. Tolerates RPC failure (network error, thrown exception) by returning an
 * empty result rather than propagating, since a missing finish clue is fine but
 * a broken round start is not.
 */
async function loadFinishes(
  supabase: SupabaseClient<Database>,
  playerId: string,
  seasons: number[],
): Promise<StatsBundle["finishes"]> {
  if (seasons.length === 0) return { seasons: [], bestFinish: null };

  try {
    const { data, error } = await supabase.rpc("get_player_positional_finishes", {
      p_player_id: playerId,
      p_seasons: seasons,
    });

    if (error || !data) {
      if (error) console.error("[signal-scout] positional finishes RPC failed", error);
      return { seasons: [], bestFinish: null };
    }

    const rows: FinishRow[] = (data as Array<Record<string, unknown>>)
      .filter((r) => String(r.scoring) === "pts_ppr")
      .map((r) => ({
        season: Number(r.season),
        finish: Number(r.finish),
        playersRanked: Number(r.players_ranked),
      }))
      .sort((a, b) => b.season - a.season);

    let bestFinish: FinishRow | null = null;
    for (const row of rows) {
      if (bestFinish === null || row.finish < bestFinish.finish) {
        bestFinish = row;
      }
    }

    return { seasons: rows, bestFinish };
  } catch (err) {
    console.error("[signal-scout] positional finishes RPC threw", err);
    return { seasons: [], bestFinish: null };
  }
}

/**
 * Loads and shapes the full 2020+ stats bundle for one player. Never throws on
 * missing data; a player with no 2020+ regular-season rows gets hasData: false
 * and empty/null fields throughout.
 */
export async function loadStatsBundle(
  supabase: SupabaseClient<Database>,
  playerId: string,
): Promise<StatsBundle> {
  const { data, error } = await supabase
    .from("player_stats")
    .select(
      "season, week, opponent, snap_pct, gp, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, rec_tgt, rec_yd, rec_td, metadata",
    )
    .eq("player_id", playerId)
    .eq("season_type", "regular")
    .gte("season", STATS_FLOOR_SEASON)
    .order("season", { ascending: false })
    .order("week", { ascending: false });

  // A failed query degrades to hasData false like a stat-less player, but the
  // failure itself should still be visible in server logs.
  if (error) console.error("[signal-scout] weekly stats query failed", error);

  const rawRows = (data ?? []) as WeeklyStatRow[];
  const hasData = rawRows.length > 0;

  const gameRows = rawRows.map(toGameRow);
  const seasons = aggregateSeasons(gameRows);
  const lastSeason = seasons.find((s) => s.games > 0) ?? null;
  const careerHighs = deriveCareerHighs(seasons);

  const pointsPerGameBySeason: Record<number, number | null> = {};
  for (const s of seasons) {
    pointsPerGameBySeason[s.season] = pointsPerGame(s.line.pts_ppr, s.games);
  }

  const finishes = hasData
    ? await loadFinishes(
        supabase,
        playerId,
        seasons.map((s) => s.season),
      )
    : { seasons: [], bestFinish: null };

  return {
    hasData,
    seasons,
    lastSeason,
    careerHighs,
    pointsPerGame: pointsPerGameBySeason,
    finishes,
  };
}
