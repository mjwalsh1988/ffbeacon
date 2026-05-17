/**
 * Calculate per-(player, format, source) value trends from player_value_history.
 *
 * Reads every history row, groups by (player_id, format_config_id, source),
 * computes current_value, 7/30/90-day-ago anchors (closest snapshot at or
 * before the target date), absolute and percent change, trend direction with
 * a small threshold, volatility (population stddev over 30d), 30d high/low,
 * and the count of data points within the trailing 30-day window. Upserts
 * into player_value_trends.
 *
 * Data scarcity is handled gracefully: when no snapshot exists at or before
 * a target window, the corresponding *_ago / change_* / trend_* fields are
 * left NULL. UI consumers gate display on data_points_30d.
 *
 * Run: npm run calculate:trends
 * Chained: npm run sync:ktc:full (sync-ktc.ts then this script)
 */

import { getServiceClient, chunkUpsert } from "./_supabase";

type HistoryRow = {
  player_id: string;
  format_config_id: string;
  source: string;
  value: number;
  captured_at: string;
};

type Direction = "up" | "down" | "stable";

// Percent threshold for declaring up/down vs. stable. Tuned conservatively
// (KTC values often jitter +/- a few points day-to-day).
const TREND_THRESHOLD_PCT = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  // rowsDesc is sorted captured_at DESC (newest first). Find the first row
  // whose captured_at <= targetMs but no more than 1.5x the window earlier.
  // The staleness cap prevents a stale snapshot (e.g. a 60-day-old row) from
  // claiming to be "7 days ago" and producing a misleading change_7d.
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

async function loadAllHistory(
  supabase: ReturnType<typeof getServiceClient>,
): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_value_history")
      .select("player_id, format_config_id, source, value, captured_at")
      .order("captured_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const supabase = getServiceClient();
  console.log("Loading player_value_history...");
  const allRows = await loadAllHistory(supabase);
  console.log(`  ${allRows.length} history rows`);

  // Group by (player_id, format_config_id, source). Within each group, sort
  // captured_at DESC (newest first).
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
  console.log(`  ${groups.size} (player, format, source) combos`);

  const nowMs = Date.now();
  const t7 = nowMs - 7 * MS_PER_DAY;
  const t30 = nowMs - 30 * MS_PER_DAY;
  const t90 = nowMs - 90 * MS_PER_DAY;

  type TrendRow = {
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
    updated_at: string;
  };

  const updatedAt = new Date().toISOString();
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
      updated_at: updatedAt,
    });
  }

  console.log(`Upserting ${outputs.length} trend rows...`);
  let written = 0;
  await chunkUpsert(outputs, 500, async (chunk) => {
    const { error } = await supabase
      .from("player_value_trends")
      .upsert(chunk, {
        onConflict: "player_id,format_config_id,source",
        ignoreDuplicates: false,
      });
    if (error) {
      console.error("Upsert error:", error.message);
      throw error;
    }
    written += chunk.length;
    process.stdout.write(`  ${written}/${outputs.length}\r`);
  });
  console.log(`\nDone. ${written} player_value_trends rows updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
