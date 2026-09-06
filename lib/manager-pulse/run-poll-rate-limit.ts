import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The rate limit shared by both Manager Pulse run routes:
 * app/api/manager-pulse/runs/[run_id]/route.ts (progress) and
 * app/api/manager-pulse/runs/[run_id]/report/route.ts (report). Neither had a
 * limit at all; a signed-in reader looping the progress route multiplies each
 * HTTP request into a run read, a run-leagues read, a jobs read over up to 200
 * ids, a count query, a settings read, and potentially two bulk writes from
 * reconcileFinishedJobs. With maxLeaguesPerRun defaulting to 250, that adds up.
 *
 * ONE BUCKET FOR BOTH ROUTES. The client-side poller hits progress on every
 * tick and report whenever the version moves, so metering them separately
 * would let a caller alternate between the two and spend two budgets for what
 * is really one open panel.
 *
 * SIZED AROUND THE POLLER'S OWN CADENCE, NOT A FIXED NUMBER. `sync.pollIntervalMs`
 * (manager_pulse_settings, admin-editable from 1000ms to 30000ms, 2000ms by
 * default) is the interval the client poller actually uses. At the default,
 * one open panel makes roughly 30 requests a minute across the pair. The
 * bucket size is HEADROOM_MULTIPLIER (4) times that cadence, floored at
 * MIN_BUCKET_MAX (120) so a slow admin-configured interval never produces an
 * unusably tight limit. That leaves real headroom for a reader with more than
 * one tab open, while a script polling far faster than any poller would still
 * reaches it quickly.
 *
 * FAILS OPEN, the opposite polarity from lib/rate-limit-claim.ts. Both routes
 * serve an already-open progress panel or a report a reader is actively
 * waiting on; a limiter outage must not turn every open panel into an error,
 * so a failure to EVALUATE the limit (a database error, a thrown exception) is
 * read as "allow". An explicit over-budget answer from the database still
 * denies, same as everywhere else.
 *
 * CLAIMED AFTER VALIDATION AND OWNERSHIP, per the standing rule: both routes
 * claim a slot only once the run id has been validated as a uuid and the run
 * row's user_id has been checked against the signed-in session, so a stale
 * link or a forged id costs a reader nothing.
 *
 * The actor is the caller's own session user id, already resolved by the
 * route before this is called (both routes 401 a signed-out caller before
 * reaching here), so it is passed in rather than re-derived.
 */

const MANAGER_PULSE_RUN_POLL_BUCKET = "manager-pulse-run-poll";
const MANAGER_PULSE_RUN_POLL_WINDOW_SECONDS = 60;

/** Headroom over the poller's own cadence before the bucket denies a request. */
const HEADROOM_MULTIPLIER = 4;

/** Floor for the bucket, so a slow admin-configured pollIntervalMs (up to 30s)
 * never produces a limit tighter than a normal reader with a couple of tabs
 * open could reach. */
const MIN_BUCKET_MAX = 120;

/** The bucket size for one minute, derived from the configured poll interval. */
export function managerPulseRunPollMax(pollIntervalMs: number): number {
  const perMinuteAtCadence = Math.ceil(60_000 / Math.max(250, pollIntervalMs));
  return Math.max(MIN_BUCKET_MAX, perMinuteAtCadence * HEADROOM_MULTIPLIER);
}

/**
 * Claim one slot for a signed-in user's run poll (progress or report).
 * `userId` is the session's own user id, already resolved by the caller.
 * `pollIntervalMs` is the currently configured sync.pollIntervalMs.
 *
 * Fails OPEN on any error evaluating the limit (see module header). Returns
 * false only on an explicit over-budget answer from the database.
 */
export async function claimManagerPulseRunPollSlot(
  userId: string,
  pollIntervalMs: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("try_claim_rate_limit", {
      p_bucket: MANAGER_PULSE_RUN_POLL_BUCKET,
      p_key: `user:${userId}`,
      p_max_requests: managerPulseRunPollMax(pollIntervalMs),
      p_window_seconds: MANAGER_PULSE_RUN_POLL_WINDOW_SECONDS,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[manager-pulse] run poll rate limit check failed, allowing the request", err);
    return true;
  }
}
