/**
 * Calculate per-(player, format, source) value trends (library form).
 * See scripts/calculate-trends.ts header for the full algorithm description.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkUpsert, withRetry } from "./supabase/retry";
import type { Database } from "./database.types";

type HistoryRow = {
  id: string;
  player_id: string;
  format_config_id: string;
  source: string;
  value: number;
  captured_at: string;
  // FF Beacon only: the formula-induced portion of value (published - market).
  // market = value - formula_offset. Trends compute ALL movement (change/trend/
  // rank/volatility) on the market series so silent manual changes do not render
  // as market movement; current_value is published (value as stored). 0 for every
  // external source, so this is a no-op for KTC / FantasyCalc / DynastyProcess.
  formula_offset: number;
};

// market = value - formula_offset. The trend-basis value. See HistoryRow above.
function marketValue(row: HistoryRow): number {
  return row.value - Number(row.formula_offset ?? 0);
}

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
    return marketValue(row); // movement anchors use the market series
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
 * Load player_value_history via compound keyset pagination on (captured_at, id).
 *
 * Ordering by captured_at lets Postgres satisfy a `captured_at >= sinceIso`
 * bound with a range scan on idx_player_value_history_captured_at instead of
 * walking the whole pkey and filtering (the id-only keyset did the latter, so
 * the date bound barely helped). The cursor is the compound (captured_at, id)
 * pair, NOT captured_at alone: a single sync writes ~2000 rows sharing one
 * captured_at, and a captured_at-only cursor would skip or duplicate rows
 * across those tie boundaries. id breaks the tie deterministically.
 *
 * When `sinceIso` is provided, only rows with captured_at >= sinceIso are
 * loaded. The nightly trend calc passes a 140-day cutoff so it never ships the
 * ~70% of the table older than any window the math uses. Pass undefined for all.
 *
 * Rows are returned sorted by id, the same canonical order the previous
 * id-keyset loader produced. This matters: computeTrendRows' per-day ranking
 * dedup keeps the first-seen row per (combo, day), and some days carry multiple
 * snapshots with differing values, so the iteration order is output-significant.
 * The captured_at ordering is only a load-time concern; the sub-second in-memory
 * re-sort restores byte-for-byte parity with the original load order.
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
  let cursor: { ts: string; id: string } | null = null;
  // Built fresh per attempt rather than reused: a PostgREST builder carries the
  // state of the request it already issued, so retrying one is not reliably the
  // same call. Constructing it here keeps a retry byte-identical to the attempt
  // it replaces.
  const buildPage = (cursor: { ts: string; id: string } | null) => {
    let query = supabase
      .from("player_value_history")
      .select("id, player_id, format_config_id, source, value, captured_at, formula_offset")
      .order("captured_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) {
      // Set the index lower bound to the cursor timestamp itself so the scan
      // STARTS at the cursor (Index Cond), rather than at the static window
      // floor with the keyset applied as a Filter. Without this, every page
      // re-scans the window from the floor up to the cursor (O(n^2) overall).
      // cursor.ts >= sinceIso always, so this still respects the date bound.
      // Quote the timestamp in the or() so PostgREST treats the embedded ":",
      // "+" and "." as literal value characters, not filter-grammar separators.
      const ts = JSON.stringify(cursor.ts);
      query = query
        .gte("captured_at", cursor.ts)
        .or(`captured_at.gt.${ts},and(captured_at.eq.${ts},id.gt.${cursor.id})`);
    } else if (sinceIso) {
      query = query.gte("captured_at", sinceIso);
    }
    return query;
  };

  for (;;) {
    // Retried, because this loop makes ~1000 sequential requests over several
    // minutes and Supabase's edge proxy drops a socket mid-stream often enough
    // that an unretried page failure took the whole job down twice in a row.
    // Paging is idempotent: the cursor only advances after a successful page, so
    // a retry re-requests exactly the same range.
    const at = cursor;
    const data = await withRetry(
      async () => {
        const { data: pageRows, error } = await buildPage(at);
        if (error) throw error;
        return pageRows;
      },
      { label: `player_value_history page${at ? ` after ${at.ts}` : ""}` },
    );
    if (!data || data.length === 0) break;
    rows.push(...(data as HistoryRow[]));
    if (data.length < PAGE) break;
    const last = data[data.length - 1] as { id: string; captured_at: string };
    cursor = { ts: last.captured_at, id: last.id };
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
  show_trend_7d: boolean;
  show_trend_30d: boolean;
  show_trend_90d: boolean;
  updated_at: string;
};

// Map a source's publish cadence to its base bookend tolerance in days.
// daily sources get +/-2: +/-1 was rejecting fringe daily players over normal
// cron timing jitter, while +/-2 still rejects multi-day-stale data but
// tolerates a single late or skipped run. Weekly sources get +/-7. Unknown
// cadence defaults to daily. (The floor((W-1)/2) cap below still tightens the
// 7d-weekly case to +/-3.)
export const INTERVAL_DAYS_BY_CADENCE: Record<string, number> = { daily: 2, weekly: 7 };
const DEFAULT_INTERVAL_DAYS = 2;

// Bookend tolerance for a window. Capped at floor((window-1)/2) so the start
// bookend window [target +/- tol] and the end bookend window [now +/- tol]
// (which are `windowDays` apart) can never overlap. This is what tightens the
// 7-day window for a weekly source to +/-3 instead of the invalid +/-7.
export function bookendToleranceDays(intervalDays: number, windowDays: number): number {
  const cap = Math.floor((windowDays - 1) / 2);
  return Math.max(0, Math.min(intervalDays, cap));
}

// True when some history timestamp sits within tolDays of targetMs (either side).
function hasBookend(timestampsMs: number[], targetMs: number, tolDays: number): boolean {
  const tolMs = tolDays * MS_PER_DAY;
  for (const ts of timestampsMs) {
    if (Math.abs(ts - targetMs) <= tolMs) return true;
  }
  return false;
}

// Per-window display gate: the source must have a data point near BOTH the
// window start (now - windowDays) and now. Replaces the old data_points_30d
// count gate, which never proved the window was actually covered.
function windowCovered(
  timestampsMs: number[],
  nowMs: number,
  windowDays: number,
  intervalDays: number,
): boolean {
  const tol = bookendToleranceDays(intervalDays, windowDays);
  const startCovered = hasBookend(timestampsMs, nowMs - windowDays * MS_PER_DAY, tol);
  const endCovered = hasBookend(timestampsMs, nowMs, tol);
  return startCovered && endCovered;
}

/**
 * Pure computation: turn raw history rows into one trend row per
 * (player, format, source) combo. No DB access, so it can be run against any
 * row set (full or date-bounded) for parity testing. `nowMs` anchors the
 * 7/30/90-day windows and updated_at; defaults to Date.now().
 *
 * `intervalBySource` maps a source slug to its publish interval in days (1 for
 * daily, 7 for weekly). It drives the per-window show_trend_* bookend gate.
 * Missing entries default to daily, so existing callers behave as before.
 */
