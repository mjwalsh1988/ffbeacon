/**
 * Read and aggregate season stats for BEAM.
 *
 * ONE FIXED SELECT. The column list below is a constant, not built from the
 * stats a question asked for. That is deliberate: a select string assembled from
 * anything user-influenced is the only way a closed registry could still leak
 * into a query, and a fixed list costs nothing here. A season is at most 18 rows
 * per player, so fetching thirty numeric columns for two players is a few
 * kilobytes.
 *
 * WHY AGGREGATE IN TYPESCRIPT. player_stats is weekly and there is no
 * season-total table. PostgREST cannot express SUM without an RPC, and an RPC
 * per stat shape would be a migration every time the registry grows. Summing 18
 * rows in memory is faster than the round trip it would save.
 *
 * NULL IS NOT ZERO. pts_ppr and friends are nullable: null means Sleeper never
 * published that scoring base for that week, not that the player scored nothing.
 * Coalescing to zero would quietly understate a season, so the aggregate counts
 * how many weeks actually carried a number and the presenter says so when
 * coverage is partial.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringKey } from "@/lib/player-profile";
import { getStat, type BeamStat, type BeamStatId, type StatColumn } from "./registry";

/** Every column the aggregator can read. Fixed at compile time. */
const STAT_SELECT = [
  "week",
  "gp",
  "gs",
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_att",
  "pass_cmp",
  "pass_sack",
  "pass_rz_att",
  "rush_yd",
  "rush_td",
  "rush_att",
  "rush_rz_att",
  "rush_lng",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_tgt",
  "rec_air_yd",
  "rec_drop",
  "target_share",
  "snap_pct",
  "fum_lost",
  "fgm",
  "fga",
  "xpm",
  "sack",
  "interceptions",
  "def_td",
  "pts_allow",
  "pts_ppr",
  "pts_half_ppr",
  "pts_std",
].join(", ");

/** An inclusive stretch of weeks inside one season. */
export type WeekWindow = { start: number; end: number };

export type SeasonAggregate = {
  playerId: string;
  season: number;
  /** The week window this was aggregated over, or null for the whole season. */
  window: WeekWindow | null;
  /** Weekly rows we hold for the season, or for the window when one was given. */
  weeks: number;
  /** Sum of the games-played flag. The denominator for any per-game figure. */
  gamesPlayed: number;
  /** Column sums. Missing values contribute nothing. */
  sums: Record<StatColumn, number>;
  /** Column maxima, for "longest run" style stats. */
  maxes: Record<StatColumn, number>;
  /** Weeks where the column carried a real (non-null) value. */
  present: Record<StatColumn, number>;
  fantasy: {
    total: number;
    /** Weeks that carried a number for the active scoring base. */
    weeksWithPoints: number;
  };
};

type StatRow = Record<string, number | null> & { week: number };

const ZERO_COLUMNS: StatColumn[] = [
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_att",
  "pass_cmp",
  "pass_sack",
  "pass_rz_att",
  "rush_yd",
  "rush_td",
  "rush_att",
  "rush_rz_att",
  "rush_lng",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_tgt",
  "rec_air_yd",
  "rec_drop",
  "target_share",
  "snap_pct",
  "fum_lost",
  "gp",
  "gs",
  "fgm",
  "fga",
  "xpm",
  "sack",
  "interceptions",
  "def_td",
  "pts_allow",
];

function emptyRecord(): Record<StatColumn, number> {
  const out = {} as Record<StatColumn, number>;
  for (const c of ZERO_COLUMNS) out[c] = 0;
  return out;
}

/**
 * Season aggregates for one or more players.
 *
 * `seasonType` defaults to regular. Postseason is a separate ask and mixing them
 * silently would inflate a season total by up to four games, which is exactly
 * the kind of quiet wrongness that makes an assistant untrustworthy.
 */
export async function loadSeasonAggregates(
  db: SupabaseClient<Database>,
  playerIds: string[],
  season: number,
  scoringKey: ScoringKey,
  seasonType: "regular" | "post" = "regular",
  /**
   * Restrict to an inclusive stretch of weeks. The filter goes in the query
   * rather than being applied to the rows afterwards so a five-week question
   * reads five rows, and so the same index serves both shapes.
   */
  window: WeekWindow | null = null,
): Promise<Map<string, SeasonAggregate>> {
  const out = new Map<string, SeasonAggregate>();
  if (playerIds.length === 0) return out;

  let query = db
    .from("player_stats")
    .select(`player_id, ${STAT_SELECT}`)
    .in("player_id", playerIds)
    .eq("season", season)
    .eq("season_type", seasonType);

  if (window) {
    query = query.gte("week", window.start).lte("week", window.end);
  }

  // 18 weeks x a handful of players. The cap is a guard, not a page.
  const { data, error } = await query.limit(playerIds.length * 25);

  if (error) {
    console.error("[beam] season stat read failed", error);
    return out;
  }

  for (const playerId of playerIds) {
    out.set(playerId, {
      playerId,
      season,
      window,
      weeks: 0,
      gamesPlayed: 0,
      sums: emptyRecord(),
      maxes: emptyRecord(),
      present: emptyRecord(),
      fantasy: { total: 0, weeksWithPoints: 0 },
    });
  }

  for (const raw of (data ?? []) as unknown as Array<StatRow & { player_id: string }>) {
    const agg = out.get(raw.player_id);
    if (!agg) continue;
    agg.weeks += 1;

    for (const column of ZERO_COLUMNS) {
      const value = raw[column];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      agg.sums[column] += value;
      agg.present[column] += 1;
      if (value > agg.maxes[column]) agg.maxes[column] = value;
    }

    const points = raw[scoringKey];
    if (typeof points === "number" && Number.isFinite(points)) {
      agg.fantasy.total += points;
      agg.fantasy.weeksWithPoints += 1;
    }
  }

  for (const agg of out.values()) {
    agg.gamesPlayed = agg.sums.gp;
  }

  return out;
}

