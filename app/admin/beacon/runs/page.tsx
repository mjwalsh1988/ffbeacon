import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { CRON_JOBS, describeCronSchedule } from "@/lib/cron-runs";
import { CronStatusBadge } from "@/components/cron-status-badge";
import { formatRelative, formatEastern } from "@/lib/datetime";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";

export const metadata: Metadata = { title: "Runs & monitoring" };
export const dynamic = "force-dynamic";

type RunRow = {
  id: string; status: string; started_at: string; finished_at: string | null;
  source_freshness: unknown; skipped_no_signal: number | null; factor_saturated: number | null;
  players_processed: number | null; rows_written: number | null; ai_calls: number | null; notes: string | null;
};

export default async function BeaconRunsPage() {
  await requireAdmin("/admin/beacon/runs");
  const admin = createAdminClient();
  const nowMs = Date.now();

  const [{ data: runs }, { data: cron }] = await Promise.all([
    admin
      .from("beacon_value_runs")
      .select("id, status, started_at, finished_at, source_freshness, skipped_no_signal, factor_saturated, players_processed, rows_written, ai_calls, notes")
      .order("started_at", { ascending: false }).limit(12),
    admin.from("cron_runs").select("job_name, status, started_at").order("started_at", { ascending: false }).limit(120),
  ]);

  const latestCronByJob = new Map<string, { status: string; started_at: string }>();
  for (const r of cron ?? []) if (!latestCronByJob.has(r.job_name)) latestCronByJob.set(r.job_name, r);

  return (
    <BeaconPageShell
      title="Runs & monitoring"
      description="Observability for recompute runs and the live status of every scheduled job. No controls here, just the truth about what ran."
    >
      <div className="space-y-10">
        <section aria-labelledby="runs-h">
          <h3 id="runs-h" className="mb-4 text-lg font-semibold tracking-tight text-ink">Recompute runs</h3>
          {(runs ?? []).length === 0 ? (
            <p className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">No recompute runs recorded yet.</p>
          ) : (
            <ul role="list" className="grid gap-3">
              {(runs as RunRow[]).map((r) => {
                const fresh = Array.isArray(r.source_freshness) ? (r.source_freshness as Array<Record<string, unknown>>) : [];
                const dropped = fresh.filter((f) => f.droppedForStaleness === true).map((f) => String(f.source));
                return (
                  <li key={r.id} className="rounded-card border border-line bg-surface/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-ink" title={formatEastern(r.started_at)}>{formatRelative(r.started_at, nowMs)}</p>
                      <CronStatusBadge status={r.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                      <RunField label="Players">{r.players_processed ?? "n/a"}</RunField>
                      <RunField label="Rows">{r.rows_written ?? "n/a"}</RunField>
                      <RunField label="Skipped (no signal)">{r.skipped_no_signal ?? "n/a"}</RunField>
                      <RunField label="Factor saturated">{r.factor_saturated ?? "n/a"}</RunField>
                      <RunField label="AI calls">{r.ai_calls ?? "n/a"}</RunField>
                    </dl>
                    {dropped.length > 0 && (
                      <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                        Sources dropped for staleness: {dropped.join(", ")}
                      </p>
                    )}
                    {Number(r.factor_saturated ?? 0) > 0 && (
                      <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                        {r.factor_saturated} players hit the factor clamp. Weights may be too hot.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="cron-h">
          <div className="mb-4 flex items-end justify-between gap-3">
            <h3 id="cron-h" className="text-lg font-semibold tracking-tight text-ink">All cron jobs</h3>
            <Link href="/admin/crons" className="text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">Full logs →</Link>
          </div>
          <ul role="list" className="grid gap-2">
            {CRON_JOBS.map((j) => {
              const run = latestCronByJob.get(j.name);
              return (
                <li key={j.name} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/60 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{j.label} <span className="font-mono text-xs text-ink-subtle">{j.name}</span></p>
                    <p className="text-xs text-ink-subtle">{describeCronSchedule(j.schedule, nowMs)}{run ? `, last ${formatRelative(run.started_at, nowMs)}` : ", no runs yet"}</p>
                  </div>
                  <CronStatusBadge status={run?.status ?? "none"} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </BeaconPageShell>
  );
}

function RunField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-mono tabular-nums text-ink">{children}</dd>
    </div>
  );
}
