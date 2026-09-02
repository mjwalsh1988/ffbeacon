/**
 * The projection scoreboard: how has each projection source actually done,
 * graded against real outcomes, per position and pooled.
 *
 * This is the transparency surface for PE-T052 (`/admin/projections`), and it
 * is deliberately NOT a read of `player_projection_accuracy`. That table holds
 * the recency-weighted, positionally-centered, shrunk multiplier the
 * projection engines apply, which answers "how much should we trust this
 * player right now". The scoreboard answers a plainer question, "has this
 * source's raw number been close, and biased which way", so it is computed
 * fresh, on demand, straight from `player_weekly_projections` joined to
 * `player_stats`. No new table: the admin page's own loader calls this module,
 * which pages through both tables and does the arithmetic in memory. It costs
 * one admin page render, not a migration.
 *
 * Every graded week is counted once, unweighted by recency, because a
 * scoreboard that quietly favors this week over August would misstate its own
 * headline. A "graded" week here means the source published a positive
 * projection for that player-week AND the player actually took the field
 * (`gp > 0`); a week nobody played yet, or a week the player was inactive,
 * contributes nothing to any of these figures. That is a narrower population
 * than `player_projection_accuracy.beat_rate` (which scores a missed week as a
 * loss rather than dropping it), and deliberately so: this page's job is to
 * say how good the NUMBER was, not how available the PLAYER was.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { withRetry } from "./supabase/retry";
import { createAdminClient } from "./supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "./cache-tags";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

export const SCOREBOARD_SCORING_BASES = ["pts_ppr", "pts_half_ppr", "pts_std"] as const;
export type ScoreboardScoringBase = (typeof SCOREBOARD_SCORING_BASES)[number];

export const SCOREBOARD_SCORING_LABELS: Record<ScoreboardScoringBase, string> = {
  pts_ppr: "PPR",
  pts_half_ppr: "Half PPR",
  pts_std: "Standard",
};

/**
 * Fewest graded weeks a calibration regression will run on. Below this a
 * slope is mostly noise, and this page would rather show "not enough games
 * yet" than a number that looks precise and is not.
 */
const MIN_WEEKS_FOR_SLOPE = 20;

export type ProjectionScoreboardRow = {
  /** The position, or "ALL" for the pooled row. */
  position: string;
  weeksGraded: number;
  playersScored: number;
  /** mean(|actual - projected|). Lower is better. Null with no graded weeks. */
  meanAbsoluteError: number | null;
  /** mean(actual - projected). The bias: 0 is unbiased, positive means the
   * source is sandbagging, negative means it is optimistic. */
  meanError: number | null;
  /** Share of graded weeks the player's actual met or beat the projection. */
  beatRate: number | null;
  /**
   * Slope of actual regressed on projected, within this position. 1.0 means
   * the source's spread matches reality; below 1.0 means it over-spreads
   * (its highs run too high, its lows too low), which the plan's own research
   * says is true of every source measured (Part 0 of the projection engine
   * plan). Null when there are fewer than MIN_WEEKS_FOR_SLOPE graded weeks.
   */
  calibrationSlope: number | null;
};

export type ProjectionScoreboardSource = {
  source: string;
  pooled: ProjectionScoreboardRow;
  byPosition: ProjectionScoreboardRow[];
};

export type ProjectionScoreboard = {
  scoring: ScoreboardScoringBase;
  /** ISO timestamp of the moment this scoreboard was actually computed. When
   * served from the cache, this is the cached computation's timestamp, not
   * the moment of the current page render, so the page can tell a reader
   * honestly how stale the figures might be. */
  computedAt: string;
  /** Every season with at least one projected week, newest first. */
  seasons: number[];
  sources: ProjectionScoreboardSource[];
};

type ProjRow = {
  playerId: string;
  season: number;
  week: number;
  source: string;
  ppr: number | null;
  halfPpr: number | null;
  std: number | null;
};

type ActualRow = {
  playerId: string;
  season: number;
  week: number;
  gp: number;
  ppr: number | null;
  halfPpr: number | null;
  std: number | null;
};

function pick(
  row: { ppr: number | null; halfPpr: number | null; std: number | null },
  scoring: ScoreboardScoringBase,
): number | null {
  if (scoring === "pts_half_ppr") return row.halfPpr;
  if (scoring === "pts_std") return row.std;
  return row.ppr;
}

