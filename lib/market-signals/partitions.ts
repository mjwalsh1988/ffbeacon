/**
 * Market Signals partitions: one (format_config_id, source) per unit of work.
 *
 * A partition exists for every active format a source declares it supports
 * (source_registry.supported_format_slugs, NULL meaning every active format;
 * CLAUDE.md "Sources declare what they actually support") and that holds at
 * least one value history row in the last staleDays. Order: the default
 * source first, then source priority, then format display_order, so the
 * site's default (source, format) is always first and always finishes inside
 * the run's deadline.
 *
 * A partition whose market_signal_runs stamp already names its latest history
 * day is FRESH and skipped: that is what lets the 10:50 catch-up entry finish
 * whatever the 10:30 entry did not, without redoing the rest.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { withRetry } from "@/lib/supabase/retry";
import { addDays, utcDay } from "./bollinger";

type Client = SupabaseClient<Database>;

export type FormatRow = {
  id: string;
  slug: string;
  display_name: string;
  display_order: number | null;
};

export type SourceRow = {
  slug: string;
  display_name: string;
  priority: number;
  is_default: boolean;
  data_type: string[];
  supported_format_slugs: string[] | null;
};

export type Partition = {
  formatConfigId: string;
  formatSlug: string;
  formatDisplay: string;
  source: string;
  sourceDisplay: string;
};

export type PlannedPartition = Partition & {
  /** The partition's newest history day ("YYYY-MM-DD"), null when it has none recently. */
  latestDay: string | null;
  /** True when market_signal_runs already holds a stamp for latestDay. */
  fresh: boolean;
};

/** The history table a value source must publish to be signaled. */
const VALUE_TABLE = "player_value_history";

/** Pure: every (format, source) pair a source declares it supports, in run order. */
export function listPartitions(formats: FormatRow[], sources: SourceRow[]): Partition[] {
  const orderedSources = [...sources]
    .filter((s) => s.data_type.includes(VALUE_TABLE))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.priority - b.priority);
  const orderedFormats = [...formats].sort(
    (a, b) => (a.display_order ?? 9999) - (b.display_order ?? 9999) || a.slug.localeCompare(b.slug),
  );
  const out: Partition[] = [];
  for (const s of orderedSources) {
    const supported = s.supported_format_slugs ? new Set(s.supported_format_slugs) : null;
    for (const f of orderedFormats) {
      if (supported && !supported.has(f.slug)) continue;
      out.push({
        formatConfigId: f.id,
        formatSlug: f.slug,
        formatDisplay: f.display_name,
        source: s.slug,
        sourceDisplay: s.display_name,
      });
    }
  }
  return out;
}

/** Pure: whether a partition still needs a run for its latest day. */
export function isPartitionFresh(latestDay: string | null, stampedDays: ReadonlySet<string>): boolean {
  return latestDay !== null && stampedDays.has(latestDay);
}

/**
 * Every partition with its latest history day and freshness. One small query
 * for formats, one for sources, one for recent stamps, then ONE indexed
 * limit-1 read per partition on (format_config_id, source, captured_at desc),
 * the 0122 index. Partitions with no history in the last staleDays are dropped.
 */
export async function planPartitions(
  supabase: Client,
  opts: { now: Date; staleDays: number },
): Promise<PlannedPartition[]> {
  const [formatsRes, sourcesRes] = await Promise.all([
    supabase
      .from("format_configs")
      .select("id, slug, display_name, display_order")
      .eq("is_active", true),
    supabase
      .from("source_registry")
      .select("slug, display_name, priority, is_default, data_type, supported_format_slugs")
      .eq("is_active", true),
  ]);
  if (formatsRes.error) throw new Error(`format_configs: ${formatsRes.error.message}`);
  if (sourcesRes.error) throw new Error(`source_registry: ${sourcesRes.error.message}`);
  const partitions = listPartitions(
    (formatsRes.data ?? []) as FormatRow[],
    (sourcesRes.data ?? []) as SourceRow[],
  );

  const runDay = utcDay(opts.now.toISOString());
  const sinceDay = addDays(runDay, -opts.staleDays);
  const { data: stamps, error: stampErr } = await supabase
    .from("market_signal_runs")
    .select("format_config_id, source, as_of_day")
    .gte("as_of_day", sinceDay);
  if (stampErr) throw new Error(`market_signal_runs: ${stampErr.message}`);
  const stamped = new Map<string, Set<string>>();
  for (const r of stamps ?? []) {
    const key = `${r.format_config_id}|${r.source}`;
    const set = stamped.get(key) ?? new Set<string>();
    set.add(r.as_of_day);
    stamped.set(key, set);
  }

  const sinceIso = `${sinceDay}T00:00:00.000Z`;
  const planned: PlannedPartition[] = [];
  for (const p of partitions) {
    const latest = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("player_value_history")
          .select("captured_at")
          .eq("format_config_id", p.formatConfigId)
          .eq("source", p.source)
          .gte("captured_at", sinceIso)
          .order("captured_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        return data?.[0]?.captured_at ?? null;
      },
      { label: `latest history ${p.source}/${p.formatSlug}` },
    );
    if (!latest) continue;
    const latestDay = utcDay(latest);
    planned.push({
      ...p,
      latestDay,
      fresh: isPartitionFresh(latestDay, stamped.get(`${p.formatConfigId}|${p.source}`) ?? new Set()),
    });
  }
  return planned;
}
