/**
 * One-time backfill of player_value_signal_changes (plan section 5.7).
 *
 * Replays the Market Signals state machine day by day over a past window, one
 * (format, source) partition at a time, and writes ONLY state-change rows, so
 * the player profile can say "Buy window since Oct 3" on launch day. It never
 * touches player_value_signals (the nightly cron owns the latest row) and
 * never touches player_value_history.
 *
 * NOT SCHEDULED, per the CLAUDE.md backfill rule. Idempotent through the
 * unique key (player, format, source, changed_on). Refuses to run without a
 * window.
 *
 * Run (PowerShell loses flags through npm, so call tsx directly):
 *   npx tsx --env-file=.env.local scripts/backfill-market-signal-changes.ts \
 *     --from 2025-10-29 --to 2026-10-28 [--partition ktc/dynasty-ppr-sflex] [--dry-run]
 */

import { pathToFileURL } from "node:url";
import { getServiceClient } from "./_supabase";
import {
  addDays,
  collapseToDays,
  computeSignal,
  isLoggedChange,
  type SignalState,
} from "../lib/market-signals/bollinger";
import { loadMarketSignalSettings } from "../lib/market-signals/settings";
import type { MarketSignalSettings } from "../lib/market-signals/default-settings";
import { listPartitions, type FormatRow, type Partition, type SourceRow } from "../lib/market-signals/partitions";
import {
  WRITE_CHUNK,
  supabasePartitionIO,
  type ChangeRow,
  type PartitionHistoryRow,
} from "../lib/market-signals/run-partition";
import { chunkUpsert } from "../lib/supabase/retry";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseArgs(argv: string[]): {
  from: string;
  to: string;
  partition: string | null;
  dryRun: boolean;
} {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? null : null;
  };
  const from = get("--from");
  const to = get("--to");
  if (!from || !to || !DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
    throw new Error("Refusing to run without a window: pass --from YYYY-MM-DD --to YYYY-MM-DD.");
  }
  return { from, to, partition: get("--partition"), dryRun: argv.includes("--dry-run") };
}

/**
 * Pure: replay one partition's daily state machine from `from` to `to` and
 * return the change rows, with the same computeSignal the cron uses.
 */
export function replayChanges(
  partition: Partition,
  history: readonly PartitionHistoryRow[],
  settings: MarketSignalSettings,
  from: string,
  to: string,
): ChangeRow[] {
  const byPlayer = new Map<string, PartitionHistoryRow[]>();
  for (const r of history) {
    const list = byPlayer.get(r.player_id) ?? [];
    list.push(r);
    byPlayer.set(r.player_id, list);
  }
  const series = new Map<string, Array<[string, number]>>();
  const topByDay = new Map<string, number>();
  for (const [id, rows] of byPlayer) {
    const s = [...collapseToDays(rows)];
    series.set(id, s);
    for (const [day, v] of s) if (v > (topByDay.get(day) ?? 0)) topByDay.set(day, v);
  }

  const state = new Map<string, SignalState>();
  const changes: ChangeRow[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const floorDay = addDays(day, -settings.lookbackDays);
    // The partition top on the latest day each series could be read on.
    for (const [id, s] of series) {
      const window = new Map(s.filter(([d]) => d <= day && d >= floorDay));
      if (window.size === 0) continue;
      let latestDay = "";
      for (const d of window.keys()) if (d > latestDay) latestDay = d;
      const prev = state.get(id) ?? null;
      const row = computeSignal({
        series: window,
        runDay: day,
        prev,
        topMarketValue: topByDay.get(latestDay) ?? 0,
        settings,
      });
      if (!row) continue;
      // Only a day the series actually moved on can open a change; a stale
      // carry-forward day repeats yesterday's answer.
      if (row.asOfDay !== day) continue;
      if (isLoggedChange(prev, row.signal)) {
        changes.push({
          player_id: id,
          format_config_id: partition.formatConfigId,
          source: partition.source,
          changed_on: row.asOfDay,
          from_signal: prev,
          to_signal: row.signal,
          market_value: row.marketValue,
          band_pct: row.bandPct,
        });
      }
      state.set(id, row.signal);
    }
  }
  return changes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admin = getServiceClient();
  const settings = await loadMarketSignalSettings(admin);
  const [formatsRes, sourcesRes] = await Promise.all([
    admin.from("format_configs").select("id, slug, display_name, display_order").eq("is_active", true),
    admin
      .from("source_registry")
      .select("slug, display_name, priority, is_default, data_type, supported_format_slugs")
      .eq("is_active", true),
  ]);
  if (formatsRes.error) throw formatsRes.error;
  if (sourcesRes.error) throw sourcesRes.error;
  let partitions = listPartitions(
    (formatsRes.data ?? []) as FormatRow[],
    (sourcesRes.data ?? []) as SourceRow[],
  );
  if (args.partition) {
    partitions = partitions.filter((p) => `${p.source}/${p.formatSlug}` === args.partition);
    if (partitions.length === 0) throw new Error(`No partition named ${args.partition}.`);
  }

  const io = supabasePartitionIO(admin);
  const sinceIso = `${addDays(args.from, -settings.lookbackDays)}T00:00:00.000Z`;
  let total = 0;
  for (const p of partitions) {
    const t0 = Date.now();
    const history = await io.readHistory(p, sinceIso);
    const changes = replayChanges(p, history, settings, args.from, args.to);
    total += changes.length;
    console.log(
      `${p.source}/${p.formatSlug}: ${history.length} history rows, ${changes.length} changes (${Math.round((Date.now() - t0) / 1000)}s)${args.dryRun ? " [dry run]" : ""}`,
    );
    if (!args.dryRun) {
      await chunkUpsert(changes, WRITE_CHUNK, (chunk) => io.insertChanges(chunk));
    }
  }
  console.log(`Done: ${total} change rows across ${partitions.length} partitions.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
