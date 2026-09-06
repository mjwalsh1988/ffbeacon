import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern, formatDuration, formatRelative } from "@/lib/datetime";
import { ManagerPulseSubnav } from "@/components/admin/manager-pulse-subnav";
import type { Json } from "@/lib/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manager Pulse queue" };

/** The two job kinds league_sync_jobs_job_kind_check permits (migration 0255).
 *  'pulse' is a Sync all job; 'footprint' is a Manager Pulse capture job. Both
 *  are drained by the same worker, from the same table. */
const JOB_KINDS = ["pulse", "footprint"] as const;
type JobKind = (typeof JOB_KINDS)[number];

const JOB_KIND_LABEL: Record<JobKind, string> = {
  pulse: "Sync all",
  footprint: "Manager Pulse capture",
};

function isJobKind(value: string): value is JobKind {
  return (JOB_KINDS as readonly string[]).includes(value);
}

/** Rows read to build the pending-by-owner breakdown. A snapshot of the whole
 * pending queue, not a page: bounded so a queue backlog cannot turn this page
 * into an unbounded scan. The exact pending/processing counts shown above the
 * breakdown come from separate head:true counts and stay exact even when this
 * sample is capped; only the owner ranking beneath it can go approximate. */
const PENDING_OWNER_SAMPLE_CAP = 2000;

/** Rows read to sum sleeper_calls over the last hour. A one-hour window at the
 * worker's own pace (at most a handful of jobs per minute) sits far under this
 * cap in ordinary operation; it exists so a runaway backlog cannot turn a
 * bounded time window into an unbounded read. */
const RECENT_CALLS_SAMPLE_CAP = 2000;

/** Page size for loadRecentCalls and loadPendingOwners, matching PostgREST's
 * own 1000-row cap on a plain select. Both sample caps above sit past that
 * cap, so each read is paged with `.range()` up to its own cap rather than
 * a single `.limit()` call, which PostgREST would silently truncate at 1000
 * regardless of the larger number requested. */
const SAMPLE_PAGE_SIZE = 1000;

const RECENT_CALLS_WINDOW_MS = 60 * 60 * 1000;

const CRON_RUN_LIMIT = 10;

const TOP_OWNER_LIMIT = 20;

type PendingOwnerRow = {
  user_id: string;
  manager_run_id: string | null;
  job_kind: string;
  manager_pulse_runs: { sleeper_handle: string | null } | null;
};

type OwnerAgg = {
  label: string;
  jobKind: JobKind;
  pending: number;
};

type LeaseRow = {
  holder: string | null;
  held_until: string;
  updated_at: string;
};

type CronRunRow = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result: Json | null;
  error: string | null;
};

/** One person's queued work, named the way the spec asks: a Manager Pulse
 * job's owner is that run's sleeper_handle when one was recorded, otherwise a
 * prefix of the user id (same "Guest 12345678" shorthand used on the Signal
 * Scout admin pages); a Sync all job has no handle to read at all, so it is
 * always the user id prefix. The job_kind column beside this label already
 * says which source queued it, so the label itself does not need to repeat
 * that. */
function ownerLabel(row: PendingOwnerRow): string {
  if (row.manager_run_id) {
    const handle = row.manager_pulse_runs?.sleeper_handle;
    if (handle) return handle;
  }
  return `user ${row.user_id.slice(0, 8)}`;
}

async function countJobs(
  admin: ReturnType<typeof createAdminClient>,
  jobKind: JobKind,
  status: "pending" | "processing",
): Promise<number> {
  const { count } = await admin
    .from("league_sync_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_kind", jobKind)
    .eq("status", status);
  return count ?? 0;
}

type RecentCallRow = { sleeper_calls: number | null };

/**
 * sleeper_calls for every league_sync_jobs row that finished within the given
 * window, newest first, paged up to RECENT_CALLS_SAMPLE_CAP so the cap is
 * real rather than silently truncated at PostgREST's own 1000-row default.
 */
