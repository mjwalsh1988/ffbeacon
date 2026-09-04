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
  if (!params.resolved) {
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
    p_cooldown_seconds: settings.capture.runCooldownSeconds,
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
 * Real, counted progress for one run. Reads `manager_pulse_runs` for the
 * status and total, then a grouped count over `manager_pulse_run_leagues`
 * for `leaguesDone` / `leaguesFailed`, which is the live truth: the run row's
 * own counters are updated by the sync worker as jobs close out and can lag
 * a moment behind the league rows they are derived from. Falls back to the
 * run row's own counters if that grouped read fails, rather than failing the
 * whole call over a second query.
 *
 * Never throws.
 */
export async function readCaptureProgress(
  admin: SupabaseClient<Database>,
  runId: string,
): Promise<CaptureProgress | null> {
  try {
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
