/**
 * Manager Pulse: the only module that queues league captures.
 *
 * docs/manager-pulse-plan.md sections 3.1, 4.1-4.5 and 9.
 *
 * ORDER OF OPERATIONS, AND IT MATTERS (section 9's "validate before claiming
 * anything" rule, the same one Trade Ideas holds):
 *   1. Validate the handle shape. Invalid returns not_found, no network call,
 *      no rate-limit spend.
 *   2. Resolve the handle against Sleeper. Unknown returns not_found.
 *   3. Claim the lookup rate-limit slot (fails closed).
 *   4. Discover the league-seasons. None returns empty.
 *   5. Decide needs_capture per league-season from one batched read of
 *      leagues.last_pulsed_at. A league we hold no row for always needs
 *      capture; never guessed.
 *   6. Claim the run via try_claim_manager_pulse. A cooldown reply returns
 *      throttled.
 *   7. Call enqueue_manager_pulse_capture with the league list.
 *
 * A stale link must not burn a reader's rate-limit budget, and garbage input
 * must gain an attacker nothing: that is why validation runs before the
 * Sleeper call and the Sleeper call runs before the rate-limit claim.
 *
 * BOTH RPCS ARE SERVICE-ROLE ONLY (migration 0257: SECURITY DEFINER, revoked
 * from public/anon/authenticated by name, granted to service_role only), so
 * `admin` here must be the service-role client, never a session-scoped one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { currentNflSeason } from "@/lib/sleeper";
import { discoverLeagueSeasons, isValidSleeperHandle, resolveManagerHandle } from "./discover";
import { claimManagerLookupSlot } from "./rate-limit";
import type { CaptureProgress, ManagerPulseSettings } from "./types";

export type CaptureOutcome =
  | { status: "started"; runId: string; progress: CaptureProgress }
  | { status: "warm"; runId: string; progress: CaptureProgress }
  | { status: "throttled"; retryAfterSeconds: number }
  | { status: "not_found" }
  | { status: "empty" }
  | { status: "error"; detail: string };

type TryClaimManagerPulseResult = {
  claimed?: boolean;
  run_id?: string;
  reason?: string;
  retry_after_seconds?: number;
};

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
   * Skip the lookup rate limit and the per-user cooldown.
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
  const { leagueSeasons } = await discoverLeagueSeasons({
    sleeperUserId: resolved.sleeperUserId,
    seasonFrom,
    seasonTo,
    settings,
  });

  if (leagueSeasons.length === 0) {
    return { status: "empty" };
  }

  // 5. Decide needs_capture per league-season from one batched read.
  // A league we hold no row for is never guessed fresh: it always needs capture.
  const sleeperLeagueIds = [...new Set(leagueSeasons.map((ls) => ls.sleeperLeagueId))];
  const { data: leagueRows } = await admin
    .from("leagues")
    .select("sleeper_league_id, last_pulsed_at")
    .in("sleeper_league_id", sleeperLeagueIds);

  const lastPulsedAtByLeague = new Map<string, string | null>();
  for (const row of leagueRows ?? []) {
    lastPulsedAtByLeague.set(row.sleeper_league_id, row.last_pulsed_at);
  }

  const captureTtlMs = settings.capture.captureTtlMinutes * 60_000;
  const nowMs = Date.now();
  const needsCapture = (sleeperLeagueId: string): boolean => {
    const lastPulsedAt = lastPulsedAtByLeague.get(sleeperLeagueId);
    if (!lastPulsedAt) return true;
    const ageMs = nowMs - new Date(lastPulsedAt).getTime();
    return !(ageMs <= captureTtlMs);
  };

  // 6. Claim the run.
  // No `as never`. The generated types carry both RPC signatures (migrations
  // 0257 and 0260), and casting the name away throws out exactly the argument
  // checking that regenerating them bought.
  const claimRunResult = await admin.rpc("try_claim_manager_pulse", {
    p_user_id: userId,
    p_sleeper_user_id: resolved.sleeperUserId,
    p_sleeper_handle: resolved.handle,
    p_season_from: seasonFrom,
    p_season_to: seasonTo,
    // Zero is "no cooldown" to the RPC, which already takes the window as a
    // parameter, so an admin bypass needs no separate code path in SQL and the
    // run row is still written exactly as it is for anybody else.
    p_cooldown_seconds: params.bypassThrottle ? 0 : settings.capture.runCooldownSeconds,
  });

  if (claimRunResult.error) {
    return { status: "error", detail: claimRunResult.error.message };
  }

  const claimRun = (claimRunResult.data ?? {}) as TryClaimManagerPulseResult;
  if (claimRun.claimed !== true || !claimRun.run_id) {
    if (claimRun.reason === "cooldown") {
      return {
        status: "throttled",
        retryAfterSeconds: claimRun.retry_after_seconds ?? settings.capture.runCooldownSeconds,
      };
    }
    return { status: "error", detail: `could not open a run (${claimRun.reason ?? "unknown"})` };
  }

  const runId = claimRun.run_id;

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
    // queued nothing holding the reader's whole cooldown, so a transient
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

  const progress = await readCaptureProgress(admin, runId);
  if (!progress) {
    return { status: "error", detail: "the run was opened but its progress could not be read" };
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
 * status and total, then a grouped count over `manager_pulse_run_leagues`
 * for `leaguesDone` / `leaguesFailed`, which is the live truth: the run row's
 * own counters are updated by the sync worker as jobs close out and can lag
 * a moment behind the league rows they are derived from. Falls back to the
 * run row's own counters if that grouped read fails, rather than failing the
 * whole call over a second query.
 *
 * Reconciles first, so a league whose job finished but whose row was never
 * closed does not hold the run open forever. See reconcileFinishedJobs.
 *
 * Never throws.
 */