export async function loadProjectionScoreboard(
  supabase: ServiceClient,
  scoring: ScoreboardScoringBase = "pts_ppr",
): Promise<ProjectionScoreboard> {
  const computedAt = new Date().toISOString();
  const projections = await loadProjections(supabase);
  if (projections.length === 0) return { scoring, computedAt, seasons: [], sources: [] };

  const seasons = [...new Set(projections.map((p) => p.season))].sort((a, b) => b - a);
  const actuals = await loadActuals(supabase, seasons);
  const positions = await loadPositions(supabase);

  const actualByKey = new Map<string, ActualRow>();
  for (const a of actuals) actualByKey.set(`${a.playerId}|${a.season}|${a.week}`, a);

  const bySource = new Map<string, ProjRow[]>();
  for (const p of projections) {
    const list = bySource.get(p.source) ?? [];
    list.push(p);
    bySource.set(p.source, list);
  }

  const sources = [...bySource]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, rows]) => summarizeSource(source, rows, actualByKey, positions, scoring));

  return { scoring, computedAt, seasons, sources };
}

/**
 * Cached entry point for the scoreboard, and the one the admin page should
 * call.
 *
 * `loadProjectionScoreboard` above pages through `player_weekly_projections`
 * (currently 51,330 rows and growing with every new season) joined against
 * `player_stats` (roughly 87,000 rows), a full scan with no narrowing filter.
 * Measured against production, one render of this page cost 774 ms and about
 * 140 paged round trips. The underlying rows only change when the nightly
 * stats sync (`player_stats`) or projections sync (`player_weekly_projections`)
 * run, so recomputing this on every admin page view is pure waste: every other
 * derived-metric surface in this codebase (Power Pulse, Positional WAR, league
 * power rankings) precomputes on a TTL rather than recomputing per render, and
 * this follows the same shape.
 *
 * TTL is CACHE_TTL.daily (24h), matching the nightly cadence of the syncs that
 * actually change this data; anything shorter would just re-run the same 140
 * round trips for numbers that have not moved. That TTL is only the backstop:
 * `CACHE_TAGS.playerProjections` and `CACHE_TAGS.playerStats` are revalidated
 * by `app/api/cron/sync-weekly-projections/route.ts` and
 * `app/api/cron/sync-sleeper-stats/route.ts` respectively, so a fresh nightly
 * sync busts this cache immediately rather than waiting out the TTL.
 * `CACHE_TAGS.playerDepth` is included too since `loadPositions` reads the
 * `players` table, the same domain `loadDepthChartCached` tags.
 *
 * Creates its own admin client rather than accepting one as a parameter:
 * unstable_cache forbids reading request state such as cookies, and this
 * keeps the cached call independent of whatever client the caller happens to
 * be holding, matching the pattern in lib/player-profile-cache.ts and
 * lib/faab/outlook.ts loadPositionProjectionsCached.
 */
export function loadProjectionScoreboardCached(
  scoring: ScoreboardScoringBase = "pts_ppr",
): Promise<ProjectionScoreboard> {
  return unstable_cache(
    () => loadProjectionScoreboard(createAdminClient(), scoring),
    ["projection-scoreboard", scoring],
    {
      revalidate: CACHE_TTL.daily,
      tags: [CACHE_TAGS.playerProjections, CACHE_TAGS.playerStats, CACHE_TAGS.playerDepth],
    },
  )();
}

type Bucket = {
  players: Set<string>;
  weeksGraded: number;
  absDiffSum: number;
  diffSum: number;
  beatCount: number;
  n: number;
  sumX: number;
  sumY: number;
  sumXY: number;
  sumXX: number;
};

function newBucket(): Bucket {
  return {
    players: new Set(),
    weeksGraded: 0,
    absDiffSum: 0,
    diffSum: 0,
    beatCount: 0,
    n: 0,
    sumX: 0,
    sumY: 0,
    sumXY: 0,
    sumXX: 0,
  };
}

