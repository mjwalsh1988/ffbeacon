import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { CRON_JOBS, summarizeCronResult, type CronJobName } from "@/lib/cron-runs";
import { CronStatusBadge } from "@/components/cron-status-badge";
import { formatRelative, formatUtc, formatDuration } from "@/lib/datetime";
import type { Json } from "@/lib/database.types";

export const metadata: Metadata = { title: "Cron Logs" };

const FEED_LIMIT = 100;

type RunRow = {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result: Json | null;
  error: string | null;
};

const JOB_LABEL = new Map(CRON_JOBS.map((j) => [j.name, j.label] as const));

function isCronJobName(value: string | undefined): value is CronJobName {
  return !!value && CRON_JOBS.some((j) => j.name === value);
}

export default async function AdminCronLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  await requireAdmin("/admin/crons");

  const { job } = await searchParams;
  const activeJob = isCronJobName(job) ? job : null;

  const admin = createAdminClient();
  let query = admin
    .from("cron_runs")
    .select("id, job_name, status, started_at, finished_at, duration_ms, result, error")
    .order("started_at", { ascending: false })
    .limit(FEED_LIMIT);
  if (activeJob) query = query.eq("job_name", activeJob);

  const { data: runs } = await query;
  const nowMs = Date.now();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Operations
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Cron run logs
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          The most recent {FEED_LIMIT} scheduled job runs, newest first. Each run
          records its status, timing, and the result the handler returned so
          you can confirm a job ran and succeeded.
        </p>
      </header>

      <JobFilter activeJob={activeJob} />

      {!runs || runs.length === 0 ? (
        <p className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
          {activeJob
            ? "No runs recorded for this job yet. Runs appear here the first time the cron fires after this logging was added."
            : "No cron runs recorded yet. Runs appear here the first time a cron fires after this logging was added."}
        </p>
      ) : (
        <ul role="list" className="grid gap-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run as RunRow} nowMs={nowMs} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobFilter({ activeJob }: { activeJob: CronJobName | null }) {
  const chip = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active
        ? "border-brand-purple bg-brand-purple/10 text-ink"
        : "border-line bg-surface text-ink-muted hover:text-ink"
    }`;
  return (
    <nav aria-label="Filter by job" className="flex flex-wrap gap-2">
      <Link
        href="/admin/crons"
        aria-current={activeJob === null ? "page" : undefined}
        className={chip(activeJob === null)}
      >
        All jobs
      </Link>
      {CRON_JOBS.map((j) => (
        <Link
          key={j.name}
          href={`/admin/crons?job=${j.name}`}
          aria-current={activeJob === j.name ? "page" : undefined}
          className={chip(activeJob === j.name)}
        >
          {j.label}
        </Link>
      ))}
    </nav>
  );
}

function RunCard({ run, nowMs }: { run: RunRow; nowMs: number }) {
  const summary = summarizeCronResult(run.result);
  const label = JOB_LABEL.get(run.job_name as CronJobName) ?? run.job_name;
  const hasRawResult =
    run.result != null &&
    typeof run.result === "object" &&
    Object.keys(run.result as object).length > 0;

  return (
    <li className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{label}</p>
          <p className="mt-0.5 font-mono text-xs text-ink-subtle">{run.job_name}</p>
        </div>
        <CronStatusBadge status={run.status} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Started">
          <span title={formatUtc(run.started_at)}>
            {formatRelative(run.started_at, nowMs)}
          </span>
        </Field>
        <Field label="Finished">
          <span title={formatUtc(run.finished_at)}>
            {run.finished_at ? formatRelative(run.finished_at, nowMs) : "Not finished"}
          </span>
        </Field>
        <Field label="Duration">{formatDuration(run.duration_ms)}</Field>
        {summary.slice(0, 5).map((s) => (
          <Field key={s.label} label={s.label}>
            {s.value}
          </Field>
        ))}
      </dl>

      {run.error && (
        <p className="mt-3 rounded-card border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
          {run.error}
        </p>
      )}

      {hasRawResult && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            Raw result
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-card border border-line bg-base p-3 font-mono text-xs leading-relaxed text-ink-muted">
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
