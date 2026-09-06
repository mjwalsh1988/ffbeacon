import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { pulseLeagueCore, pulseLeagueDerived, pulseLeagueFootprint } from "@/lib/league-pulse";
import { currentNflSeason, mapLimit } from "@/lib/sleeper";
import { configureSleeperBudget, countSleeperCalls } from "@/lib/sleeper-budget";
import {
  BULK_SYNC_COOLDOWN_SECONDS,
  IDLE_BULK_SYNC_STATE,
  type BulkSyncState,
  type LeagueSyncJobStatus,
} from "@/lib/league-bulk-sync-types";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { managerPulseNeedsCapture } from "@/lib/manager-pulse/freshness";
import { finalizeManagerPulseRun } from "@/lib/manager-pulse/finalize";
import { shouldComputeLiveReport, computeLiveReport } from "@/lib/manager-pulse/live-report";
import { coalesce } from "@/lib/request-coalesce";
import type { ManagerPulseSettings } from "@/lib/manager-pulse/types";
import type { ManagerPulseSyncSettings } from "@/lib/manager-pulse/default-settings";

/**
 * Sync all: one press, every league, drained by a worker.
 *
 * WHERE THIS LIVES IN THE PRODUCT
 *   Only on /my-beacon/sleeper-leagues, and only for someone signed in. The
 *   public tool at /tools/league-pulse keeps the single-league Sync button it
 *   already has (lib/league-sync-queue.tsx, migration 0168) and never sees any of
 *   this. A guest pressing one button at a time is a bounded cost; a guest
 *   pressing one button that queues twenty syncs is not.
 *
 * WHY A QUEUE AND NOT TWENTY REQUESTS
 *   A league pulse is a full Sleeper round trip: the league, its rosters, its
 *   members, its drafts and traded picks, then a request per week of transaction
 *   history and per week of the schedule. Somewhere between ten and forty-five
 *   calls, depending on how much of the season has happened. Twenty leagues
 *   starting together is a thousand calls in a few seconds against a public API
 *   that asks callers to stay under a thousand a minute, from one person.
 *
 *   So the button writes rows and returns. The worker (every minute, see
 *   app/api/cron/league-sync-worker) takes a few at a time. That ordering is also
 *   what lets the page say "you can leave": nothing about the work depends on a
 *   browser staying open.
 *
 * WHY NOT FORCE
 *   Jobs run the same pulse a page load runs, cache and all. A league somebody
 *   opened twenty minutes ago is already fresh, so it costs one indexed read and
 *   no Sleeper traffic; a league nobody has ever opened does the full sync. With
 *   a twelve-hour gap between presses, near enough everything is stale by the
 *   next one anyway, so forcing would buy nothing and spend a great deal.
 *
 * HOW A PASS IS PACED, NOW THAT THERE IS EXACTLY ONE DRAINER
 *   A lease row (league_sync_worker_lease, migration 0264) makes exactly one
 *   worker pass drain this queue at a time. With one drainer, the process-wide
 *   Sleeper token bucket (lib/sleeper-budget.ts) in front of every Sleeper call
 *   IS the site's budget for queue traffic: there is no fixed pause between
 *   jobs here, because the bucket is what paces them. A pass renews its lease
 *   before every claim and stops claiming the moment a renewal fails, because
 *   that means another pass now holds it.
 */

type Admin = SupabaseClient<Database>;
export type LeagueSyncJob = Database["public"]["Tables"]["league_sync_jobs"]["Row"];

// The wire shapes live in a client-safe module so a browser bundle can import
// them without dragging this file's Sleeper and service-role chain along.
export {
  BULK_SYNC_COOLDOWN_SECONDS,
  IDLE_BULK_SYNC_STATE,
  type BulkSyncState,
  type LeagueSyncJobStatus,
};

/**
 * Tries per league before it is left failed for the reader to retry by hand.
 *
 * This is the CODE FALLBACK only, used inside the settings read: the live
 * value is `manager_pulse_settings.capture.jobMaxAttempts`, admin-edited at
 * /admin/manager-pulse, and it governs Manager Pulse footprint jobs and Sync
 * all bulk-sync jobs alike, because both job kinds are drained from this same
 * league_sync_jobs queue by this same worker. `loadManagerPulseSettings`
 * itself never throws (it already falls back to
 * DEFAULT_MANAGER_PULSE_SETTINGS on a missing row or a query error), so this
 * constant exists only as a belt-and-braces literal beside that one read.
 */
