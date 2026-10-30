/**
 * Market Signals engine: the deadline loop over partitions (plan section 5.5).
 *
 * THE DEADLINE RULE. Before starting a partition, if now plus the longest
 * partition so far this run (30 seconds before the first one finishes) would
 * pass the budget minus a 10-second margin, the run STOPS and returns
 * { ok: true, partial: true, remaining } with no failedSteps. The 10:50 UTC
 * catch-up entry finishes the rest, because a partition already stamped for
 * its latest history day is skipped as fresh.
 *
 * A partition whose read or write throws is pushed to failedSteps and the run
 * moves on; recordCronRun then records the run as an error and emails through
 * its existing cooldown. Nothing here is a sleep, a retry loop or an RPC
 * (each page retries inside withRetry, which is not this loop's business).
 *
 * THE PRUNES run only at the end of a COMPLETE run (nothing remaining, nothing
 * failed): one DELETE each, by an indexed date column, for signal changes past
 * 730 days and run stamps past 90 days. No cron here iterates rows.
 *
 * Dependencies are injected so the loop is testable without a database or a
 * clock; marketSignalDeps is the production wiring.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { addDays, utcDay } from "./bollinger";
import type { MarketSignalSettings } from "./default-settings";
import { planPartitions, type Partition, type PlannedPartition } from "./partitions";
import { runPartition, supabasePartitionIO, type PartitionResult } from "./run-partition";

type Client = SupabaseClient<Database>;

export const FIRST_PARTITION_ESTIMATE_MS = 30_000;
export const DEADLINE_MARGIN_MS = 10_000;
export const CHANGES_RETENTION_DAYS = 730;
export const RUNS_RETENTION_DAYS = 90;

export type EngineDeps = {
  now: () => number;
  plan: () => Promise<PlannedPartition[]>;
  run: (p: Partition) => Promise<PartitionResult>;
  prune: () => Promise<{ changesDeleted: number; runsDeleted: number }>;
};

export type MarketSignalsRunResult = {
  ok: true;
  disabled?: true;
  partial: boolean;
  /** "source/format" labels the deadline left for the catch-up entry. */
  remaining: string[];
  /** Partitions skipped because they were already stamped for their latest day. */
  fresh: number;
  done: Array<{
    partition: string;
    asOfDay: string | null;
    rows: number;
    changes: number;
    ms: number;
    tooThin: boolean;
  }>;
  failedSteps?: string[];
  pruned: { changesDeleted: number; runsDeleted: number } | null;
  /** True when at least one partition wrote rows, so caches should be busted. */
  wroteAny: boolean;
};

const labelOf = (p: Partition) => `${p.source}/${p.formatSlug}`;

export async function runMarketSignals(
  deps: EngineDeps,
  opts: { budgetMs: number; enabled: boolean },
): Promise<MarketSignalsRunResult> {
  const started = deps.now();
  const empty: MarketSignalsRunResult = {
    ok: true,
    partial: false,
    remaining: [],
    fresh: 0,
    done: [],
    pruned: null,
    wroteAny: false,
  };
  if (!opts.enabled) return { ...empty, disabled: true };

  const planned = await deps.plan();
  const todo = planned.filter((p) => !p.fresh);
  const result: MarketSignalsRunResult = { ...empty, fresh: planned.length - todo.length };
  const failed: string[] = [];
  let longest = 0;

  for (let i = 0; i < todo.length; i += 1) {
    const p = todo[i];
    const estimate = longest > 0 ? longest : FIRST_PARTITION_ESTIMATE_MS;
    if (deps.now() - started + estimate > opts.budgetMs - DEADLINE_MARGIN_MS) {
      result.partial = true;
      result.remaining = todo.slice(i).map(labelOf);
      break;
    }
    const t0 = deps.now();
    try {
      const r = await deps.run(p);
      result.done.push({
        partition: labelOf(p),
        asOfDay: r.asOfDay,
        rows: r.rowsWritten,
        changes: r.changesWritten,
        ms: r.durationMs,
        tooThin: r.tooThin,
      });
      if (r.rowsWritten > 0) result.wroteAny = true;
    } catch (err) {
      failed.push(`${labelOf(p)}: ${err instanceof Error ? err.message : String(err)}`);
    }
    longest = Math.max(longest, deps.now() - t0);
  }

  if (failed.length > 0) result.failedSteps = failed;
  if (!result.partial && failed.length === 0) {
    try {
      result.pruned = await deps.prune();
    } catch (err) {
      result.failedSteps = [`prune: ${err instanceof Error ? err.message : String(err)}`];
    }
  }
  return result;
}

/** Pure: the cutoff days for the two prunes. */
export function pruneCutoffs(now: Date): { changesBefore: string; runsBefore: string } {
  const today = utcDay(now.toISOString());
  return {
    changesBefore: addDays(today, -CHANGES_RETENTION_DAYS),
    runsBefore: addDays(today, -RUNS_RETENTION_DAYS),
  };
}

/** Production wiring over a service-role client. */
export function marketSignalDeps(
  admin: Client,
  settings: MarketSignalSettings,
  now: () => number = Date.now,
): EngineDeps {
  const io = supabasePartitionIO(admin);
  return {
    now,
    plan: () => planPartitions(admin, { now: new Date(now()), staleDays: settings.staleDays }),
    run: (p) => runPartition(io, p, settings, new Date(now())),
    prune: async () => {
      const { changesBefore, runsBefore } = pruneCutoffs(new Date(now()));
      const changes = await admin
        .from("player_value_signal_changes")
        .delete({ count: "exact" })
        .lt("changed_on", changesBefore);
      if (changes.error) throw new Error(`prune changes: ${changes.error.message}`);
      const runs = await admin
        .from("market_signal_runs")
        .delete({ count: "exact" })
        // By ran_at, which carries the index added for the admin table; as_of_day
        // is only the third column of the unique key.
        .lt("ran_at", `${runsBefore}T00:00:00Z`);
      if (runs.error) throw new Error(`prune runs: ${runs.error.message}`);
      return { changesDeleted: changes.count ?? 0, runsDeleted: runs.count ?? 0 };
    },
  };
}