export function computeTrendRows(
  allRows: HistoryRow[],
  nowMs: number = Date.now(),
  intervalBySource: Map<string, number> = new Map(),
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
      bucket.push({ player_id: row.player_id, value: marketValue(row) });
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
    // current_value stored = published (worth). All movement math below runs on
    // the market series (value - formula_offset), so a silent FF Beacon change
    // does not show as movement. Identical for external sources (offset 0).
    const currentPublished = newest.value;
    const currentValue = marketValue(newest);
    const player_id = newest.player_id;
    const format_config_id = newest.format_config_id;
    const source = newest.source;

    const intervalDays = intervalBySource.get(source) ?? DEFAULT_INTERVAL_DAYS;
    const tsList = rowsDesc.map((r) => new Date(r.captured_at).getTime());
    const show_trend_7d = windowCovered(tsList, nowMs, 7, intervalDays);
    const show_trend_30d = windowCovered(tsList, nowMs, 30, intervalDays);
    const show_trend_90d = windowCovered(tsList, nowMs, 90, intervalDays);

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
      .map((r) => marketValue(r));
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
      current_value: currentPublished,
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
      show_trend_7d,
      show_trend_30d,
      show_trend_90d,
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

  // Per-source publish cadence drives the bookend tolerance for the show flags.
  const { data: sources, error: srcErr } = await supabase
    .from("source_registry")
    .select("slug, update_cadence");
  if (srcErr) throw srcErr;
  const intervalBySource = new Map<string, number>();
  for (const s of sources ?? []) {
    intervalBySource.set(s.slug, INTERVAL_DAYS_BY_CADENCE[s.update_cadence] ?? DEFAULT_INTERVAL_DAYS);
  }

  const nowMs = Date.now();
  const outputs = computeTrendRows(allRows, nowMs, intervalBySource);
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
