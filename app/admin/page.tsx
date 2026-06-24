import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { CRON_JOBS, summarizeCronResult, type CronJobName } from "@/lib/cron-runs";
import { CronStatusBadge } from "@/components/cron-status-badge";
import { AdminHero } from "@/components/admin/admin-hero";
import { formatRelative, formatEastern, formatDuration } from "@/lib/datetime";
import type { Json } from "@/lib/database.types";

export const metadata: Metadata = { title: "Overview" };

type LatestRun = {
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result: Json | null;
  error: string | null;
};

export default async function AdminOverviewPage() {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin();

  const admin = createAdminClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    players,
    leagues,
    users,
    admins,
    trends,
    snaps24h,
    recentRuns,
    recentLeagues,
  ] = await Promise.all([
    admin.from("players").select("id", { count: "exact", head: true }),
    admin.from("leagues").select("id", { count: "exact", head: true }),
    admin.from("user_preferences").select("user_id", { count: "exact", head: true }),
    admin
      .from("user_preferences")
      .select("user_id", { count: "exact", head: true })
      .eq("is_admin", true),
    admin.from("player_value_trends").select("player_id", { count: "exact", head: true }),
    admin
      .from("player_value_history")
      .select("id", { count: "exact", head: true })
      .gte("captured_at", since24h),
    admin
      .from("cron_runs")
      .select("job_name, status, started_at, finished_at, duration_ms, result, error")
      .order("started_at", { ascending: false })
      .limit(100),
    admin
      .from("leagues")
      .select("sleeper_league_id, name, season, total_rosters, last_pulsed_at")
      .order("last_pulsed_at", { ascending: false, nullsFirst: false })
      .limit(6),
  ]);

  // Latest run per job from the recent slice.
  const latestByJob = new Map<string, LatestRun>();
  for (const run of recentRuns.data ?? []) {
    if (!latestByJob.has(run.job_name)) {
      latestByJob.set(run.job_name, run as LatestRun);
    }
  }

  const nowMs = Date.now();

  const stats: Array<{ label: string; value: string; caption: string }> = [
    {
      label: "Players tracked",
      value: fmtCount(players.count),
      caption: "Rows in the players dimension.",
    },
    {
      label: "Leagues synced",
      value: fmtCount(leagues.count),
      caption: "League Pulse leagues stored.",
    },
    {
      label: "Registered users",
      value: fmtCount(users.count),
      caption: `${fmtCount(admins.count)} admin${admins.count === 1 ? "" : "s"}.`,
    },
    {
      label: "Trend combos",
      value: fmtCount(trends.count),
      caption: "player_value_trends rows.",
    },
    {
      label: "Snapshots (24h)",
      value: fmtCount(snaps24h.count),
      caption: "Value rows written in the last day.",
    },
  ];

  return (
    <div className="space-y-12">
      <AdminHero />
      <StatsSection stats={stats} />
      <CronHealthSection latestByJob={latestByJob} nowMs={nowMs} />
      <RecentLeaguesSection leagues={recentLeagues.data ?? []} nowMs={nowMs} />
    </div>
  );
}

function fmtCount(n: number | null): string {
  if (n == null) return "n/a";
  return new Intl.NumberFormat("en-US").format(n);
}

/* ---------- Stats ---------- */

function StatsSection({
  stats,
}: {
  stats: Array<{ label: string; value: string; caption: string }>;
}) {
  return (
    <section aria-labelledby="admin-stats-heading">
      <SectionEyebrow>System</SectionEyebrow>
      <h2
        id="admin-stats-heading"
        className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        At a glance
      </h2>
      <ul
        role="list"
        className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5"
      >
        {stats.map((stat) => (
          <li
            key={stat.label}
            className="rounded-card border border-line bg-surface/60 p-4"
          >
            <p
              className="bg-clip-text font-mono text-2xl font-bold tabular-nums text-transparent sm:text-3xl"
              style={{
                backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {stat.label}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {stat.caption}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Cron health ---------- */

function CronHealthSection({
  latestByJob,
  nowMs,
}: {
  latestByJob: Map<string, LatestRun>;
  nowMs: number;
}) {
  return (
    <section aria-labelledby="admin-cron-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionEyebrow>Health</SectionEyebrow>
          <h2
            id="admin-cron-heading"
            className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Nightly crons
          </h2>
        </div>
        <Link
          href="/admin/crons"
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          View all logs
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul role="list" className="mt-6 grid gap-3">
        {CRON_JOBS.map((job) => {
          const run = latestByJob.get(job.name);
          return (
            <CronHealthRow
              key={job.name}
              name={job.name}
              label={job.label}
              schedule={job.scheduleHuman}
              run={run}
              nowMs={nowMs}
            />
          );
        })}
      </ul>
    </section>
  );
}

function CronHealthRow({
  label,
  schedule,
  run,
  nowMs,
}: {
  name: CronJobName;
  label: string;
  schedule: string;
  run: LatestRun | undefined;
  nowMs: number;
}) {
  const summary = run ? summarizeCronResult(run.result) : [];
  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{label}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{schedule}</p>
        </div>
        <CronStatusBadge status={run?.status ?? "none"} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Field label="Last run">
          {run ? (
            <span title={formatEastern(run.started_at)}>
              {formatRelative(run.started_at, nowMs)}
            </span>
          ) : (
            "No runs yet"
          )}
        </Field>
        <Field label="Duration">{formatDuration(run?.duration_ms)}</Field>
        {summary.slice(0, 2).map((s) => (
          <Field key={s.label} label={s.label}>
            {s.value}
          </Field>
        ))}
      </dl>

      {run?.error && (
        <p className="mt-3 rounded-card border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
          {run.error}
        </p>
      )}
    </li>
  );
}

/* ---------- Recent leagues ---------- */

function RecentLeaguesSection({
  leagues,
  nowMs,
}: {
  leagues: Array<{
    sleeper_league_id: string;
    name: string | null;
    season: number | null;
    total_rosters: number | null;
    last_pulsed_at: string | null;
  }>;
  nowMs: number;
}) {
  return (
    <section aria-labelledby="admin-activity-heading">
      <SectionEyebrow>Activity</SectionEyebrow>
      <h2
        id="admin-activity-heading"
        className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        Recently pulsed leagues
      </h2>

      {leagues.length === 0 ? (
        <p className="mt-6 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
          No leagues have been pulsed yet.
        </p>
      ) : (
        <ul role="list" className="mt-6 grid gap-3">
          {leagues.map((lg) => (
            <li
              key={lg.sleeper_league_id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border border-line bg-surface/60 p-4"
            >
              <div className="min-w-0">
                <Link
                  href={`/leagues/${lg.sleeper_league_id}`}
                  className="font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {lg.name ?? "Unnamed league"}
                </Link>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {lg.season ?? "Unknown"} season
                  {lg.total_rosters ? `, ${lg.total_rosters} teams` : ""}
                </p>
              </div>
              <p className="text-xs text-ink-muted" title={formatEastern(lg.last_pulsed_at)}>
                {lg.last_pulsed_at
                  ? `Pulsed ${formatRelative(lg.last_pulsed_at, nowMs)}`
                  : "Never pulsed"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Shared ---------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
