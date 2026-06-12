/**
 * Calculate per-(player, format, source) value trends (library form).
 * See scripts/calculate-trends.ts header for the full algorithm description.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkUpsert } from "./supabase/retry";
import type { Database } from "./database.types";

type HistoryRow = {
  player_id: string;
  format_config_id: string;
  source: string;
  value: number;
  captured_at: string;
};

type Direction = "up" | "down" | "stable";

const TREND_THRESHOLD_PCT = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The deepest lookback any output field needs is 135 days: value_90d_ago and
// rank_90d_ago anchor at t90 with a half-window (45-day) staleness tolerance
// (90 + 45 = 135). Every other field is a subset of that. We load 140 days (a
// small safety margin past 135) and nothing older, because rows older than the
// 90d-window floor can never affect any column written to player_value_trends.
// This keeps the nightly load to the recent slice of the ~1M-row history table.
export const HISTORY_LOOKBACK_DAYS = 140;

function direction(changePct: number | null): Direction | null {
  if (changePct === null) return null;
  if (changePct > TREND_THRESHOLD_PCT) return "up";
  if (changePct < -TREND_THRESHOLD_PCT) return "down";
  return "stable";
}

function valueAtOrBefore(
  rowsDesc: HistoryRow[],
  targetMs: number,
  windowDays: number,
): number | null {
  const maxStaleMs = targetMs - windowDays * 0.5 * MS_PER_DAY;
  for (const row of rowsDesc) {
    const tsMs = new Date(row.captured_at).getTime();
    if (tsMs > targetMs) continue;
    if (tsMs < maxStaleMs) return null;
    return row.value;
  }
  return null;
}

function pctChange(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function populationStddev(samples: number[]): number | null {
  if (samples.length < 2) return null;
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const variance =
    samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance);
}

function dayKey(captured_at: string): string {
  return captured_at.slice(0, 10);
}

function pickAnchorDay(
  daysDesc: string[],
  targetMs: number,
  windowDays: number,
): string | null {
  const maxStaleMs = targetMs - windowDays * 0.5 * MS_PER_DAY;
  for (const day of daysDesc) {
    const ts = new Date(`${day}T12:00:00.000Z`).getTime();
    if (ts > targetMs) continue;
    if (ts < maxStaleMs) return null;
    return day;
  }
  return null;
}

/**
 * Load player_value_history via keyset pagination by primary key (id).
 *
 * Keyset on id avoids deep OFFSET scans that exceed Supabase's statement
 * timeout on the ~1M-row history table, and avoids the tie-breaking problem of
 * paginating by captured_at (a single backfill day can have ~5000 rows all
 * sharing the same UTC-noon timestamp). captured_at sort is applied client-side
 * per-group by the caller.
 *
 * When `sinceIso` is provided, only rows with captured_at >= sinceIso are
 * loaded (backed by idx_player_value_history_captured_at). The nightly trend
 * calc passes a 140-day cutoff so it never ships the ~70% of the table that is
 * older than any window the math uses. Pass undefined to load all history.
 *
 * Page size is capped at Supabase's configured PostgREST db-max-rows (1000).
 * Requesting more silently truncates the response.
 */
export async function loadAllHistory(
  supabase: SupabaseClient<Database>,
  sinceIso?: string,
): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  const PAGE = 1000;
  let cursor: string | null = null;
  for (;;) {
    let query = supabase
      .from("player_value_history")
      .select("id, player_id, format_config_id, source, value, captured_at")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (sinceIso) query = query.gte("captured_at", sinceIso);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    cursor = (data[data.length - 1] as { id: string }).id;
  }
  return rows;
}

export type TrendRow = {
  player_id: string;
  format_config_id: string;
  source: string;
  current_value: number;
  value_7d_ago: number | null;
  value_30d_ago: number | null;
  value_90d_ago: number | null;
  change_7d: number | null;
  change_7d_pct: number | null;
  change_30d: number | null;
  change_30d_pct: number | null;
  change_90d: number | null;
  change_90d_pct: number | null;
  trend_7d: Direction | null;
  trend_30d: Direction | null;
  volatility_30d: number | null;
  high_30d: number | null;
  low_30d: number | null;
  data_points_30d: number;
  rank_7d_ago: number | null;
  rank_30d_ago: number | null;
  rank_90d_ago: number | null;
  rank_change_7d: number | null;
  rank_change_30d: number | null;
  rank_change_90d: number | null;
  updated_at: string;
};

/**
 * Pure computation: turn raw history rows into one trend row per
 * (player, format, source) combo. No DB access, so it can be run against any
 * row set (full or date-bounded) for parity testing. `nowMs` anchors the
 * 7/30/90-day windows and updated_at; defaults to Date.now().
 */
