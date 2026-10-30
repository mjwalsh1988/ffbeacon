/**
 * One Market Signals partition, end to end: read, fold, compute, write, stamp.
 * Plan section 5.5, steps 1 to 6.
 *
 * WHY THIS CANNOT TIME OUT THE WAY THE REFERENCE PROJECT DID (plan 5.6)
 *
 * - No RPC. Nothing here runs under PostgREST's 8-second statement timeout as
 *   one long statement: every query is a plain indexed range select of at most
 *   1000 rows or a 500-row upsert.
 * - No per-row history update. The partition's history is read ONCE and about
 *   one latest row per player is written. player_value_history is never
 *   touched.
 * - Resumable by construction: a partition is stamped in market_signal_runs
 *   only after its writes land, and a stamped partition is skipped.
 *
 * IO is injected (PartitionIO) so the whole run is testable without a
 * database; supabasePartitionIO is the production implementation. Every page
 * read and every write goes through withRetry.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { chunkUpsert, withRetry } from "@/lib/supabase/retry";
import {
  addDays,
  collapseToDays,
  computeSignal,
  isLoggedChange,
  signalSince,
  utcDay,
  type HistoryPoint,
  type SignalState,
} from "./bollinger";
import { MIN_PARTITION_PLAYERS, type MarketSignalSettings } from "./default-settings";
import type { Partition } from "./partitions";

type Client = SupabaseClient<Database>;

export const WRITE_CHUNK = 500;

export type PartitionHistoryRow = HistoryPoint & { player_id: string };

export type ExistingSignal = {
  player_id: string;
  signal: SignalState;
  signal_since: string | null;
};

export type SignalRow = {
  player_id: string;
  format_config_id: string;
  source: string;
  as_of_day: string;
  market_value: number;
  mean_30: number | null;
  stdev_30: number | null;
  band_upper: number | null;
  band_lower: number | null;
  band_pct: number | null;
  bandwidth: number | null;
  points_in_window: number;
  signal: SignalState;
  previous_signal: SignalState | null;
  signal_since: string;
  model_version: number;
  computed_at: string;
};

export type ChangeRow = {
  player_id: string;
  format_config_id: string;
  source: string;
  changed_on: string;
  from_signal: SignalState | null;
  to_signal: SignalState;
  market_value: number;
  band_pct: number | null;
};

export type RunStamp = {
  format_config_id: string;
  source: string;
  as_of_day: string;
  rows_written: number;
  changes_written: number;
  duration_ms: number;
};

export interface PartitionIO {
  readHistory(p: Partition, sinceIso: string): Promise<PartitionHistoryRow[]>;
  readExisting(p: Partition): Promise<ExistingSignal[]>;
  upsertSignals(rows: SignalRow[]): Promise<void>;
  insertChanges(rows: ChangeRow[]): Promise<void>;
  stamp(row: RunStamp): Promise<void>;
}

export type PartitionComputation = {
  asOfDay: string | null;
  signals: SignalRow[];
  changes: ChangeRow[];
  pricedOnLatestDay: number;
  /** True when the partition had too few priced players to signal. */
  tooThin: boolean;
};

/**
 * Pure: every player's row for one partition from its history and the stored
 * rows. A player whose series is stale writes nothing (his old row stays).
 */
export function computePartition(
  partition: Partition,
  history: readonly PartitionHistoryRow[],
  existing: readonly ExistingSignal[],
  settings: MarketSignalSettings,
  now: Date,
): PartitionComputation {
  const byPlayer = new Map<string, HistoryPoint[]>();
  for (const row of history) {
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row);
    byPlayer.set(row.player_id, list);
  }
  const series = new Map<string, Map<string, number>>();
  let asOfDay: string | null = null;
  for (const [playerId, rows] of byPlayer) {
    const s = collapseToDays(rows);
    series.set(playerId, s);
    for (const day of s.keys()) if (asOfDay === null || day > asOfDay) asOfDay = day;
  }

  let top = 0;
  let priced = 0;
  if (asOfDay) {
    for (const s of series.values()) {
      const v = s.get(asOfDay);
      if (v === undefined) continue;
      priced += 1;
      if (v > top) top = v;
    }
  }
  if (asOfDay === null || priced < MIN_PARTITION_PLAYERS) {
    return { asOfDay, signals: [], changes: [], pricedOnLatestDay: priced, tooThin: true };
  }

  const prevBy = new Map(existing.map((e) => [e.player_id, e]));
  const runDay = utcDay(now.toISOString());
  const computedAt = now.toISOString();
  const signals: SignalRow[] = [];
  const changes: ChangeRow[] = [];

  for (const [playerId, s] of series) {
    const prev = prevBy.get(playerId) ?? null;
    const row = computeSignal({
      series: s,
      runDay,
      prev: prev?.signal ?? null,
      topMarketValue: top,
      settings,
    });
    if (!row) continue;
    const prevSignal = prev?.signal ?? null;
    signals.push({
      player_id: playerId,
      format_config_id: partition.formatConfigId,
      source: partition.source,
      as_of_day: row.asOfDay,
      market_value: row.marketValue,
      mean_30: row.mean,
      stdev_30: row.stdev,
      band_upper: row.upper,
      band_lower: row.lower,
      band_pct: row.bandPct,
      bandwidth: row.bandwidth,
      points_in_window: row.points,
      signal: row.signal,
      // The state the last run stored, whatever it was.
      previous_signal: prevSignal,
      signal_since: signalSince(prevSignal, prev?.signal_since ?? null, row.signal, row.asOfDay),
      model_version: settings.modelVersion,
      computed_at: computedAt,
    });
    if (isLoggedChange(prevSignal, row.signal)) {
      changes.push({
        player_id: playerId,
        format_config_id: partition.formatConfigId,
        source: partition.source,
        changed_on: row.asOfDay,
        from_signal: prevSignal,
        to_signal: row.signal,
        market_value: row.marketValue,
        band_pct: row.bandPct,
      });
    }
  }
  return { asOfDay, signals, changes, pricedOnLatestDay: priced, tooThin: false };
}

