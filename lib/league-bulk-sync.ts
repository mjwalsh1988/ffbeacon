import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import {
  BULK_SYNC_COOLDOWN_SECONDS,
  IDLE_BULK_SYNC_STATE,
  type BulkSyncState,
  type LeagueSyncJobStatus,
} from "@/lib/league-bulk-sync-types";

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
 * Leagues a single worker run will take.
 *
 * Five is what the budget below can finish in the bad case: a cold league sync
 * is commonly five to fifteen seconds, plus the pace between them. A run that
 * claims more than it reaches releases the rest, so overshooting costs a little
 * churn rather than a stalled queue, and a batch of already-fresh leagues (each
 * one indexed read, no Sleeper traffic) clears all five in seconds.
 *
 * On the one-minute schedule that settles at four or five leagues a minute:
 * around 200 Sleeper calls a minute at the very worst, against guidance of a
 * thousand.
 */
const MAX_JOBS_PER_RUN = 5;

/** Breather between leagues inside one run, so a run is a trickle, not a burst. */
const PACE_MS = 2_500;

/**
 * Soft wall clock for a run. Well under the route's maxDuration, and under the
 * one-minute cadence so runs do not stack up on each other.
 */
const RUN_BUDGET_MS = 50_000;

/** Tries per league before it is left failed for the reader to retry by hand. */
const MAX_ATTEMPTS = 3;

/** A job still 'processing' after this had no worker finish it. */
const STALE_PROCESSING_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
};

/**
 * Send a job back to pending with a backoff, or mark it failed once it has had
 * its tries.
 *
 * Every transition is guarded on the status the job was in, so a run that took
 * longer than the stale window cannot overwrite the decision another run has
 * already made about the same job.
 */
async function failOrRetry(
  admin: Admin,
  job: LeagueSyncJob,
  message: string,
  staleBefore?: string,
): Promise<"retry" | "failed" | "lost"> {
  const attempts = job.attempts + 1;
  const now = new Date().toISOString();
  const terminal = attempts >= MAX_ATTEMPTS;

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
): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
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
      cutoff,
    );
    if (outcome === "lost") continue;
    touched.add(job.request_id);
    summary.reaped += 1;
    if (outcome === "failed") summary.failed += 1;
    else summary.retried += 1;
  }
}

/**
 * Run one league, exactly the way opening that league would run it.
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
  const core = await pulseLeagueCore(admin, job.sleeper_league_id);
  if (!core.ok) {
    return { ok: false, error: core.error || "Sleeper did not return that league" };
  }
  await pulseLeagueDerived(admin, core.leagueRowId, { resynced: !core.cached });
  return { ok: true };
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
 * One pass of the queue. Safe to call concurrently with itself: the claim is
 * atomic and every transition is guarded, so two overlapping runs take different
 * jobs rather than the same ones twice.
 */
export async function runLeagueSyncWorker(admin: Admin): Promise<WorkerSummary> {
  const summary: WorkerSummary = {
    claimed: 0,
    done: 0,
    retried: 0,
    failed: 0,
    reaped: 0,
    released: 0,
    requestsCompleted: 0,
  };
  const deadline = Date.now() + RUN_BUDGET_MS;
  const touched = new Set<string>();

  await reapStaleJobs(admin, summary, touched);

  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_league_sync_jobs",
    { p_limit: MAX_JOBS_PER_RUN },
  );
  if (claimErr) {
    console.error("[league-sync-worker] claim failed", claimErr);
    await closeFinishedRequests(admin, touched, summary);
    return summary;
  }

  const jobs = (claimed ?? []) as LeagueSyncJob[];
  summary.claimed = jobs.length;

  let i = 0;
  for (; i < jobs.length; i++) {
    if (Date.now() >= deadline) break;
    const job = jobs[i];
    touched.add(job.request_id);

    // Pace between leagues, never before the first, and never past the deadline.
    if (i > 0) {
      const wait = Math.min(PACE_MS, deadline - Date.now());
      if (wait > 0) await sleep(wait);
      if (Date.now() >= deadline) break;
    }

    let outcome: { ok: true } | { ok: false; error: string };
    try {
      outcome = await syncOneLeague(admin, job);
    } catch (err) {
      outcome = {
        ok: false,
        error: err instanceof Error ? err.message : "the sync threw",
      };
    }

    if (outcome.ok) {
      const now = new Date().toISOString();
      await admin
        .from("league_sync_jobs")
        .update({
          status: "done",
          last_error: null,
          updated_at: now,
          finished_at: now,
        })
        .eq("id", job.id)
        .eq("status", "processing");
      summary.done += 1;
    } else {
      console.warn(
        `[league-sync-worker] ${job.sleeper_league_id} failed: ${outcome.error}`,
      );
      const result = await failOrRetry(admin, job, outcome.error);
      if (result === "failed") summary.failed += 1;
      else if (result === "retry") summary.retried += 1;
    }
  }

  // Jobs we claimed but never reached go straight back to pending, so the next
  // run picks them up in a minute rather than waiting out the stale window.
  const leftover = jobs.slice(i);
  if (leftover.length > 0) {
    const now = new Date().toISOString();
    await admin
      .from("league_sync_jobs")
      .update({ status: "pending", run_after: now, updated_at: now })
      .in(
        "id",
        leftover.map((j) => j.id),
      )
      .eq("status", "processing");
    summary.released = leftover.length;
  }

  await closeFinishedRequests(admin, touched, summary);
  return summary;
}
