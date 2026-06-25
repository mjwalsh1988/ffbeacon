import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "The Beacon Brief" };
export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold ${tone === "danger" && value > 0 ? "text-signal-danger" : "text-ink"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export default async function BeaconBriefOverviewPage() {
  await requireAdmin("/admin/beacon-brief");
  const admin = createAdminClient();

  const [
    activeSources,
    publishedArticles,
    pendingWork,
    pendingDeletionChecks,
    failedJobs,
    pendingModeration,
    filteredPosts,
    curateRun,
    workerRun,
    recentLogs,
  ] = await Promise.all([
    admin
      .from("news_sources")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    admin
      .from("articles")
      .select("*", { count: "exact", head: true })
      .eq("origin", "beacon_brief")
      .eq("status", "published"),
    admin
      .from("beacon_brief_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .neq("job_type", "deletion_check"),
    admin
      .from("beacon_brief_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("job_type", "deletion_check"),
    admin
      .from("beacon_brief_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed"),
    admin
      .from("beacon_brief_moderation")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    admin
      .from("news_ingestions")
      .select("*", { count: "exact", head: true })
      .eq("status", "filtered"),
    admin
      .from("cron_runs")
      .select("status, started_at")
      .eq("job_name", "beacon-brief-curate")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("cron_runs")
      .select("status, started_at")
      .eq("job_name", "beacon-brief-worker")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("beacon_brief_logs")
      .select("id, stage, level, message, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const lastRun = (r: {
    data: { status: string; started_at: string } | null;
  }) =>
    r.data
      ? `${r.data.status} at ${formatEastern(r.data.started_at)}`
      : "no runs yet";

  const logs = recentLogs.data ?? [];

  return (
    <BeaconBriefPageShell
      title="Overview"
      description="The Beacon Brief at a glance: source and article counts, queue health, and recent activity. Curation runs every 5 minutes; the worker drains the queue every minute."
    >
      <div className="space-y-8">
        <section aria-labelledby="bb-stats">
          <h2 id="bb-stats" className="sr-only">
            Counts
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <StatCard
              label="Active sources"
              value={activeSources.count ?? 0}
              hint="accounts we watch"
            />
            <StatCard
              label="Published"
              value={publishedArticles.count ?? 0}
              hint="live articles"
            />
            <StatCard
              label="Queued tasks"
              value={pendingWork.count ?? 0}
              hint="posts and articles waiting"
            />
            <StatCard
              label="Deletion checks"
              value={pendingDeletionChecks.count ?? 0}
              hint="auto source re-checks, normal"
            />
            <StatCard
              label="Failed tasks"
              value={failedJobs.count ?? 0}
              tone="danger"
              hint="need attention"
            />
            <StatCard
              label="Needs review"
              value={pendingModeration.count ?? 0}
              tone="danger"
              hint="waiting on you"
            />
            <StatCard
              label="Filtered"
              value={filteredPosts.count ?? 0}
              hint="non-football, held back"
            />
          </div>
        </section>

        <section aria-labelledby="bb-runs">
          <h2
            id="bb-runs"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Last cron runs
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">
                Curation (every 5 min)
              </dt>
              <dd className="mt-1 text-sm text-ink-muted">
                {lastRun(curateRun)}
              </dd>
            </div>
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <dt className="text-sm font-medium text-ink">
                Worker (every minute)
              </dt>
              <dd className="mt-1 text-sm text-ink-muted">
                {lastRun(workerRun)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="bb-activity">
          <h2
            id="bb-activity"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Recent activity
          </h2>
          {logs.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No activity yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface/60">
              {logs.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm"
                >
                  <span className="font-mono text-xs text-ink-subtle">
                    {formatEastern(l.created_at)}
                  </span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                    {l.stage}
                  </span>
                  <span
                    className={
                      l.level === "error"
                        ? "text-signal-danger"
                        : l.level === "warn"
                          ? "text-signal-warning"
                          : "text-ink"
                    }
                  >
                    {l.message ?? l.level}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </BeaconBriefPageShell>
  );
}