export type PartitionResult = {
  partition: Partition;
  asOfDay: string | null;
  rowsWritten: number;
  changesWritten: number;
  durationMs: number;
  tooThin: boolean;
};

/** Run one partition through the injected IO. Throws on any read or write failure. */
export async function runPartition(
  io: PartitionIO,
  partition: Partition,
  settings: MarketSignalSettings,
  now: Date = new Date(),
): Promise<PartitionResult> {
  const started = Date.now();
  const sinceDay = addDays(utcDay(now.toISOString()), -settings.lookbackDays);
  const [history, existing] = await Promise.all([
    io.readHistory(partition, `${sinceDay}T00:00:00.000Z`),
    io.readExisting(partition),
  ]);
  const computed = computePartition(partition, history, existing, settings, now);

  await chunkUpsert(computed.signals, WRITE_CHUNK, (chunk) => io.upsertSignals(chunk));
  await chunkUpsert(computed.changes, WRITE_CHUNK, (chunk) => io.insertChanges(chunk));

  const durationMs = Date.now() - started;
  if (computed.asOfDay) {
    await io.stamp({
      format_config_id: partition.formatConfigId,
      source: partition.source,
      as_of_day: computed.asOfDay,
      rows_written: computed.signals.length,
      changes_written: computed.changes.length,
      duration_ms: durationMs,
    });
  }
  return {
    partition,
    asOfDay: computed.asOfDay,
    rowsWritten: computed.signals.length,
    changesWritten: computed.changes.length,
    durationMs,
    tooThin: computed.tooThin,
  };
}

const PAGE = 1000;

/** The production IO over a service-role client. */
export function supabasePartitionIO(supabase: Client): PartitionIO {
  return {
    async readHistory(p, sinceIso) {
      // One keyset walk on (captured_at, id) inside one partition: the 0122
      // index (format_config_id, source, captured_at desc) covers it.
      const rows: PartitionHistoryRow[] = [];
      let cursor: { ts: string; id: string } | null = null;
      for (;;) {
        const at: { ts: string; id: string } | null = cursor;
        const page = await withRetry(
          async () => {
            let q = supabase
              .from("player_value_history")
              .select("id, player_id, value, formula_offset, captured_at")
              .eq("format_config_id", p.formatConfigId)
              .eq("source", p.source)
              .order("captured_at", { ascending: true })
              .order("id", { ascending: true })
              .limit(PAGE);
            if (at) {
              const ts = JSON.stringify(at.ts);
              q = q
                .gte("captured_at", at.ts)
                .or(`captured_at.gt.${ts},and(captured_at.eq.${ts},id.gt.${at.id})`);
            } else {
              q = q.gte("captured_at", sinceIso);
            }
            const { data, error } = await q;
            if (error) throw error;
            return data ?? [];
          },
          { label: `history ${p.source}/${p.formatSlug}` },
        );
        for (const r of page) {
          rows.push({
            player_id: r.player_id,
            value: Number(r.value),
            formula_offset: r.formula_offset === null ? null : Number(r.formula_offset),
            captured_at: r.captured_at,
          });
        }
        if (page.length < PAGE) break;
        const last = page[page.length - 1];
        cursor = { ts: last.captured_at, id: last.id };
      }
      return rows;
    },

    async readExisting(p) {
      const rows: ExistingSignal[] = [];
      let after: string | null = null;
      for (;;) {
        const from: string | null = after;
        const page = await withRetry(
          async () => {
            let q = supabase
              .from("player_value_signals")
              .select("player_id, signal, signal_since")
              .eq("format_config_id", p.formatConfigId)
              .eq("source", p.source)
              .order("player_id", { ascending: true })
              .limit(PAGE);
            if (from) q = q.gt("player_id", from);
            const { data, error } = await q;
            if (error) throw error;
            return data ?? [];
          },
          { label: `signals ${p.source}/${p.formatSlug}` },
        );
        for (const r of page) {
          rows.push({
            player_id: r.player_id,
            signal: r.signal as SignalState,
            signal_since: r.signal_since,
          });
        }
        if (page.length < PAGE) break;
        after = page[page.length - 1].player_id;
      }
      return rows;
    },

    async upsertSignals(chunk) {
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_value_signals")
            .upsert(chunk, { onConflict: "player_id,format_config_id,source" });
          if (error) throw error;
        },
        { label: "player_value_signals upsert" },
      );
    },

    async insertChanges(chunk) {
      await withRetry(
        async () => {
          const { error } = await supabase.from("player_value_signal_changes").upsert(chunk, {
            onConflict: "player_id,format_config_id,source,changed_on",
            ignoreDuplicates: true,
          });
          if (error) throw error;
        },
        { label: "player_value_signal_changes insert" },
      );
    },

    async stamp(row) {
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("market_signal_runs")
            .upsert({ ...row, ran_at: new Date().toISOString() }, {
              onConflict: "format_config_id,source,as_of_day",
            });
          if (error) throw error;
        },
        { label: "market_signal_runs stamp" },
      );
    },
  };
}