export async function readCaptureProgress(
  admin: SupabaseClient<Database>,
  runId: string,
): Promise<CaptureProgress | null> {
  try {
    await reconcileFinishedJobs(admin, runId);

    const { data: run, error: runError } = await admin
      .from("manager_pulse_runs")
      .select("id, status, leagues_total, leagues_done, leagues_failed, section_status, detail")
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run) return null;

    let leaguesDone = run.leagues_done;
    let leaguesFailed = run.leagues_failed;

    const { data: leagueRows, error: leaguesError } = await admin
      .from("manager_pulse_run_leagues")
      .select("status")
      .eq("run_id", runId);

    if (!leaguesError && leagueRows) {
      leaguesDone = 0;
      leaguesFailed = 0;
      for (const row of leagueRows) {
        if (row.status === "fresh" || row.status === "done") leaguesDone += 1;
        else if (row.status === "failed") leaguesFailed += 1;
      }
    }

    return {
      runId: run.id,
      status: run.status as CaptureProgress["status"],
      leaguesTotal: run.leagues_total,
      leaguesDone,
      leaguesFailed,
      sectionStatus: (run.section_status ?? {}) as unknown as CaptureProgress["sectionStatus"],
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
 * NEW run, which is exactly what the per-user cooldown exists to refuse. The
 * result was the worst possible ending: the reader waited out the whole
 * capture, the leagues finished syncing, and the next render answered "one
 * lookup at a time" and left the report unbuilt for an hour.
 *
 * A RUN IS THE UNIT OF WORK, SO A SECOND RENDER RESUMES IT RATHER THAN
 * REPLACING IT. This finds the open one and the caller carries on with it, at
 * no cooldown cost, because nothing new is being asked of Sleeper.
 *
 * Only runs for the SAME (reader, subject, window) qualify. A reader who moves
 * on to a different manager is asking a different question and takes the
 * normal path.
 *
 * AND ONLY A RUN THAT IS STILL MOVING. A run whose worker died mid-drain stays
 * open forever, and resuming that one parks the reader on a progress bar that
 * can never reach the end, which is a worse ending than the one this function
 * exists to fix. `capture.resumeMaxAgeMinutes` bounds it, measured against
 * `updated_at` (which the worker stamps on every recount) rather than
 * `requested_at`, so a slow but live capture keeps qualifying and a dead one
 * stops.
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
    const freshEnough = new Date(
      Date.now() - params.settings.capture.resumeMaxAgeMinutes * 60_000,
    ).toISOString();

    const { data, error } = await admin
      .from("manager_pulse_runs")
      .select("id")
      .eq("user_id", params.userId)
      .eq("sleeper_user_id", params.sleeperUserId)
      .eq("season_from", params.seasonFrom)
      .eq("season_to", params.seasonTo)
      .in("status", ["pending", "capturing", "computing"])
      .gte("updated_at", freshEnough)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const progress = await readCaptureProgress(admin, data.id);
    if (!progress) return null;
    return { runId: data.id, progress };
  } catch {
    return null;
  }
}