async function loadRecentCalls(
  admin: ReturnType<typeof createAdminClient>,
  cutoff: string,
): Promise<{ rows: RecentCallRow[]; capped: boolean }> {
  const rows: RecentCallRow[] = [];
  let capped = false;
  for (let from = 0; from < RECENT_CALLS_SAMPLE_CAP; from += SAMPLE_PAGE_SIZE) {
    const to = Math.min(from + SAMPLE_PAGE_SIZE, RECENT_CALLS_SAMPLE_CAP) - 1;
    const { data, error } = await admin
      .from("league_sync_jobs")
      .select("sleeper_calls")
      .not("finished_at", "is", null)
      .gte("finished_at", cutoff)
      .order("finished_at", { ascending: false })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as RecentCallRow[]));
    if (data.length < to - from + 1) break;
    if (to + 1 >= RECENT_CALLS_SAMPLE_CAP) capped = true;
  }
  return { rows, capped };
}

/**
 * A snapshot of pending league_sync_jobs rows (oldest first, matching the
 * worker's own drain order), paged up to PENDING_OWNER_SAMPLE_CAP so the cap
 * is real rather than silently truncated at PostgREST's own 1000-row default.
 */
async function loadPendingOwners(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ rows: PendingOwnerRow[]; capped: boolean }> {
  const rows: PendingOwnerRow[] = [];
  let capped = false;
  for (let from = 0; from < PENDING_OWNER_SAMPLE_CAP; from += SAMPLE_PAGE_SIZE) {
    const to = Math.min(from + SAMPLE_PAGE_SIZE, PENDING_OWNER_SAMPLE_CAP) - 1;
    const { data, error } = await admin
      .from("league_sync_jobs")
      .select("user_id, manager_run_id, job_kind, manager_pulse_runs(sleeper_handle)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as PendingOwnerRow[]));
    if (data.length < to - from + 1) break;
    if (to + 1 >= PENDING_OWNER_SAMPLE_CAP) capped = true;
  }
  return { rows, capped };
}

/** Flatten one worker run's WorkerSummary (lib/league-bulk-sync.ts
 * runLeagueSyncWorker) into label/value pairs for compact display. This is a
 * different shape than the other cron jobs' results, so it is read here
 * rather than through lib/cron-runs.ts summarizeCronResult, which does not
 * know these field names. Unknown or empty results return an empty list so
 * the row falls back to its error text instead of showing nothing. */
function describeWorkerSummary(result: Json | null): Array<{ label: string; value: string }> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const r = result as Record<string, unknown>;
  const pairs: Array<{ label: string; value: string }> = [];
  const push = (label: string, key: string) => {
    const v = r[key];
    if (typeof v === "number" || typeof v === "string") pairs.push({ label, value: String(v) });
  };
  push("Claimed", "claimed");
  push("Done", "done");
  push("Retried", "retried");
  push("Failed", "failed");
  push("Reaped", "reaped");
  push("Released", "released");
  push("Requests completed", "requestsCompleted");
  push("Reports finalized", "finalized");
  push("Live reports", "liveReports");
  push("Sleeper calls", "callsMade");
  return pairs;
}

function cronStatusTone(status: string): string {
  if (status === "error") return "border-signal-danger/40 bg-signal-danger/10 text-signal-danger";
  if (status === "success") return "border-signal-success/40 bg-signal-success/10 text-signal-success";
  if (status === "skipped") return "border-signal-warning/40 bg-signal-warning/10 text-signal-warning";
  return "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
}

