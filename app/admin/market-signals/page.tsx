import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { loadMarketSignalSettings } from "@/lib/market-signals/settings";
import { listPartitions, type FormatRow, type SourceRow } from "@/lib/market-signals/partitions";
import { formatSignalDay } from "@/lib/market-signals/read";
import { MarketSignalsSettingsManager } from "./market-signals-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Market Signals" };

/** The five tables the plan's size rules watch (section 7.4). */
const SIZE_TABLES = [
  "player_value_signals",
  "player_value_signal_changes",
  "market_signal_runs",
  "league_blueprint_cache",
  "league_roster_age_history",
] as const;

const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle";
const td = "px-3 py-2 text-sm text-ink";
const tdNum = "px-3 py-2 text-right font-mono text-sm tabular-nums text-ink";

export default async function MarketSignalsAdminPage() {
  await requireAdmin("/admin/market-signals");
  const admin = createAdminClient();

  const [settings, formatsRes, sourcesRes, runsRes, ...counts] = await Promise.all([
    loadMarketSignalSettings(admin),
    admin.from("format_configs").select("id, slug, display_name, display_order").eq("is_active", true),
    admin
      .from("source_registry")
      .select("slug, display_name, priority, is_default, data_type, supported_format_slugs")
      .eq("is_active", true),
    admin
      .from("market_signal_runs")
      .select("id, format_config_id, source, as_of_day, rows_written, changes_written, duration_ms, ran_at")
      .order("ran_at", { ascending: false })
      .limit(40),
    // Row counts only: bytes would need a SECURITY DEFINER function over
    // pg_total_relation_size, and the counts answer the size question here.
    // Untyped so a table this page lists before its migration lands reads
    // "Unknown" instead of failing the page.
    ...SIZE_TABLES.map((t) =>
      (admin as unknown as SupabaseClient).from(t).select("*", { count: "exact", head: true }),
    ),
  ]);

  const partitions = listPartitions(
    (formatsRes.data ?? []) as FormatRow[],
    (sourcesRes.data ?? []) as SourceRow[],
  );
  const labelOf = new Map(
    partitions.map((p) => [`${p.formatConfigId}|${p.source}`, `${p.sourceDisplay}, ${p.formatDisplay}`]),
  );
  const runs = runsRes.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Market Signals</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        The nightly engine that places each priced player&apos;s value inside a band built from
        his own last 30 days and labels him buy, near a buy window, hold, near a sell window or
        sell, per format and source. It runs at 10:30 and again at 10:50 UTC; the second run
        finishes whatever the first did not. The Team Blueprint calls and the player profile
        badge read it.
      </p>

      <MarketSignalsSettingsManager
        initialSettings={settings}
        partitions={partitions.map((p) => ({
          key: `${p.formatConfigId}|${p.source}`,
          label: `${p.sourceDisplay}, ${p.formatDisplay}`,
        }))}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Table sizes</h2>
        <div className="mt-3 overflow-x-auto rounded-card border border-line">
          <table className="w-full">
            <caption className="sr-only">Rows held in each Market Signals and Blueprint table</caption>
            <thead className="bg-surface-elevated/50">
              <tr>
                <th scope="col" className={th}>Table</th>
                <th scope="col" className={`${th} text-right`}>Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SIZE_TABLES.map((t, i) => (
                <tr key={t}>
                  <th scope="row" className={`${td} text-left font-mono font-normal`}>{t}</th>
                  <td className={tdNum}>
                    {counts[i]?.count == null ? "Unknown" : counts[i]!.count!.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Last 40 partition runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No runs yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-card border border-line">
            <table className="w-full min-w-[40rem]">
              <caption className="sr-only">Recent Market Signals partition runs, newest first</caption>
              <thead className="bg-surface-elevated/50">
                <tr>
                  <th scope="col" className={th}>Partition</th>
                  <th scope="col" className={th}>As of</th>
                  <th scope="col" className={`${th} text-right`}>Rows</th>
                  <th scope="col" className={`${th} text-right`}>Changes</th>
                  <th scope="col" className={`${th} text-right`}>Seconds</th>
                  <th scope="col" className={th}>Ran at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className={`${td} text-left font-normal`}>
                      {labelOf.get(`${r.format_config_id}|${r.source}`) ?? r.source}
                    </th>
                    <td className={td}>{formatSignalDay(r.as_of_day)}</td>
                    <td className={tdNum}>
                      {r.rows_written.toLocaleString("en-US")}
                      {r.rows_written === 0 && <span className="text-ink-subtle"> (too thin)</span>}
                    </td>
                    <td className={tdNum}>{r.changes_written.toLocaleString("en-US")}</td>
                    <td className={tdNum}>{(r.duration_ms / 1000).toFixed(1)}</td>
                    <td className={td}>{formatEastern(r.ran_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