/** A computed stat value, or null when the stat is undefined for these inputs. */
export type StatValue = {
  statId: BeamStatId;
  value: number | null;
  /**
   * True when the season produced rows but this stat had nothing in any of them.
   * A real zero (a quarterback with no rushing yards) reads differently from a
   * stat we never received, and the presenter needs to tell them apart.
   */
  isTrueZero: boolean;
};

/**
 * Apply a stat's aggregation rule to a season aggregate.
 *
 * Returns null rather than zero whenever the answer is undefined: yards per
 * carry with no carries, a completion rate with no attempts, any stat at all
 * when we hold no weekly rows. "We do not have that" and "it was zero" are
 * different answers and the presenter renders them differently.
 */
export function computeStat(stat: BeamStat, agg: SeasonAggregate): StatValue {
  const nullValue: StatValue = { statId: stat.id, value: null, isTrueZero: false };
  if (agg.weeks === 0) return nullValue;

  switch (stat.aggregation.kind) {
    case "sum": {
      const column = stat.aggregation.column;
      // A column that was null in every week we hold was never measured, and
      // reporting it as zero would say the player recorded none of something we
      // simply do not have. Air yards are null on 91% of 2025 rows, so this is
      // the common case, not a corner.
      if (agg.present[column] === 0) return nullValue;
      const value = agg.sums[column];
      return { statId: stat.id, value, isTrueZero: value === 0 };
    }
    case "max": {
      const column = stat.aggregation.column;
      if (agg.present[column] === 0) return nullValue;
      const value = agg.maxes[column];
      return { statId: stat.id, value, isTrueZero: value === 0 };
    }
    case "ratio": {
      const numerator = agg.sums[stat.aggregation.numerator];
      const denominator = agg.sums[stat.aggregation.denominator];
      if (denominator <= 0) return nullValue;
      const scale = stat.aggregation.scale ?? 1;
      return { statId: stat.id, value: (numerator / denominator) * scale, isTrueZero: false };
    }
    case "combine": {
      // A combination is measured when at least one of its parts was. Total
      // yards for a receiver is real even though his passing yards column is
      // untouched; total yards for a player we hold nothing on is not.
      const anyPresent = stat.aggregation.columns.some((c) => agg.present[c] > 0);
      if (!anyPresent) return nullValue;
      const values = stat.aggregation.columns.map((c) => agg.sums[c]);
      const value = stat.aggregation.combine(values);
      return { statId: stat.id, value, isTrueZero: value === 0 };
    }
    case "avgPerGame": {
      const column = stat.aggregation.column;
      const weeksWithValue = agg.present[column];
      if (weeksWithValue === 0) return nullValue;
      return {
        statId: stat.id,
        value: agg.sums[column] / weeksWithValue,
        isTrueZero: false,
      };
    }
    case "games": {
      return { statId: stat.id, value: agg.gamesPlayed, isTrueZero: agg.gamesPlayed === 0 };
    }
    case "fantasy": {
      if (agg.fantasy.weeksWithPoints === 0) return nullValue;
      if (!stat.aggregation.perGame) {
        return { statId: stat.id, value: agg.fantasy.total, isTrueZero: agg.fantasy.total === 0 };
      }
      const games = agg.gamesPlayed > 0 ? agg.gamesPlayed : agg.fantasy.weeksWithPoints;
      if (games <= 0) return nullValue;
      return { statId: stat.id, value: agg.fantasy.total / games, isTrueZero: false };
    }
    default:
      return nullValue;
  }
}

export function computeStatById(statId: BeamStatId, agg: SeasonAggregate): StatValue {
  return computeStat(getStat(statId), agg);
}

/**
 * How complete the fantasy-points coverage was for a season, as a caveat string,
 * or null when it was complete enough to say nothing.
 */
export function coverageCaveat(agg: SeasonAggregate): string | null {
  if (agg.weeks === 0) return null;
  if (agg.fantasy.weeksWithPoints === 0) return null;
  if (agg.fantasy.weeksWithPoints >= agg.weeks) return null;
  const missing = agg.weeks - agg.fantasy.weeksWithPoints;
  return `Fantasy points are missing for ${missing} of the ${agg.weeks} weeks we hold, so the total is a floor.`;
}