export function computeTrendRows(
  allRows: HistoryRow[],
  nowMs: number = Date.now(),
): TrendRow[] {
  const groups = new Map<string, HistoryRow[]>();
  for (const row of allRows) {
    const key = `${row.player_id}|${row.format_config_id}|${row.source}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }
  for (const bucket of groups.values()) {
    bucket.sort(
      (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
    );
  }

  type DayRanking = Map<string, number>;
  const ranksByFormatSourceDay = new Map<string, DayRanking>();
  {
    type DayBucketEntry = { player_id: string; value: number };
    const buckets = new Map<string, DayBucketEntry[]>();
    const seenInDay = new Set<string>();
    for (const row of allRows) {
      const day = dayKey(row.captured_at);
      const fsd = `${row.format_config_id}|${row.source}|${day}`;
      const dedupeKey = `${fsd}|${row.player_id}`;
      if (seenInDay.has(dedupeKey)) continue;
      seenInDay.add(dedupeKey);
      let bucket = buckets.get(fsd);
      if (!bucket) {
        bucket = [];
        buckets.set(fsd, bucket);
      }
      bucket.push({ player_id: row.player_id, value: row.value });
    }
    for (const [fsd, bucket] of buckets) {
      bucket.sort((a, b) => b.value - a.value);
      const ranking: DayRanking = new Map();
      for (let i = 0; i < bucket.length; i += 1) {
        ranking.set(bucket[i].player_id, i + 1);
      }
      ranksByFormatSourceDay.set(fsd, ranking);
    }
  }

  const t7 = nowMs - 7 * MS_PER_DAY;
  const t30 = nowMs - 30 * MS_PER_DAY;
  const t90 = nowMs - 90 * MS_PER_DAY;

  const updatedAt = new Date(nowMs).toISOString();
  const outputs: TrendRow[] = [];

  for (const [, rowsDesc] of groups) {
    const newest = rowsDesc[0];
    const currentValue = newest.value;
    const player_id = newest.player_id;
    const format_config_id = newest.format_config_id;
    const source = newest.source;

    const v7 = valueAtOrBefore(rowsDesc, t7, 7);
    const v30 = valueAtOrBefore(rowsDesc, t30, 30);
    const v90 = valueAtOrBefore(rowsDesc, t90, 90);

    const change_7d = v7 === null ? null : currentValue - v7;
    const change_30d = v30 === null ? null : currentValue - v30;
    const change_90d = v90 === null ? null : currentValue - v90;
    const change_7d_pct = pctChange(currentValue, v7);
    const change_30d_pct = pctChange(currentValue, v30);
    const change_90d_pct = pctChange(currentValue, v90);

    const last30dValues = rowsDesc
      .filter((r) => new Date(r.captured_at).getTime() >= t30)
      .map((r) => r.value);
    const data_points_30d = last30dValues.length;
    const high_30d = last30dValues.length > 0 ? Math.max(...last30dValues) : null;
    const low_30d = last30dValues.length > 0 ? Math.min(...last30dValues) : null;
    const volatility_30d = populationStddev(last30dValues);

    const daysDesc = Array.from(new Set(rowsDesc.map((r) => dayKey(r.captured_at))));
    const currentDay = daysDesc[0];
    const currentRanking = ranksByFormatSourceDay.get(
      `${format_config_id}|${source}|${currentDay}`,
    );
    const currentRank = currentRanking?.get(player_id) ?? null;

    const lookupRankAt = (
      windowMs: number,
      windowDays: number,
    ): { rankAgo: number | null; rankChange: number | null } => {
      const day = pickAnchorDay(daysDesc, windowMs, windowDays);
      if (!day) return { rankAgo: null, rankChange: null };
      const ranking = ranksByFormatSourceDay.get(`${format_config_id}|${source}|${day}`);
      const rankAgo = ranking?.get(player_id) ?? null;
      if (rankAgo === null || currentRank === null) {
        return { rankAgo, rankChange: null };
      }
      return { rankAgo, rankChange: rankAgo - currentRank };
    };

    const r7 = lookupRankAt(t7, 7);
    const r30 = lookupRankAt(t30, 30);
    const r90 = lookupRankAt(t90, 90);

    outputs.push({
      player_id,
      format_config_id,
      source,
      current_value: currentValue,
      value_7d_ago: v7,
      value_30d_ago: v30,
      value_90d_ago: v90,
      change_7d,
      change_30d,
      change_90d,
      change_7d_pct,
      change_30d_pct,
      change_90d_pct,
      trend_7d: direction(change_7d_pct),
      trend_30d: direction(change_30d_pct),
      volatility_30d,
      high_30d,
      low_30d,
      data_points_30d,
      rank_7d_ago: r7.rankAgo,
      rank_30d_ago: r30.rankAgo,
      rank_90d_ago: r90.rankAgo,
      rank_change_7d: r7.rankChange,
      rank_change_30d: r30.rankChange,
      rank_change_90d: r90.rankChange,
      updated_at: updatedAt,
    });
  }

  return outputs;
}

export type CalculateTrendsResult = {
  ok: boolean;
  combos: number;
  written: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runCalculateTrends(
  supabase: SupabaseClient<Database>,
): Promise<CalculateTrendsResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const sinceIso = new Date(started - HISTORY_LOOKBACK_DAYS * MS_PER_DAY).toISOString();
  console.log(`Loading player_value_history (last ${HISTORY_LOOKBACK_DAYS} days)...`);
  const allRows = await loadAllHistory(supabase, sinceIso);
  console.log(`  ${allRows.length} history rows`);

  const nowMs = Date.now();
  const outputs = computeTrendRows(allRows, nowMs);
  console.log(`  ${outputs.length} (player, format, source) combos`);

  console.log(`Upserting ${outputs.length} trend rows...`);
  let written = 0;
  await chunkUpsert(outputs, 500, async (chunk) => {
    const { error } = await supabase
      .from("player_value_trends")
      .upsert(chunk, {
        onConflict: "player_id,format_config_id,source",
        ignoreDuplicates: false,
      });
    if (error) throw error;
    written += chunk.length;
  });

  const finished = Date.now();
  console.log(`Done. ${written} player_value_trends rows updated.`);
  return {
    ok: true,
    combos: outputs.length,
    written,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