export default async function ManagerPulseQueuePage() {
  await requireAdmin("/admin/manager-pulse/queue");
  const admin = createAdminClient();

  const callsCutoff = new Date(Date.now() - RECENT_CALLS_WINDOW_MS).toISOString();

  const [
    pendingPulse,
    pendingFootprint,
    processingPulse,
    processingFootprint,
    oldestPendingRes,
    leaseRes,
    cronRunsRes,
    recentCalls,
    pendingOwners,
  ] = await Promise.all([
    countJobs(admin, "pulse", "pending"),
    countJobs(admin, "footprint", "pending"),
    countJobs(admin, "pulse", "processing"),
    countJobs(admin, "footprint", "processing"),
    admin
      .from("league_sync_jobs")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("league_sync_worker_lease")
      .select("holder, held_until, updated_at")
      .eq("id", "global")
      .maybeSingle(),
    admin
      .from("cron_runs")
      .select("id, status, started_at, finished_at, duration_ms, result, error")
      .eq("job_name", "league-sync-worker")
      .order("started_at", { ascending: false })
      .limit(CRON_RUN_LIMIT),
    loadRecentCalls(admin, callsCutoff),
    loadPendingOwners(admin),
  ]);

  const countsByKind: Record<JobKind, { pending: number; processing: number }> = {
    pulse: { pending: pendingPulse, processing: processingPulse },
    footprint: { pending: pendingFootprint, processing: processingFootprint },
  };
  const totalPending = pendingPulse + pendingFootprint;
  const totalProcessing = processingPulse + processingFootprint;

  const oldestPendingAt = oldestPendingRes.data?.created_at ?? null;

  const lease = (leaseRes.data ?? null) as LeaseRow | null;
  const leaseHeld = lease ? new Date(lease.held_until).getTime() > Date.now() : false;

  const cronRuns = (cronRunsRes.data ?? []) as CronRunRow[];

  const callsRows = recentCalls.rows;
  const callsCapped = recentCalls.capped;
  const knownCallsRows = callsRows.filter((r) => r.sleeper_calls != null);
  const sleeperCallsSum = knownCallsRows.reduce((sum, r) => sum + (r.sleeper_calls ?? 0), 0);
  const unknownCallsJobs = callsRows.length - knownCallsRows.length;

  const pendingOwnerRows = pendingOwners.rows;
  const ownerSampleCapped = pendingOwners.capped;

  const ownerMap = new Map<string, OwnerAgg>();
  for (const row of pendingOwnerRows) {
    const jobKind: JobKind = isJobKind(row.job_kind) ? row.job_kind : "pulse";
    const label = ownerLabel(row);
    const key = `${jobKind}:${label}`;
    const existing = ownerMap.get(key);
    if (existing) existing.pending += 1;
    else ownerMap.set(key, { label, jobKind, pending: 1 });
  }
  const topOwners = Array.from(ownerMap.values())
    .sort((a, b) => b.pending - a.pending)
    .slice(0, TOP_OWNER_LIMIT);

  return (
    <>
      <ManagerPulseSubnav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manager Pulse queue</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          The league_sync_jobs drain, right now: how deep it is, who is waiting, whether the worker
          holds its lease, and what its last few runs did.
        </p>

        <section aria-labelledby="mpq-depth" className="mt-8">
          <h2 id="mpq-depth" className="text-lg font-semibold tracking-tight text-ink">
            Queue depth
          </h2>
          <div
            tabIndex={0}
            role="region"
            aria-label="Queue depth table, scrollable"
            className="mt-3 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">
                Pending and processing job counts by job kind
              </caption>
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Job kind
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Pending
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Processing
                  </th>
                </tr>
              </thead>
              <tbody>
                {JOB_KINDS.map((kind) => (
                  <tr key={kind} className="border-t border-line/60">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                      {JOB_KIND_LABEL[kind]}
                    </th>
                    <td className="px-3 py-2 text-ink-muted">{countsByKind[kind].pending}</td>
                    <td className="px-3 py-2 text-ink-muted">{countsByKind[kind].processing}</td>
                  </tr>
                ))}
                <tr className="border-t border-line/60 bg-surface/40">
                  <th scope="row" className="px-3 py-2 text-left font-semibold text-ink">
                    Total
                  </th>
                  <td className="px-3 py-2 font-semibold text-ink">{totalPending}</td>
                  <td className="px-3 py-2 font-semibold text-ink">{totalProcessing}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-card border border-line bg-surface/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Oldest pending job
              </p>
              {oldestPendingAt ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-ink">
                    {formatRelative(oldestPendingAt)}
                  </p>
                  <p className="mt-2 text-xs text-ink-subtle">
                    Queued {formatEastern(oldestPendingAt)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-2xl font-bold text-ink">None</p>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Sleeper calls, last 60 minutes
              </p>
              <p className="mt-1 text-2xl font-bold text-ink">{sleeperCallsSum}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                Sum of sleeper_calls across {callsRows.length} finished job
                {callsRows.length === 1 ? "" : "s"} in the window.
                {unknownCallsJobs > 0
                  ? ` ${unknownCallsJobs} of those finished before this column existed and carry no count, so this total is an undercount, not a zero.`
                  : ""}
                {callsCapped
                  ? ` Capped at ${RECENT_CALLS_SAMPLE_CAP} rows; the true total may be higher.`
                  : ""}
              </p>
            </div>

            <div className="rounded-card border border-line bg-surface/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Worker lease
              </p>
              <p
                className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  leaseHeld
                    ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
                    : "border-line bg-surface text-ink-muted"
                }`}
              >
                {leaseHeld ? "Held" : "Free"}
              </p>
              {lease ? (
                <>
                  <p className="mt-2 text-xs text-ink-subtle">
                    Holder: {lease.holder ?? "none recorded"}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    Held until {formatEastern(lease.held_until)}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    Last touched {formatEastern(lease.updated_at)}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-subtle">No lease row found.</p>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="mpq-owners" className="mt-10">
          <h2 id="mpq-owners" className="text-lg font-semibold tracking-tight text-ink">
            Pending by owner
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            The top {TOP_OWNER_LIMIT} owners by pending job count, out of a sample of up to{" "}
            {PENDING_OWNER_SAMPLE_CAP} pending rows.
          </p>
          {ownerSampleCapped ? (
            <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
              This sample hit its {PENDING_OWNER_SAMPLE_CAP}-row cap. The pending/processing totals
              above are still exact; this ranking may be missing owners who only appear past the cap.
            </p>
          ) : null}

          {topOwners.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
              No pending jobs right now.
            </p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Pending jobs by owner, scrollable"
              className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <table className="w-max min-w-full border-collapse text-sm">
                <caption className="sr-only">
                  Owners with pending Manager Pulse queue jobs, most pending first
                </caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Source
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Owner
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Pending
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topOwners.map((owner) => (
                    <tr key={`${owner.jobKind}:${owner.label}`} className="border-t border-line/60">
                      <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                        {JOB_KIND_LABEL[owner.jobKind]}
                      </th>
                      <td className="px-3 py-2 text-ink-muted">{owner.label}</td>
                      <td className="px-3 py-2 text-ink-muted">{owner.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="mpq-runs" className="mt-10">
          <h2 id="mpq-runs" className="text-lg font-semibold tracking-tight text-ink">
            Recent worker runs
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            The last {CRON_RUN_LIMIT} recorded ticks of the league-sync-worker cron.
          </p>

          {cronRuns.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
              No recorded runs yet.
            </p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Recent league-sync-worker runs, scrollable"
              className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <table className="w-max min-w-full border-collapse text-sm">
                <caption className="sr-only">
                  Recent league-sync-worker cron runs, newest first, with each run's summary
                </caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Started
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Duration
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Summary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cronRuns.map((run) => {
                    const summary = describeWorkerSummary(run.result);
                    return (
                      <tr key={run.id} className="border-t border-line/60 align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                          {formatEastern(run.started_at)}
                        </th>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cronStatusTone(run.status)}`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-muted">
                          {formatDuration(run.duration_ms)}
                        </td>
                        <td className="max-w-sm px-3 py-2 text-ink-muted">
                          {summary.length > 0 ? (
                            <ul className="space-y-0.5">
                              {summary.map((pair) => (
                                <li key={pair.label}>
                                  {pair.label}: {pair.value}
                                </li>
                              ))}
                            </ul>
                          ) : run.error ? (
                            <span className="text-signal-danger">{run.error}</span>
                          ) : (
                            <span className="text-ink-subtle">No summary recorded.</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
