/**
 * Manager Pulse: the only module that queues league captures.
 *
 * docs/manager-pulse/manager-pulse-plan.md sections 3.1, 4.1-4.5 and 9.
 *
 * ORDER OF OPERATIONS, AND IT MATTERS (section 9's "validate before claiming
 * anything" rule, the same one Trade Ideas holds):
 *   1. Validate the handle shape. Invalid returns not_found, no network call,
 *      no rate-limit spend.
 *   2. Resolve the handle against Sleeper. Unknown returns not_found.
 *   3. Claim the lookup rate-limit slot (fails closed).
 *   4. Discover the league-seasons. A season Sleeper never answered for
 *      returns error, before anything is claimed. None found returns empty.
 *   5. Decide needs_capture per league-season from one batched read of
 *      leagues.capture_completed_at / status / season, via
 *      lib/manager-pulse/freshness.ts. A league we hold no row for always
 *      needs capture; never guessed.
 *   6. Claim the run via try_claim_manager_pulse, spending the count of
 *      league-seasons that need capture against a rolling-hour budget. A
 *      budget reply returns throttled with the retry window and the used and
 *      total figures; a resumed reply (an open run for this exact reader,
 *      subject and window already exists) skips straight to reading its
 *      progress rather than enqueueing anything new.
 *   7. Call enqueue_manager_pulse_capture with the league list, for a fresh
 *      claim only, then wake the sync worker so it drains without waiting
 *      for the next cron tick.
 *
 * A stale link must not burn a reader's rate-limit budget, and garbage input
 * must gain an attacker nothing: that is why validation runs before the
 * Sleeper call and the Sleeper call runs before the rate-limit claim.
 *
 * BOTH RPCS ARE SERVICE-ROLE ONLY (migrations 0257 and 0265: SECURITY
 * DEFINER, revoked from public/anon/authenticated by name, granted to
 * service_role only), so `admin` here must be the service-role client, never
 * a session-scoped one.
 */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { currentNflSeason } from "@/lib/sleeper";
import { wakeLeagueSyncWorker } from "@/lib/league-sync-wake";
import { discoverLeagueSeasons, isValidSleeperHandle, resolveManagerHandle } from "./discover";
import { managerPulseNeedsCapture, type LeagueCaptureState } from "./freshness";
import { claimManagerLookupSlot } from "./rate-limit";
import { loadManagerPulseSettings } from "./settings";
import type { CaptureProgress, ManagerPulseSettings } from "./types";

export type CaptureOutcome =
  | { status: "started"; runId: string; progress: CaptureProgress }
  | { status: "warm"; runId: string; progress: CaptureProgress }
  | {
      status: "throttled";
      retryAfterSeconds: number;
      budgetUsed?: number;
      budgetTotal?: number;
    }
  | { status: "not_found" }
  | { status: "empty" }
  | { status: "error"; detail: string };

type TryClaimManagerPulseResult = {
  claimed?: boolean;
  run_id?: string;
  resumed?: boolean;
  reason?: string;
  retry_after_seconds?: number;
  budget_used?: number;
  budget_total?: number;
};

/**
 * A budget large enough that no real reader can hit it, passed for an admin
 * bypass instead of a special-cased SQL path. Comfortably inside Postgres's
 * int4 range so the RPC argument never overflows.
 */
const UNRESTRICTED_LEAGUE_BUDGET = 1_000_000_000;

const BUDGET_WINDOW_SECONDS = 3600;

/** Clamp a requested season window into the settings-declared bounds, defaulting when absent. */
function resolveSeasonWindowSize(seasons: number | undefined, settings: ManagerPulseSettings): number {
  const { seasonWindowDefault, seasonWindowMin, seasonWindowMax } = settings.capture;
  const requested =
    typeof seasons === "number" && Number.isFinite(seasons) ? Math.trunc(seasons) : seasonWindowDefault;
  return Math.min(seasonWindowMax, Math.max(seasonWindowMin, requested));
}

/**
 * Start (or resume, via the fresh-league short-circuit) a capture for one
 * Sleeper handle. Never throws: every failure mode is a member of
 * `CaptureOutcome`.
 */