const MAX_ATTEMPTS = 3;

/* -------------------------------------------------------------------------- */
/* Enqueue                                                                    */
/* -------------------------------------------------------------------------- */

export type EnqueueResult =
  | { ok: true; requestId: string; queued: number; nextAllowedAt: string }
  | {
      ok: false;
      reason: "cooldown" | "already_queued" | "no_leagues" | "no_user" | "error";
      retryInSeconds?: number;
      nextAllowedAt?: string | null;
      message: string;
    };

type RpcEnqueueResult = {
  claimed?: boolean;
  reason?: string;
  request_id?: string;
  queued?: number;
  retry_after_seconds?: number;
  next_allowed_at?: string;
};

/**
 * Claim this user's twelve-hour slot and queue one job per league, atomically.
 *
 * The league list is the caller's responsibility to derive from Sleeper for THIS
 * user. It is never read from a request body: a caller who names their own
 * leagues could queue work against anyone's.
 */
export async function enqueueBulkLeagueSync(
  admin: Admin,
  userId: string,
  leagues: Array<{ sleeperLeagueId: string; leagueName: string | null }>,
): Promise<EnqueueResult> {
  const payload = leagues
    .filter((l) => l.sleeperLeagueId)
    .map((l) => ({
      sleeper_league_id: l.sleeperLeagueId,
      league_name: l.leagueName ?? "",
    }));

  const { data, error } = await admin.rpc("enqueue_bulk_league_sync", {
    p_user_id: userId,
    p_leagues: payload,
    p_cooldown_seconds: BULK_SYNC_COOLDOWN_SECONDS,
  });

  if (error) {
    console.error("[league-bulk-sync] enqueue rpc failed", error);
    return {
      ok: false,
      reason: "error",
      message: "We could not start that sync. Try again shortly.",
    };
  }

  const result = (data ?? {}) as RpcEnqueueResult;
  if (result.claimed === true && result.request_id) {
    return {
      ok: true,
      requestId: result.request_id,
      queued: result.queued ?? payload.length,
      nextAllowedAt: result.next_allowed_at ?? "",
    };
  }

  switch (result.reason) {
    case "cooldown":
      return {
        ok: false,
        reason: "cooldown",
        retryInSeconds: result.retry_after_seconds,
        nextAllowedAt: result.next_allowed_at ?? null,
        message: "Sync all runs once every 12 hours.",
      };
    case "already_queued":
      return {
        ok: false,
        reason: "already_queued",
        message: "Those leagues are already in the queue.",
      };
    case "no_leagues":
      return {
        ok: false,
        reason: "no_leagues",
        message: "We found no leagues to sync.",
      };
    default:
      return {
        ok: false,
        reason: "error",
        message: "We could not start that sync. Try again shortly.",
      };
  }
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The newest request and how far it got.
 *
 * Reads through whichever client is passed, which on the dashboard is the
 * reader's own session client: the owner-select policies exist so this needs no
 * service role to answer a question about the reader's own request.
 *
 * Only the newest request is reported. Older ones are history, and the reader's
 * question is always "is the thing I just pressed still going".
 */
export async function loadBulkSyncState(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<BulkSyncState> {
  const { data: request, error: requestErr } = await supabase
    .from("league_bulk_sync_requests")
    // completed_at is deliberately not read: whether a batch is still running is
    // derived from the job rows, which is the same answer one write earlier.
    .select("id, requested_at, league_count")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (requestErr || !request) return IDLE_BULK_SYNC_STATE;

  const { data: jobs } = await supabase
    .from("league_sync_jobs")
    .select("sleeper_league_id, status")
    .eq("request_id", request.id);

  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  const jobStatuses: Record<string, LeagueSyncJobStatus> = {};
  for (const job of jobs ?? []) {
    const status = job.status as LeagueSyncJobStatus;
    jobStatuses[job.sleeper_league_id] = status;
    if (status in counts) counts[status as keyof typeof counts] += 1;
  }

  const readyAtMs =
    new Date(request.requested_at).getTime() + BULK_SYNC_COOLDOWN_SECONDS * 1000;
  const cooling = Date.now() < readyAtMs;

  return {
    requestId: request.id,
    active: counts.pending > 0 || counts.processing > 0,
    total: jobs?.length ?? request.league_count,
    ...counts,
    requestedAt: request.requested_at,
    nextAllowedAt: cooling ? new Date(readyAtMs).toISOString() : null,
    canStart: !cooling,
    jobStatuses,
  };
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

export type WorkerSummary = {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  reaped: number;
  released: number;
  requestsCompleted: number;
  finalized: number;
  liveReports: number;
  callsMade: number;
};

type JobOutcome = { ok: true; skipped?: "fresh" } | { ok: false; error: string };

/**
 * Send a job back to pending with a backoff, or mark it failed once it has had
 * its tries.
 *
 * Every transition is guarded on the status the job was in, so a run that took
 * longer than the stale window cannot overwrite the decision another run has
 * already made about the same job.
 *
 * `outcomeMeta` (call count, duration) is recorded only on the TERMINAL
 * (`failed`) update. A job going back to `pending` is not finished, so there is
 * nothing yet to report about how it finally settled.
 */
async function failOrRetry(
  admin: Admin,
  job: LeagueSyncJob,
  message: string,
  maxAttempts: number,
  outcomeMeta?: { calls: number; durationMs: number },
  staleBefore?: string,
): Promise<"retry" | "failed" | "lost"> {
  const attempts = job.attempts + 1;
  const now = new Date().toISOString();
  const terminal = attempts >= maxAttempts;

  let q = admin
    .from("league_sync_jobs")
    .update(
      terminal
        ? {
            status: "failed",
            attempts,
            last_error: message,
            updated_at: now,
            finished_at: now,
            ...(outcomeMeta
              ? { sleeper_calls: outcomeMeta.calls, duration_ms: outcomeMeta.durationMs }
              : {}),
          }
        : {
            status: "pending",
            attempts,
            last_error: message,
            // 30s, then a minute, then two. A Sleeper wobble clears inside that;
            // a league that is genuinely gone burns its three tries and stops.
            run_after: new Date(
              Date.now() + 30_000 * 2 ** (attempts - 1),
            ).toISOString(),
            updated_at: now,
          },
    )
    .eq("id", job.id)
    .eq("status", "processing");
  if (staleBefore) q = q.lt("updated_at", staleBefore);

  const { data: won } = await q.select("id");
  if (!won || won.length === 0) return "lost";
  return terminal ? "failed" : "retry";
}

/**
 * Reclaim jobs a dead worker left in 'processing'. The claim RPC stamps
 * updated_at on the way in, so anything still processing past the window had no
 * run finish it. Routing them through the normal backoff (rather than straight
 * back to pending) is what stops a job that reliably kills its worker from
 * looping forever.
 */
async function reapStaleJobs(
  admin: Admin,
  summary: WorkerSummary,
  touched: Set<string>,
  maxAttempts: number,
  staleWindowMs: number,
): Promise<void> {
  const cutoff = new Date(Date.now() - staleWindowMs).toISOString();
  const { data: stale } = await admin
    .from("league_sync_jobs")
    .select("*")
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(100);

  for (const job of stale ?? []) {
    const outcome = await failOrRetry(
      admin,
      job,
      "reclaimed after a stalled sync (worker crash or timeout)",
      maxAttempts,
      undefined,
      cutoff,
    );
    if (outcome === "lost") continue;
    // A job now has one of two owners (migration 0256): a Sync all request
    // (request_id) or a Manager Pulse run (manager_run_id). Only the former
    // needs the bulk-request bookkeeping this set feeds; a Manager Pulse
    // job's owning run is closed out separately below.
    if (job.request_id) touched.add(job.request_id);
    summary.reaped += 1;
    if (outcome === "failed") {
      summary.failed += 1;
      // The real cause is logged by the reaper; the reader is told the shape of
      // the problem, not our internals.
      await closeManagerPulseRunLeagues(admin, job, "failed", "stalled");
    } else {
      summary.retried += 1;
    }
  }
}

/**
 * Close out a Manager Pulse run's bookkeeping for one finished job.
 *
 * `job.manager_run_id` is null for a Sync all job, so this returns
 * immediately with no query for the common case. When it IS set, every
 * `manager_pulse_run_leagues` row pointing at this job is updated: there can
 * be more than one, because `enqueue_manager_pulse_capture` LINKS a run to an
 * already in-flight job for the same user and league rather than duplicating
 * it (migration 0257), so more than one run can be waiting on the same job.
 *
 * Returns the set of run ids this job's rows belonged to, so a caller in the
 * job loop (settleJob) can fold them into `runsTouched` and check whether any
 * of them just crossed the first live-report checkpoint.
 */
/**
 * The fixed set of reasons a league-season can fail, and nothing else.
 *
 * `manager_pulse_run_leagues` is owner-readable, so whatever lands in `detail`
 * is readable by the person who asked for the report, straight out of
 * PostgREST. Passing a raw sync error through would make that column a channel
 * for whatever text a future failure path happens to produce, which is exactly
 * how an internal message ends up in front of a reader. Same reasoning as
 * `power_pulse_detail` and `positional_war_detail` elsewhere.
 */
type RunLeagueFailureReason = "sync_failed" | "stalled";

const RUN_LEAGUE_FAILURE_TEXT: Record<RunLeagueFailureReason, string> = {
  sync_failed: "This league could not be read from Sleeper.",
  stalled: "This league's sync stopped partway and was not retried.",
};

async function closeManagerPulseRunLeagues(
  admin: Admin,
  job: LeagueSyncJob,
  status: "done" | "failed",
  reason?: RunLeagueFailureReason,
): Promise<Set<string>> {
  if (!job.manager_run_id) return new Set();

  const now = new Date().toISOString();
  const { data: rows, error: updErr } = await admin
    .from("manager_pulse_run_leagues")
    .update({
      status,
      detail:
        status === "failed"
          ? RUN_LEAGUE_FAILURE_TEXT[reason ?? "sync_failed"]
          : null,
      updated_at: now,
    })
    .eq("job_id", job.id)
    .select("run_id");
  if (updErr) {
    console.warn(
      `[league-sync-worker] could not close manager_pulse_run_leagues for job ${job.id}: ${updErr.message}`,
    );
    return new Set();
  }

  const runIds = new Set((rows ?? []).map((r) => r.run_id));
  for (const runId of runIds) {
    await recountManagerPulseRun(admin, runId);
  }
  return runIds;
}

/**
 * Recount one Manager Pulse run's progress from its own league rows, and move
 * it from 'capturing' to 'computing' once nothing is left in ('pending',
 * 'queued').
 *
 * A RECOUNT, never an increment: this worker retries jobs through
 * failOrRetry's backoff, and an increment applied twice would double-count a
 * league the run had already been told about.
 */
async function recountManagerPulseRun(admin: Admin, runId: string): Promise<void> {
  const { data: rows, error } = await admin
    .from("manager_pulse_run_leagues")
    .select("status")
    .eq("run_id", runId);
  if (error || !rows) {
    console.warn(
      `[league-sync-worker] could not recount manager_pulse_run ${runId}: ${error?.message ?? "no rows"}`,
    );
    return;
  }

  const leaguesDone = rows.filter((r) => r.status === "fresh" || r.status === "done").length;
  const leaguesFailed = rows.filter((r) => r.status === "failed").length;
  const stillWorking = rows.some((r) => r.status === "pending" || r.status === "queued");

  const now = new Date().toISOString();
  await admin
    .from("manager_pulse_runs")
    .update({ leagues_done: leaguesDone, leagues_failed: leaguesFailed, updated_at: now })
    .eq("id", runId);

  if (!stillWorking) {
    // Guarded on the run still being 'capturing' so a job that closes out
    // late can never send a run backwards from 'computing', 'complete',
    // 'error' or 'throttled'.
    await admin
      .from("manager_pulse_runs")
      .update({ status: "computing", updated_at: now })
      .eq("id", runId)
      .eq("status", "capturing");
  }
}

/**
 * Run one league, exactly the way opening that league would run it: a full
 * pulse for a 'pulse' job (Sync all), or the lighter footprint capture for a
 * 'footprint' job (Manager Pulse). See lib/league-pulse.ts
 * pulseLeagueFootprint and docs/manager-pulse/manager-pulse-plan.md section 4.4 for why the
 * two differ.
 *
 * Core first so a league Sleeper does not know about fails before any derived
 * work starts. Derived is awaited rather than backgrounded, because the standing
 * the reader is waiting to see is produced there, and a job that returned before
 * its own work finished would report progress it had not made.
 */
async function syncOneLeague(
  admin: Admin,
  job: LeagueSyncJob,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (job.job_kind === "footprint") {
    const result = await pulseLeagueFootprint(admin, job.sleeper_league_id);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }
  const core = await pulseLeagueCore(admin, job.sleeper_league_id);
  if (!core.ok) {
    return { ok: false, error: core.error || "Sleeper did not return that league" };
  }
  await pulseLeagueDerived(admin, core.leagueRowId, { resynced: !core.cached });
  return { ok: true };
}

/**
 * Run one job, applying the footprint job's run-time freshness re-check first
 * (MPS-T035): a league that went fresh while its job waited in the queue
 * settles as `done` with no Sleeper call at all, rather than re-syncing a
 * league nothing has changed about since it was queued.
 *
 * `currentSeason` is computed ONCE per pass by the caller
 * (`Number(currentNflSeason())`) and threaded through, since
 * `managerPulseNeedsCapture` is a pure function of its arguments and must not
 * read the clock itself.
 *
 * Never throws: syncOneLeague's own throw is caught here and reported as a
 * normal failed outcome, matching the retry/backoff path every other failure
 * takes.
 */
async function runOneJob(
  admin: Admin,
  job: LeagueSyncJob,
  settings: ManagerPulseSettings,
  currentSeason: number,
): Promise<JobOutcome> {
  try {
    if (job.job_kind === "footprint") {
      const { data: league } = await admin
        .from("leagues")
        .select("capture_completed_at, status, season")
        .eq("sleeper_league_id", job.sleeper_league_id)
        .maybeSingle();
      if (league && !managerPulseNeedsCapture(league, settings, Date.now(), currentSeason)) {
        return { ok: true, skipped: "fresh" };
      }
    }
    return await syncOneLeague(admin, job);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "the sync threw" };
  }
}

/**
 * Whether a run just crossed its FIRST live-report checkpoint, and if so,
 * compute it right after the batch that crossed it, so the reader watching
 * the progress bar sees something better than a bare count as soon as it is
 * available rather than waiting for a later checkpoint sweep. Only the
 * first checkpoint is handled here; repeat ones go through
 * `liveReportCheckpoints`.
 */
async function maybeComputeFirstLiveReport(
  admin: Admin,
  runId: string,
  settings: ManagerPulseSettings,
  summary: WorkerSummary,
): Promise<void> {
  const { data: run } = await admin
    .from("manager_pulse_runs")
    .select("leagues_done, live_checkpoint_done")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return;
  if (run.leagues_done >= settings.sync.liveReportFirstAfter && run.live_checkpoint_done === 0) {
    await computeLiveReport(admin, runId, settings);
    summary.liveReports += 1;
  }
}

/**
 * Settle one job's outcome: write the terminal `done` state, or run it
 * through the retry/backoff ladder toward a terminal `failed` state.
 *
 * `sleeper_calls` and `duration_ms` are written on both terminal updates
 * (`done` and `failed`), never on a `pending` retry, since a job that is going
 * around again has not finished settling yet.
 *
 * `closeManagerPulseRunLeagues` is only called from the two terminal
 * branches, and every run id it returns is folded into `runsTouched` (for the
 * repeat live-report sweep) and `firstCheckpointCandidates` (for the first
 * one). Neither checkpoint is computed HERE: this runs inside `mapLimit`, so
 * awaiting a compute in this function would occupy one of
 * `sync.jobConcurrency` job slots for the compute's whole duration. The
 * caller reads `firstCheckpointCandidates` after `mapLimit` returns, outside
 * any concurrency slot.
 */
async function settleJob(
  admin: Admin,
  job: LeagueSyncJob,
  outcome: JobOutcome,
  calls: number,
  durationMs: number,
  settings: ManagerPulseSettings,
  summary: WorkerSummary,
  runsTouched: Set<string>,
  firstCheckpointCandidates: Set<string>,
): Promise<void> {
  const maxAttempts = settings.capture.jobMaxAttempts ?? MAX_ATTEMPTS;

  if (outcome.ok) {
    const now = new Date().toISOString();
    await admin
      .from("league_sync_jobs")
      .update({
        status: "done",
        last_error: null,
        sleeper_calls: calls,
        duration_ms: durationMs,
        updated_at: now,
        finished_at: now,
      })
      .eq("id", job.id)
      .eq("status", "processing");
    summary.done += 1;
    const runIds = await closeManagerPulseRunLeagues(admin, job, "done");
    for (const runId of runIds) {
      runsTouched.add(runId);
      firstCheckpointCandidates.add(runId);
    }
    return;
  }

  console.warn(
    `[league-sync-worker] ${job.sleeper_league_id} failed: ${outcome.error}`,
  );
  const result = await failOrRetry(admin, job, outcome.error, maxAttempts, { calls, durationMs });
  if (result === "failed") {
    summary.failed += 1;
    // outcome.error is logged above and deliberately NOT written to a
    // reader-visible column. See RUN_LEAGUE_FAILURE_TEXT.
    const runIds = await closeManagerPulseRunLeagues(admin, job, "failed", "sync_failed");
    for (const runId of runIds) {
      runsTouched.add(runId);
      firstCheckpointCandidates.add(runId);
    }
  } else if (result === "retry") {
    summary.retried += 1;
  }
}

/** Send jobs claimed but never reached back to pending, so the next pass picks them up right away. */
async function releaseJobs(admin: Admin, jobs: LeagueSyncJob[], summary: WorkerSummary): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("league_sync_jobs")
    .update({ status: "pending", run_after: now, updated_at: now })
    .in(
      "id",
      jobs.map((j) => j.id),
    )
    .eq("status", "processing");
  summary.released += jobs.length;
}

/**
 * Stamp completed_at on any request whose jobs have all finished, so the page can
 * tell "still going" from "done" without counting rows itself.
 */
async function closeFinishedRequests(
  admin: Admin,
  requestIds: Set<string>,
  summary: WorkerSummary,
): Promise<void> {
  for (const requestId of requestIds) {
    const { count } = await admin
      .from("league_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId)
      .in("status", ["pending", "processing"]);
    if ((count ?? 0) > 0) continue;

    const { data: closed } = await admin
      .from("league_bulk_sync_requests")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", requestId)
      .is("completed_at", null)
      .select("id");
    if (closed && closed.length > 0) summary.requestsCompleted += 1;
  }
}

/**
 * Runs finalized at the HEAD of a pass, before a single job is claimed.
 * Capped small (not the full backlog) because each one is a full
 * `loadManagerPulseInput` (about 15 paged queries over up to
 * `capture.maxLeaguesPerRun` league-seasons) plus `computeFootprint`, run
 * serially, and this work sits in front of the pass's first Sleeper call.
 * Stacking up to `TAIL_FINALIZE_LIMIT` of those here could itself run long
 * enough to let the pass's lease expire before the claim loop's own renewals
 * even begin. The rest of the backlog is finalized at the tail instead,
 * where a slow run only delays cleanup, not every job this pass would have
 * claimed.
 */
const HEAD_FINALIZE_LIMIT = 2;

/** Runs finalized at the tail of a pass, once this pass's own jobs are done. */
const TAIL_FINALIZE_LIMIT = 10;

/**
 * Finalize any Manager Pulse run that finished capturing and is waiting to be
 * built into a report (MPS-T040). Bounded to the oldest `limit` so this never
 * turns into a full-table sweep, and each run is coalesced on its own id so a
 * run cannot be finalized twice by two overlapping passes. Called once at the
 * head of a pass (capped to `HEAD_FINALIZE_LIMIT`) and once at the tail
 * (capped to `TAIL_FINALIZE_LIMIT`), so a big backlog is worked down over
 * several passes rather than blocking the head of any one of them.
 */
async function finalizeComputingRuns(
  admin: Admin,
  settings: ManagerPulseSettings,
  summary: WorkerSummary,
  limit: number,
): Promise<void> {
  const { data: runs } = await admin
    .from("manager_pulse_runs")
    .select("id")
    .eq("status", "computing")
    .is("completed_at", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  for (const run of runs ?? []) {
    await coalesce(`finalize:${run.id}`, () => finalizeManagerPulseRun(admin, run.id, settings));
    summary.finalized += 1;
  }
}

/**
 * The minimum gap, in milliseconds, a run must leave between its last
 * checkpoint and its next one, once it has at least one checkpoint already
 * (`lastCheckpointDone > 0`; the first checkpoint has no such gate and is
 * handled separately by `maybeComputeFirstLiveReport`).
 *
 * This sweep used to run once, after the whole pass's job loop, so a run
 * ever got at most one repeat checkpoint per `passBudgetSeconds` (280s
 * default): far slower than `liveReportEveryLeagues` / `liveReportMinIntervalMs`
 * promise on their own. Moving the sweep inside the claim loop (below) so it
 * runs once per claimed batch fixes that pacing, but only if the gate that
 * decides whether a checkpoint actually fires does not fire on every batch:
 * `shouldComputeLiveReport`'s own gates (>= liveReportEveryLeagues leagues
 * since last time, AND >= liveReportMinIntervalMs elapsed) are satisfied by
 * roughly one checkpoint every liveReportMinIntervalMs once a run is
 * progressing, because leagues complete faster than that fixed interval.
 * For a 250-league run that is on the order of 50 checkpoints
 * (250 / liveReportEveryLeagues), each re-reading everything finished so
 * far: 5 + 10 + ... + 250 league-reads, quadratic in league count and
 * roughly 25x a single full read of the run. That is worse than the bug
 * being fixed.
 *
 * This gate adds a SECOND, GROWING requirement on top of (never looser than)
 * `shouldComputeLiveReport`'s own: the required gap since the last
 * checkpoint scales with how much the last checkpoint already covered, so a
 * small run still checkpoints close to every `liveReportMinIntervalMs` (a
 * reader on an empty page benefits most from an early update), while a large
 * one spaces its later checkpoints out (a checkpoint near the end costs
 * nearly as much as the real thing and moves the number on screen the
 * least). Modeled at a roughly constant per-league processing rate implied
 * by the 250-league / ~19-minute case in section 4.4, this produces
 * checkpoints at roughly 3, 10, 23, 48, 94 and 180 leagues covered: about 6
 * checkpoints, whose costs sum to roughly 360 league-reads, about 1.4x a
 * single full read of the run, better than today's own worst case (roughly
 * 5x, via the once-per-pass bug) and far below the roughly 25x a naive fix
 * would cost.
 */
function checkpointGapMs(lastCheckpointDone: number, sync: ManagerPulseSyncSettings): number {
  return sync.liveReportMinIntervalMs * (1 + lastCheckpointDone / sync.liveReportEveryLeagues);
}

/**
 * The repeat live-report sweep (MPS-T041). Runs once per claimed batch
 * (inside the claim loop) and once more after the loop ends, for every run
 * touched so far this pass: read its checkpoint state and compute a fresh
 * live report when it is due. Only a run still `capturing` is eligible: a
 * run that has moved on to `computing` is about to be finalized into the
 * real report, and a live report is read by the progress panel only.
 *
 * `checkpointGapMs` is checked first, cheaply, off the row already read: it
 * can only make a checkpoint LESS likely than `shouldComputeLiveReport`
 * alone would, so it never re-introduces the once-per-pass bug this
 * replaces, only defends against firing too often instead.
 */
async function liveReportCheckpoints(
  admin: Admin,
  settings: ManagerPulseSettings,
  runsTouched: Set<string>,
  summary: WorkerSummary,
): Promise<void> {
  for (const runId of runsTouched) {
    const { data: run } = await admin
      .from("manager_pulse_runs")
      .select("status, leagues_done, live_checkpoint_done, live_checkpoint_at")
      .eq("id", runId)
      .maybeSingle();
    if (!run || run.status !== "capturing") continue;
    if (run.live_checkpoint_done > 0 && run.live_checkpoint_at) {
      const gap = checkpointGapMs(run.live_checkpoint_done, settings.sync);
      if (Date.now() - Date.parse(run.live_checkpoint_at) < gap) continue;
    }
    const due = shouldComputeLiveReport({
      leaguesDone: run.leagues_done,
      lastCheckpointDone: run.live_checkpoint_done,
      lastCheckpointAt: run.live_checkpoint_at,
      nowMs: Date.now(),
      sync: settings.sync,
    });
    if (due) {
      await computeLiveReport(admin, runId, settings);
      summary.liveReports += 1;
    }
  }
}

/** Renew (or first-acquire) this pass's lease. False means another pass now holds it. */
async function renewLease(admin: Admin, holder: string, seconds: number): Promise<boolean> {
  const { data } = await admin.rpc("try_acquire_league_sync_lease", {
    p_holder: holder,
    p_seconds: seconds,
  });
  return data === true;
}

/**
 * One pass of the queue. `renewLease` runs before every claim, `options.holder`
 * naming this pass: its first call also serves as the acquire when nobody
 * holds the lease yet, and every call after that is a genuine renewal. Claiming
 * stops the moment a renewal fails, because that means some other pass now
 * holds it. Exactly one pass drains the queue at a time (see the module doc
 * comment); the caller is responsible for releasing the lease after this
 * returns (the cron route also pre-checks the lease itself, so a held lease
 * can be reported without ever starting a pass).
 */
export async function runLeagueSyncWorker(
  admin: Admin,
  options: { holder: string },
): Promise<WorkerSummary> {
  const settings = await loadManagerPulseSettings(admin); // never throws
  const sync = settings.sync;
  configureSleeperBudget(sync.sleeperCallsPerMinute);
  const summary: WorkerSummary = {
    claimed: 0,
    done: 0,
    retried: 0,
    failed: 0,
    reaped: 0,
    released: 0,
    requestsCompleted: 0,
    finalized: 0,
    liveReports: 0,
    callsMade: 0,
  };
  const deadline = Date.now() + sync.passBudgetSeconds * 1000;
  const leaseSeconds = sync.passBudgetSeconds + 30;
  const touched = new Set<string>();
  const runsTouched = new Set<string>();
  let calls = 0;

  // Computed once per pass, not once per job: managerPulseNeedsCapture is a
  // pure function and must not read the clock itself.
  const currentSeason = Number(currentNflSeason());
  const maxAttempts = settings.capture.jobMaxAttempts ?? MAX_ATTEMPTS;

  await reapStaleJobs(admin, summary, touched, maxAttempts, sync.staleProcessingMinutes * 60_000);
  await finalizeComputingRuns(admin, settings, summary, HEAD_FINALIZE_LIMIT); // T040, capped

  // Top off the lease right after the head-of-pass work above. That work
  // renews nothing on its own, and if it ran long enough, the claim loop's
  // OWN first renewal (below) might never even execute: the deadline check
  // that guards the loop could already have tripped, in which case a lease
  // acquired once at the top of this pass would otherwise sit unrenewed
  // until this function returns.
  await renewLease(admin, options.holder, leaseSeconds);

  while (Date.now() < deadline && calls < sync.maxCallsPerPass) {
    const renewed = await renewLease(admin, options.holder, leaseSeconds);
    if (!renewed) break; // somebody else holds it now
    const { data: claimed, error } = await admin.rpc("claim_league_sync_jobs", {
      p_limit: sync.jobsPerClaim,
    });
    if (error || !claimed || claimed.length === 0) break;
    const jobs = claimed as LeagueSyncJob[];
    summary.claimed += jobs.length;

    const leftover: LeagueSyncJob[] = [];
    const firstCheckpointCandidates = new Set<string>();
    await mapLimit(jobs, sync.jobConcurrency, async (job) => {
      if (Date.now() >= deadline || calls >= sync.maxCallsPerPass) {
        leftover.push(job);
        return;
      }
      // See the comment in reapStaleJobs: a job carries request_id OR
      // manager_run_id, never both. closeFinishedRequests only knows about
      // request_id owners.
      if (job.request_id) touched.add(job.request_id);
      const startedAt = Date.now();
      const { result: outcome, calls: jobCalls } = await countSleeperCalls(() =>
        runOneJob(admin, job, settings, currentSeason),
      );
      calls += jobCalls;
      summary.callsMade += jobCalls;
      await settleJob(
        admin,
        job,
        outcome,
        jobCalls,
        Date.now() - startedAt,
        settings,
        summary,
        runsTouched,
        firstCheckpointCandidates,
      );
    });
    if (leftover.length > 0) await releaseJobs(admin, leftover, summary);

    // The first live-report checkpoint runs here, OUTSIDE mapLimit's own
    // concurrency slots, rather than awaited inside settleJob: computing one
    // is a full loadManagerPulseInput plus computeFootprint, and awaiting
    // that inside the mapLimit body would occupy one of sync.jobConcurrency
    // slots for its whole duration.
    if (firstCheckpointCandidates.size > 0) {
      await renewLease(admin, options.holder, leaseSeconds);
      for (const runId of firstCheckpointCandidates) {
        await maybeComputeFirstLiveReport(admin, runId, settings, summary);
      }
    }

    // Repeat checkpoints (MPS-T041) run once per claimed batch instead of
    // once per pass, so a long pass gets more than one live update. See
    // checkpointGapMs for why this cannot become the quadratic it looks
    // like.
    await liveReportCheckpoints(admin, settings, runsTouched, summary);
  }

  await closeFinishedRequests(admin, touched, summary);
  // A final sweep for anything the in-loop calls above did not already
  // catch (for example a run only touched by work before the loop started).
  await liveReportCheckpoints(admin, settings, runsTouched, summary); // T041
  await renewLease(admin, options.holder, leaseSeconds);
  await finalizeComputingRuns(admin, settings, summary, TAIL_FINALIZE_LIMIT);
  return summary;
}