function addToBucket(bucket: Bucket, playerId: string, projected: number, actual: number): void {
  const diff = actual - projected;
  bucket.players.add(playerId);
  bucket.weeksGraded += 1;
  bucket.absDiffSum += Math.abs(diff);
  bucket.diffSum += diff;
  if (actual >= projected) bucket.beatCount += 1;
  bucket.n += 1;
  bucket.sumX += projected;
  bucket.sumY += actual;
  bucket.sumXY += projected * actual;
  bucket.sumXX += projected * projected;
}

/**
 * OLS slope of actual on projected, one pass, from the running sums. Cheap
 * (O(graded weeks), no matrix work), which is why this page computes it
 * rather than omitting it.
 */
function calibrationSlope(bucket: Bucket): number | null {
  if (bucket.n < MIN_WEEKS_FOR_SLOPE) return null;
  const meanX = bucket.sumX / bucket.n;
  const meanY = bucket.sumY / bucket.n;
  const covXY = bucket.sumXY / bucket.n - meanX * meanY;
  const varX = bucket.sumXX / bucket.n - meanX * meanX;
  if (!(varX > 0)) return null;
  const slope = covXY / varX;
  return Number.isFinite(slope) ? round(slope, 3) : null;
}

function finishBucket(position: string, bucket: Bucket): ProjectionScoreboardRow {
  return {
    position,
    weeksGraded: bucket.weeksGraded,
    playersScored: bucket.players.size,
    meanAbsoluteError: bucket.weeksGraded > 0 ? round(bucket.absDiffSum / bucket.weeksGraded, 3) : null,
    meanError: bucket.weeksGraded > 0 ? round(bucket.diffSum / bucket.weeksGraded, 3) : null,
    beatRate: bucket.weeksGraded > 0 ? round(bucket.beatCount / bucket.weeksGraded, 4) : null,
    calibrationSlope: calibrationSlope(bucket),
  };
}

function summarizeSource(
  source: string,
  rows: ProjRow[],
  actualByKey: Map<string, ActualRow>,
  positions: Map<string, string>,
  scoring: ScoreboardScoringBase,
): ProjectionScoreboardSource {
  const pooled = newBucket();
  const byPosition = new Map<string, Bucket>();

  for (const row of rows) {
    const projected = pick(row, scoring);
    if (projected === null || projected <= 0) continue;

    const actualRow = actualByKey.get(`${row.playerId}|${row.season}|${row.week}`);
    if (!actualRow || actualRow.gp <= 0) continue;

    const actual = pick(actualRow, scoring) ?? 0;
    addToBucket(pooled, row.playerId, projected, actual);

    const position = positions.get(row.playerId);
    if (position) {
      const bucket = byPosition.get(position) ?? newBucket();
      addToBucket(bucket, row.playerId, projected, actual);
      byPosition.set(position, bucket);
    }
  }

  return {
    source,
    pooled: finishBucket("ALL", pooled),
    byPosition: [...byPosition.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([position, bucket]) => finishBucket(position, bucket)),
  };
}

async function loadProjections(supabase: ServiceClient): Promise<ProjRow[]> {
  const out: ProjRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("player_weekly_projections")
          .select(
            "player_id, season, week, source, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
          )
          .eq("season_type", "regular")
          .not("player_id", "is", null)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1),
      { label: `scoreboard projections page ${from}` },
    );
    if (error) throw new Error(`scoreboard projection load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        source: row.source,
        ppr: numOrNull(row.projected_pts_ppr),
        halfPpr: numOrNull(row.projected_pts_half_ppr),
        std: numOrNull(row.projected_pts_std),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadActuals(supabase: ServiceClient, seasons: number[]): Promise<ActualRow[]> {
  const out: ActualRow[] = [];
  if (seasons.length === 0) return out;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("player_stats")
          .select("player_id, season, week, gp, pts_ppr, pts_half_ppr, pts_std")
          .eq("season_type", "regular")
          .in("season", seasons)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1),
      { label: `scoreboard actuals page ${from}` },
    );
    if (error) throw new Error(`scoreboard actual load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        gp: Number(row.gp ?? 0),
        ppr: numOrNull(row.pts_ppr),
        halfPpr: numOrNull(row.pts_half_ppr),
        std: numOrNull(row.pts_std),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadPositions(supabase: ServiceClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("players")
          .select("id, position")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1),
      { label: `scoreboard positions page ${from}` },
    );
    if (error) throw new Error(`scoreboard position load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.set(row.id, row.position);
    if (data.length < PAGE) break;
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