export async function startManagerCapture(params: {
  admin: SupabaseClient<Database>;
  userId: string;
  handle: string;
  seasons?: number;
  settings: ManagerPulseSettings;
  /**
   * The already-resolved subject, when the caller has one.
   *
   * `getManagerFootprint` resolves the handle itself, because it has to meter
   * that resolution and it needs the Sleeper user id to read the cache before
   * deciding whether to capture at all. Passing the result down means one
   * outbound request per lookup rather than two identical ones.
   */
  resolved?: { sleeperUserId: string; handle: string; avatarUrl: string | null };
  /**
   * Skip the lookup rate limit and the per-user league budget.
   *
   * Set only for a verified admin, and only when
   * `settings.capture.adminBypassThrottle` is on. THROTTLING ONLY: it does not
   * widen `maxLeaguesPerRun`, does not change what a report contains, and does
   * not touch any authorization. Somebody has to be able to run this tool
   * twenty times in an afternoon to know whether it works.
   */
  bypassThrottle?: boolean;
}): Promise<CaptureOutcome> {
  const { admin, userId, handle, seasons, settings } = params;

  // 1. Validate the handle shape. No network call, no rate-limit spend.
  const trimmedHandle = typeof handle === "string" ? handle.trim() : "";
  if (!isValidSleeperHandle(trimmedHandle)) {
    return { status: "not_found" };
  }

  // 2. THE RATE-LIMIT CLAIM COMES BEFORE THE SLEEPER CALL.
  //
  // It used to sit after it, on the reasoning that a handle Sleeper has never
  // heard of should not cost a reader their budget. That reasoning is right
  // about the budget and wrong about the risk: resolving a handle IS the
  // enumerable, outbound, third-party call, so leaving it on the free side of
  // the line meant a signed-in reader could walk a wordlist through
  // /tools/manager-pulse/<candidate> at whatever rate they liked, learning
  // which handles exist and pointing our whole egress at api.sleeper.app while
  // they did it. Shape validation above still runs first, so garbage input is
  // still free; a well-formed guess is not.
  //
  // A caller that has already claimed and already resolved passes `resolved`
  // and is not charged twice.
  if (!params.resolved && !params.bypassThrottle) {
    const lookupClaim = await claimManagerLookupSlot({ admin, userId, settings });
    if (!lookupClaim.ok) {
      return { status: "throttled", retryAfterSeconds: lookupClaim.retryAfterSeconds };
    }
  }

  // 3. Resolve against Sleeper. Unknown handle, same outcome as an invalid one:
  // neither reveals to the caller which case it was.
  const resolved = params.resolved ?? (await resolveManagerHandle(trimmedHandle));
  if (!resolved) {
    return { status: "not_found" };
  }

  const windowSize = resolveSeasonWindowSize(seasons, settings);
  const seasonTo = Number(currentNflSeason());
  const seasonFrom = seasonTo - windowSize + 1;

  // 4. Discover the league-seasons.
  const { leagueSeasons, failedSeasons } = await discoverLeagueSeasons({
    sleeperUserId: resolved.sleeperUserId,
    seasonFrom,
    seasonTo,
    settings,
  });

  // A season Sleeper never answered for is not a season with no leagues.
  // Returning here, before the leagueSeasons.length check and before any
  // claim, means a 429 on one season never gets cached as "this manager has
  // no leagues" and never spends the reader's budget on a report that would
  // be missing a whole season's evidence.
  if (failedSeasons.length > 0) {
    return {
      status: "error",
      detail: `Sleeper did not answer for ${failedSeasons.join(", ")}`,
    };
  }

  if (leagueSeasons.length === 0) {
    return { status: "empty" };
  }

  // 5. Decide needs_capture per league-season from one batched read.
  // A league we hold no row for is never guessed fresh: it always needs capture.
  const sleeperLeagueIds = [...new Set(leagueSeasons.map((ls) => ls.sleeperLeagueId))];
  // Chunked at 200: maxLeaguesPerRun defaults to 250 and the admin ceiling is
  // 500, either of which can hand this a longer list of league ids than one
  // .in() filter should carry.
  const leagueRows: {
    sleeper_league_id: string;
    capture_completed_at: string | null;
    status: string | null;
    season: number;
  }[] = [];
  for (let i = 0; i < sleeperLeagueIds.length; i += 200) {
    const { data } = await admin
      .from("leagues")
      .select("sleeper_league_id, capture_completed_at, status, season")
      .in("sleeper_league_id", sleeperLeagueIds.slice(i, i + 200));
    if (data) leagueRows.push(...data);
  }

  const stateByLeague = new Map<string, LeagueCaptureState>();
  for (const row of leagueRows) {
    stateByLeague.set(row.sleeper_league_id, {
      capture_completed_at: row.capture_completed_at,
      status: row.status,
      season: row.season,
    });
  }

  const nowMs = Date.now();
  // seasonTo is already "the current NFL season" (resolveSeasonWindowSize only
  // moves seasonFrom), so it is reused rather than computed a second time.
  const needsCapture = (sleeperLeagueId: string): boolean =>
    managerPulseNeedsCapture(stateByLeague.get(sleeperLeagueId), settings, nowMs, seasonTo);

  const leaguesRequested = leagueSeasons.reduce(
    (count, ls) => count + (needsCapture(ls.sleeperLeagueId) ? 1 : 0),
    0,
  );

  // 6. Claim the run.
  // No `as never`. The generated types carry both RPC signatures (migrations
  // 0257 and 0265), and casting the name away throws out exactly the argument
  // checking that regenerating them bought.
  const claimRunResult = await admin.rpc("try_claim_manager_pulse", {
    p_user_id: userId,
    p_sleeper_user_id: resolved.sleeperUserId,
    p_sleeper_handle: resolved.handle,
    p_season_from: seasonFrom,
    p_season_to: seasonTo,
    p_leagues_requested: leaguesRequested,
    p_league_budget: params.bypassThrottle
      ? UNRESTRICTED_LEAGUE_BUDGET
      : settings.capture.leaguesPerUserPerHour,
    p_budget_window_seconds: BUDGET_WINDOW_SECONDS,
  });

  if (claimRunResult.error) {
    return { status: "error", detail: claimRunResult.error.message };
  }

  const claimRun = (claimRunResult.data ?? {}) as TryClaimManagerPulseResult;
  if (claimRun.claimed !== true || !claimRun.run_id) {
    if (claimRun.reason === "budget") {
      return {
        status: "throttled",
        retryAfterSeconds: claimRun.retry_after_seconds ?? BUDGET_WINDOW_SECONDS,
        budgetUsed: claimRun.budget_used ?? 0,
        budgetTotal: claimRun.budget_total ?? settings.capture.leaguesPerUserPerHour,
      };
    }
    return { status: "error", detail: `could not open a run (${claimRun.reason ?? "unknown"})` };
  }

  const runId = claimRun.run_id;

  // A RESUMED CLAIM SKIPS THE ENQUEUE ENTIRELY. The RPC found an open run for
  // this exact (user, subject, window) already in flight, so nothing new is
  // being asked of Sleeper: this call just reads where that run stands.
  // `findOpenRun` below exists for the same reason and saves this RPC round
  // trip on every poll-driven render; this is the belt-and-braces path for a
  // caller that claims directly.
  if (claimRun.resumed === true) {
    const progress = await readCaptureProgress(admin, runId, settings);
    if (!progress) {
      return { status: "error", detail: "the run was opened but its progress could not be read" };
    }
    return progress.status === "computing" || progress.status === "complete"
      ? { status: "warm", runId, progress }
      : { status: "started", runId, progress };
  }

  // 7. Enqueue what the run needs.
  const leaguesPayload = leagueSeasons.map((ls) => ({
    sleeper_league_id: ls.sleeperLeagueId,
    season: ls.season,
    league_name: ls.leagueName,
    league_category: ls.category,
    needs_capture: needsCapture(ls.sleeperLeagueId),
  }));

  const enqueueResult = await admin.rpc("enqueue_manager_pulse_capture", {
    p_run_id: runId,
    p_leagues: leaguesPayload,
    p_max_leagues: settings.capture.maxLeaguesPerRun,
  });

  if (enqueueResult.error) {
    // THE RUN IS RELEASED, OR THE READER LOSES AN HOUR TO OUR ERROR.
    //
    // `try_claim_manager_pulse` has already written the run row with
    // `counts_against_cooldown` defaulting true, and only a successful enqueue
    // clears it. Returning here without doing anything would leave a run that
    // queued nothing holding the reader's whole budget, so a transient
    // database error on our side locks them out for an hour. The bulk sync
    // equivalent has always deleted its own request row when it queued nothing
    // (migration 0172); this is the same courtesy.
    //
    // The flag is cleared rather than the row deleted, because the row is also
    // the observability record: an admin looking at /admin/manager-pulse/runs
    // should see that this run happened and failed, not an absence.
    await admin
      .from("manager_pulse_runs")
      .update({
        status: "error",
        detail: "Could not queue this lookup's leagues.",
        counts_against_cooldown: false,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { status: "error", detail: enqueueResult.error.message };
  }

  const progress = await readCaptureProgress(admin, runId, settings);
  if (!progress) {
    return { status: "error", detail: "the run was opened but its progress could not be read" };
  }

  // Wake the sync worker so a fresh queue (or a run that has already moved
  // straight to computing and needs finalizing) drains now rather than
  // waiting for the next cron tick. Never awaited on the request path: a
  // failed wake costs at most one minute, which is what the cron tick is for.
  const enqueue = (enqueueResult.data ?? {}) as { queued?: number };
  if ((enqueue.queued ?? 0) > 0 || progress.status === "computing") {
    after(async () => {
      await wakeLeagueSyncWorker("manager-pulse-enqueue");
    });
  }

  // A run that queued nothing (everything already fresh) moves straight to
  // 'computing' inside enqueue_manager_pulse_capture; that is the "warm"
  // outcome. Anything still 'capturing' has real Sleeper work in flight.
  return progress.status === "computing" || progress.status === "complete"
    ? { status: "warm", runId, progress }
    : { status: "started", runId, progress };
}

/**
 * Close out any league row whose JOB has already finished.
 *
 * THE RACE THIS EXISTS FOR, AND IT STALLS A RUN FOREVER.
 * `enqueue_manager_pulse_capture` (migration 0257) does not duplicate a job
 * for a league that is already syncing for this user: it LINKS the new run's
 * league row to the existing job. The worker closes a job by updating every
 * `manager_pulse_run_leagues` row that points at it. Those two steps are not
 * ordered against each other, so a link written in the instant AFTER the
 * worker's update lands on a job that is already `done`, and nothing will ever
 * update that row again: the queue is empty, so no worker pass touches the job
 * a second time. The run sits at "45 of 60 leagues read" for good, the poller
 * keeps polling, and the reader is told the sync is still going when every
 * league it was waiting on finished minutes ago.
 *
 * Reconciling on read is the fix because the JOB is the fact and the run row
 * is bookkeeping about it. This writes nothing that is not already true: a row
 * only moves when its own job says it is finished.
 *
 * Costs one indexed read on a run that still has open rows, and nothing at all
 * once there are none, which is the common case.
 *
 * Never throws. A failed reconcile leaves the counts where they were.
 */
async function reconcileFinishedJobs(
  admin: SupabaseClient<Database>,
  runId: string,
): Promise<void> {
  try {
    const { data: open, error } = await admin
      .from("manager_pulse_run_leagues")
      .select("id, job_id")
      .eq("run_id", runId)
      .in("status", ["pending", "queued"])
      .not("job_id", "is", null);
    if (error || !open || open.length === 0) return;

    const jobIds = [...new Set(open.map((row) => row.job_id).filter((id): id is string => !!id))];
    if (jobIds.length === 0) return;

    const { data: jobs, error: jobsError } = await admin
      .from("league_sync_jobs")
      .select("id, status")
      .in("id", jobIds);
    if (jobsError || !jobs) return;

    const statusByJob = new Map(jobs.map((job) => [job.id, job.status]));
    const doneIds: string[] = [];
    const failedIds: string[] = [];
    for (const row of open) {
      const jobStatus = row.job_id ? statusByJob.get(row.job_id) : undefined;
      if (jobStatus === "done") doneIds.push(row.id);
      else if (jobStatus === "failed") failedIds.push(row.id);
    }

    const now = new Date().toISOString();
    if (doneIds.length > 0) {
      await admin
        .from("manager_pulse_run_leagues")
        .update({ status: "done", detail: null, updated_at: now })
        .in("id", doneIds);
    }
    if (failedIds.length > 0) {
      await admin
        .from("manager_pulse_run_leagues")
        .update({
          status: "failed",
          detail: "This league could not be read from Sleeper.",
          updated_at: now,
        })
        .in("id", failedIds);
    }

    if (doneIds.length + failedIds.length === open.length) {
      // Nothing left waiting, so the run can move on. Guarded on 'capturing'
      // exactly as the worker's own recount is, so a late close can never send
      // a run backwards from 'computing', 'complete' or 'error'.
      await admin
        .from("manager_pulse_runs")
        .update({ status: "computing", updated_at: now })
        .eq("id", runId)
        .eq("status", "capturing");
    }
  } catch {
    // Bookkeeping. The report is built from the league rows either way.
  }
}

/**
 * Real, counted progress for one run. Reads `manager_pulse_runs` for the
 * status and totals, a grouped read over `manager_pulse_run_leagues` for
 * `leaguesDone` / `leaguesFailed` (the live truth: the run row's own counters
 * are updated by the sync worker as jobs close out and can lag a moment
 * behind the league rows they are derived from), then the linked jobs
 * themselves for `leaguesProcessing`, `queueAhead` and `workerSeenAt`, and
 * finally the live-report cache for `partialVersion`.
 *
 * Reconciles first, so a league whose job finished but whose row was never
 * closed does not hold the run open forever. See reconcileFinishedJobs.
 *
 * `settings`: pass it in when the caller already has it, to avoid a second
 * read of the single-row settings table.
 *
 * Never throws.
 */
export async function readCaptureProgress(
  admin: SupabaseClient<Database>,
  runId: string,
  settings?: ManagerPulseSettings,
): Promise<CaptureProgress | null> {
  try {
    await reconcileFinishedJobs(admin, runId);

    const { data: run, error: runError } = await admin
      .from("manager_pulse_runs")
      .select(
        "id, status, requested_at, sleeper_user_id, season_from, season_to, leagues_total, leagues_done, leagues_failed, detail",
      )
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run) return null;

    const { data: leagueRows } = await admin
      .from("manager_pulse_run_leagues")
      .select("status, job_id")
      .eq("run_id", runId);

    let leaguesDone = run.leagues_done;
    let leaguesFailed = run.leagues_failed;
    const jobIds: string[] = [];
    if (leagueRows) {
      leaguesDone = 0;
      leaguesFailed = 0;
      for (const row of leagueRows) {
        if (row.status === "fresh" || row.status === "done") leaguesDone += 1;
        else if (row.status === "failed") leaguesFailed += 1;
        if ((row.status === "queued" || row.status === "pending") && row.job_id) {
          jobIds.push(row.job_id);
        }
      }
    }

    let leaguesProcessing = 0;
    let queueAhead = 0;
    let workerSeenAt: string | null = null;
    if (jobIds.length > 0) {
      // 200-id chunk: a run linking more than 200 open jobs reports
      // processing counts over its first 200, which is a display figure.
      const { data: jobs } = await admin
        .from("league_sync_jobs")
        .select("status, updated_at, created_at")
        .in("id", jobIds.slice(0, 200));
      let oldestPending: string | null = null;
      for (const job of jobs ?? []) {
        if (job.status === "processing") leaguesProcessing += 1;
        if (!workerSeenAt || job.updated_at > workerSeenAt) workerSeenAt = job.updated_at;
        if (job.status === "pending" && (!oldestPending || job.created_at < oldestPending)) {
          oldestPending = job.created_at;
        }
      }
      if (oldestPending) {
        // NO "NOT IN (id, id, id, ...)" HERE. Migration 0267 added
        // league_sync_jobs_pending_created_idx on (created_at) where
        // status = 'pending', which turns the count below into a range scan,
        // but a NOT IN list of up to 250 UUIDs (the maxLeaguesPerRun default,
        // 500 at the admin ceiling) defeats that index and runs to about
        // 9.3 kB of query string, past PostgREST's 8 kB request-line buffer:
        // it comes back 414, `count` lands as null, queueAhead silently reads
        // 0, and a reader is told nothing is ahead of them when a hundred
        // jobs are.
        //
        // The exclusion this run needs is done in JavaScript instead, over
        // the jobs already fetched above. It cannot be pushed into the
        // filter without reintroducing the same unbounded id list: none of
        // this run's own pending jobs can have a created_at strictly before
        // its own oldest pending job (oldestPending is that minimum by
        // construction), so ownOlder is 0 in the ordinary case and only ever
        // guards the case where the 200-job slice above did not capture this
        // run's true oldest pending job.
        const { count } = await admin
          .from("league_sync_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .lt("created_at", oldestPending);
        const ownOlder = (jobs ?? []).filter(
          (job) => job.status === "pending" && job.created_at < oldestPending!,
        ).length;
        queueAhead = Math.max(0, (count ?? 0) - ownOlder);
      }
    }

    const modelVersion = settings
      ? settings.modelVersion
      : (await loadManagerPulseSettings(admin)).modelVersion;

    const { data: live } = await admin
      .from("manager_pulse_live_reports")
      .select("version")
      .eq("sleeper_user_id", run.sleeper_user_id)
      .eq("season_from", run.season_from)
      .eq("season_to", run.season_to)
      .eq("model_version", modelVersion)
      .maybeSingle();

    return {
      runId: run.id,
      status: run.status as CaptureProgress["status"],
      requestedAt: run.requested_at,
      leaguesTotal: run.leagues_total,
      leaguesDone,
      leaguesFailed,
      leaguesProcessing,
      queueAhead,
      workerSeenAt,
      partialVersion: live?.version ?? 0,
      detail: run.detail,
    };
  } catch {
    return null;
  }
}

/**
 * The run this reader already has open for this exact question, if there is
 * one.
 *
 * A capture is not instant: it queues footprint jobs that a background worker
 * drains over minutes, and the page renders again (a poll's `router.refresh`,
 * a manual reload, a return visit) while that is happening. Every one of those
 * renders used to walk straight back into `startManagerCapture`, which claims a
 * NEW run, which is exactly what the per-user budget exists to refuse. The
 * result was the worst possible ending: the reader waited out the whole
 * capture, the leagues finished syncing, and the next render answered "one
 * lookup at a time" and left the report unbuilt for an hour.
 *
 * A RUN IS THE UNIT OF WORK, SO A SECOND RENDER RESUMES IT RATHER THAN
 * REPLACING IT. This finds the open one and the caller carries on with it, at
 * no budget cost, because nothing new is being asked of Sleeper.
 *
 * Only runs for the SAME (reader, subject, window) qualify. A reader who moves
 * on to a different manager is asking a different question and takes the
 * normal path.
 *
 * AND ONLY A RUN THAT IS STILL MOVING. A run whose worker died mid-drain must
 * not stay "open" forever, or resuming it parks the reader on a progress bar
 * that can never reach the end, which is a worse ending than the one this
 * function exists to fix. Rather than bounding this by the run's own age
 * (`updated_at`, which can lag), liveness is checked against the JOBS a run's
 * still-open league rows point at: if none of them is still pending or
 * processing, or every processing one has gone quiet for longer than twice
 * `settings.sync.staleProcessingMinutes`, the run is treated as abandoned. A
 * run with no open job rows at all (everything computing, or every league
 * already fresh) is alive by definition; there is nothing left to check.
 *
 * `try_claim_manager_pulse`'s own `resumed: true` reply (migration 0265) makes
 * this belt and braces rather than the only guard, but it is kept because it
 * saves the RPC round trip on every poll-driven render.
 *
 * Never throws: an unreadable run is simply no run, and the caller falls back
 * to claiming a fresh one.
 */
export async function findOpenRun(
  admin: SupabaseClient<Database>,
  params: {
    userId: string;
    sleeperUserId: string;
    seasonFrom: number;
    seasonTo: number;
    settings: ManagerPulseSettings;
  },
): Promise<{ runId: string; progress: CaptureProgress } | null> {
  try {
    const { data, error } = await admin
      .from("manager_pulse_runs")
      .select("id")
      .eq("user_id", params.userId)
      .eq("sleeper_user_id", params.sleeperUserId)
      .eq("season_from", params.seasonFrom)
      .eq("season_to", params.seasonTo)
      .in("status", ["pending", "capturing", "computing"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const { data: openRows } = await admin
      .from("manager_pulse_run_leagues")
      .select("job_id")
      .eq("run_id", data.id)
      .in("status", ["pending", "queued"])
      .not("job_id", "is", null)
      .limit(200);
    const jobIds = (openRows ?? []).map((r) => r.job_id).filter((id): id is string => !!id);
    if (jobIds.length > 0) {
      const stale = new Date(
        Date.now() - params.settings.sync.staleProcessingMinutes * 2 * 60_000,
      ).toISOString();
      const { count } = await admin
        .from("league_sync_jobs")
        .select("id", { count: "exact", head: true })
        .in("id", jobIds)
        .in("status", ["pending", "processing"]);
      const { count: deadCount } = await admin
        .from("league_sync_jobs")
        .select("id", { count: "exact", head: true })
        .in("id", jobIds)
        .eq("status", "processing")
        .lt("updated_at", stale);
      if ((count ?? 0) === 0 || (deadCount ?? 0) === jobIds.length) return null; // nothing alive
    }

    const progress = await readCaptureProgress(admin, data.id, params.settings);
    if (!progress) return null;
    return { runId: data.id, progress };
  } catch {
    return null;
  }
}
