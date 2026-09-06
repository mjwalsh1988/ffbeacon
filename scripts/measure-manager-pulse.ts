/**
 * scripts/measure-manager-pulse.ts
 *
 * docs/manager-pulse/manager-pulse-audit-and-speed-plan.md, MPS-T053 and Part 9.
 *
 * Times a real Manager Pulse lookup the way a reader experiences it: by
 * requesting the site's own routes (GET /tools/manager-pulse/<handle>, then
 * GET /api/manager-pulse/runs/<run_id>), never by calling the engine
 * directly. This is the tooling only. It performs no measurement on its own;
 * a human runs it against a live deployment with real Sleeper handles and an
 * admin session.
 *
 * Usage:
 *   npm run measure:manager-pulse -- --handle <h> [--handle <h2> ...]
 *     [--label <text>]
 *     [--cold --i-understand-this-deletes-production-rows
 *       --confirm-project <ref> --measuring-user-id <uuid>]
 *
 * The admin session cookie is read from the MEASURE_ADMIN_COOKIE environment
 * variable, never from argv: an argv value is readable by other users
 * through the process table (/proc/<pid>/cmdline on Linux, ps broadly) and
 * lands verbatim in shell history, and there is no way to make a command
 * line argument safe from either of those. Set it before running:
 *   MEASURE_ADMIN_COOKIE="sb-access-token=..." npm run measure:manager-pulse -- ...
 * (adminBypassThrottle must be on; this script asserts it before doing
 * anything else). Without MEASURE_ADMIN_COOKIE, GET /tools/manager-pulse/<handle>
 * redirects to /login and nothing can be measured; the script says so and
 * moves on to the next handle. A --cookie flag is refused outright (its value
 * is never read into a variable) rather than accepted and ignored, so a stale
 * invocation cannot silently run cookie-less. THE COOKIE VALUE IS NEVER
 * PRINTED OR STORED: it is read once from the environment and used only as a
 * request header.
 *
 * MEASURE_BASE_URL (env, optional) overrides which site the script hits.
 * Defaults to lib/site.ts SITE.url (NEXT_PUBLIC_SITE_URL, or
 * https://ffbeacon.com), which is very unlikely to be what a local run
 * against `npm run dev` wants, so pass MEASURE_BASE_URL=http://localhost:3000
 * for that case.
 *
 * ABSOLUTE SAFETY RULES (the point of this file):
 *
 *   1. THIS SCRIPT IS THE ONLY PLACE IN THE CODEBASE ALLOWED TO NULL
 *      leagues.last_pulsed_at / capture_completed_at OR RESET
 *      leagues.pulse_status. Nothing else may reintroduce that pattern.
 *      Every other cache invalidation in this codebase forces a recompute by
 *      bumping a model version or a TTL, never by nulling a stamp; the only
 *      reason this script gets to is that it exists to force a true cold
 *      measurement, and it does so only behind --cold, only against the
 *      three reference handles a human passed in, and only after the
 *      guard in rule 2 clears every league.
 *
 *   2. --cold REFUSES TO RESET A LEAGUE WHOSE sleeper_league_id APPEARS IN
 *      community_leagues WITH is_active = true. That table is this
 *      codebase's actual "a league is being continuously relayed" concept
 *      (migration 0234: a community league resyncs every 15 minutes and its
 *      activity is posted to Discord), and it is the closest real match to
 *      the plan's "league_relay" guard: nulling a relayed league's stamps
 *      would force an unwanted extra Sleeper resync of somebody's live,
 *      continuously-watched league on the very next relay tick. Every
 *      league-season skipped for this reason is named and the reason is
 *      printed, before anything is written.
 *
 *   3. WITHOUT --cold THE SCRIPT MAKES NO WRITES AT ALL. It only reads
 *      settings, hits the page and polls progress.
 *
 *   4. THE COOKIE IS NEVER PRINTED, LOGGED, OR WRITTEN TO
 *      measurements.jsonl. It never touches the database either.
 *
 *   5. --cold REFUSES TO RUN UNLESS THE OPERATOR HAS NAMED THE PROJECT AND
 *      ACKNOWLEDGED THE DELETE, CHECKED BEFORE ANY WRITE. This is the only
 *      Supabase project this repo has, and .env.local carries its real
 *      SUPABASE_SECRET_KEY, so `npm run measure:manager-pulse -- --cold` on
 *      its own would reset real leagues and delete real rows. --cold now
 *      additionally requires --i-understand-this-deletes-production-rows (a
 *      second flag that cannot be typed by accident) and
 *      --confirm-project <ref>, where <ref> must exactly match the project
 *      ref this run actually resolves from NEXT_PUBLIC_SUPABASE_URL. The
 *      resolved project ref, the base URL, and exactly what will be reset are
 *      printed before either check is evaluated. See evaluateColdGuard.
 *
 *   6. --cold TAKES THE MEASURING USER AS A REQUIRED --measuring-user-id
 *      <uuid> ARGUMENT. It is never inferred from the newest
 *      manager_pulse_runs row for the subject: that heuristic deletes
 *      whichever real person most recently looked the handle up, if that
 *      happened more recently than the operator's own prior measurement run.
 *      Only manager_pulse_runs rows belonging to the named user_id are ever
 *      deleted.
 */

import { execSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getServiceClient } from "./_supabase";
import { discoverLeagueSeasons, resolveManagerHandle } from "../lib/manager-pulse/discover";
import { loadManagerPulseSettings } from "../lib/manager-pulse/settings";
import type { ManagerPulseSettings } from "../lib/manager-pulse/default-settings";
import { currentNflSeason } from "../lib/sleeper";
import { SITE } from "../lib/site";
import { formatEastern } from "../lib/datetime";

/* -------------------------------------------------------------------------- */
/* Pure: poll-transition detection (what scripts/measure-manager-pulse.test.ts drives) */
/* -------------------------------------------------------------------------- */

/** One GET /api/manager-pulse/runs/<run_id> response, plus when it was taken. */
export type ProgressSample = {
  /** Seconds since t0 (the GET /tools/manager-pulse/<handle> request). */
  tSeconds: number;
  status: "pending" | "capturing" | "computing" | "complete" | "error" | "throttled";
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  /** manager_pulse_live_reports.version for the run's subject; 0 when none. */
  partialVersion: number;
};

export type PollTransitions = {
  /** First poll where leaguesDone rose above the value on the FIRST poll (the
   * free/already-fresh count at enqueue). Null if it never did. */
  firstLeagueSeconds: number | null;
  /** First poll with partialVersion > 0. Null before Phase 3 lands, or if it never happened. */
  firstLiveSeconds: number | null;
  /** First poll with status "computing". Null if never observed. */
  computingSeconds: number | null;
  /** First poll with status "complete". Null if the sequence never reached it. */
  completeSeconds: number | null;
};

/**
 * Pure. Walks a recorded sequence of polls in order and returns the first
 * time each transition was observed. The sequence's own first sample is the
 * baseline for "first league" (the free count at enqueue): a sample can only
 * count as a new league finishing if leaguesDone is strictly greater than
 * what the very first poll already reported, so a league already fresh when
 * the run was claimed never registers as "the first league finished".
 *
 * Stops updating "complete" at the first complete sample (a run does not
 * un-complete), but keeps scanning past it for nothing else, since callers
 * pass the whole recorded sequence and expect a single, stable answer.
 */
export function detectPollTransitions(samples: ProgressSample[]): PollTransitions {
  const result: PollTransitions = {
    firstLeagueSeconds: null,
    firstLiveSeconds: null,
    computingSeconds: null,
    completeSeconds: null,
  };
  if (samples.length === 0) return result;

  const baselineDone = samples[0].leaguesDone;

  for (const sample of samples) {
    if (result.firstLeagueSeconds === null && sample.leaguesDone > baselineDone) {
      result.firstLeagueSeconds = sample.tSeconds;
    }
    if (result.firstLiveSeconds === null && sample.partialVersion > 0) {
      result.firstLiveSeconds = sample.tSeconds;
    }
    if (result.computingSeconds === null && sample.status === "computing") {
      result.computingSeconds = sample.tSeconds;
    }
    if (result.completeSeconds === null && sample.status === "complete") {
      result.completeSeconds = sample.tSeconds;
      break;
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Pure: job stat rollups                                                     */
/* -------------------------------------------------------------------------- */

/** Nearest-rank percentile over an already-sorted-ascending array. Null on an empty input. */
export function percentile(sortedAscending: number[], p: number): number | null {
  const n = sortedAscending.length;
  if (n === 0) return null;
  const rank = Math.min(n, Math.max(1, Math.ceil((p / 100) * n)));
  return sortedAscending[rank - 1];
}

export type DurationStats = { max: number | null; p95: number | null };

/** Pure. Ignores nothing but nulls; the caller reports how many were skipped. */
export function computeDurationStats(durations: number[]): DurationStats {
  if (durations.length === 0) return { max: null, p95: null };
  const sorted = [...durations].sort((a, b) => a - b);
  return { max: sorted[sorted.length - 1], p95: percentile(sorted, 95) };
}

/* -------------------------------------------------------------------------- */
/* Small pure helpers                                                         */
/* -------------------------------------------------------------------------- */

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The second --cold flag, chosen to be long and explicit enough that nobody
 * types it by accident. Kept as a named constant so the flag string, the
 * parser, the guard message and the usage text can never drift apart. */
export const COLD_ACKNOWLEDGE_FLAG = "--i-understand-this-deletes-production-rows";

type ParsedArgs = {
  handles: string[];
  label: string | null;
  cold: boolean;
  /** True when COLD_ACKNOWLEDGE_FLAG was passed. */
  acknowledgeDestructive: boolean;
  /** The --confirm-project value, checked against the resolved project ref. */
  confirmProjectRef: string | null;
  /** The --measuring-user-id value: whose manager_pulse_runs rows --cold may delete. */
  measuringUserId: string | null;
  /** True when a bare --cookie flag was passed on argv. Its value is never
   * read into a variable; the flag is refused rather than honored. */
  legacyCookieFlagUsed: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const handles: string[] = [];
  let label: string | null = null;
  let cold = false;
  let acknowledgeDestructive = false;
  let confirmProjectRef: string | null = null;
  let measuringUserId: string | null = null;
  let legacyCookieFlagUsed = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--handle") {
      const value = argv[i + 1];
      if (value) handles.push(value.trim().toLowerCase());
      i += 1;
    } else if (arg === "--label") {
      label = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--cold") {
      cold = true;
    } else if (arg === COLD_ACKNOWLEDGE_FLAG) {
      acknowledgeDestructive = true;
    } else if (arg === "--confirm-project") {
      confirmProjectRef = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--measuring-user-id") {
      measuringUserId = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--cookie") {
      // Refused, on purpose: argv is readable through the process table and
      // shell history. The value is never assigned to any variable, here or
      // anywhere else; only the fact that the flag was used is recorded, so
      // main() can refuse loudly and point at MEASURE_ADMIN_COOKIE instead.
      legacyCookieFlagUsed = true;
      i += 1;
    }
  }

  return {
    handles,
    label,
    cold,
    acknowledgeDestructive,
    confirmProjectRef,
    measuringUserId,
    legacyCookieFlagUsed,
  };
}

/** Pure. Parses the Supabase project ref out of the project URL, e.g.
 * "https://cilvpyivysjxpxbudkfa.supabase.co" -> "cilvpyivysjxpxbudkfa". Falls
 * back to the raw string if it does not parse as a URL, so a malformed env
 * value still produces a comparable (and visibly wrong) value rather than
 * throwing before the operator sees what is misconfigured. */
export function extractProjectRef(supabaseUrl: string): string {
  try {
    const host = new URL(supabaseUrl).hostname;
    return host.split(".")[0];
  } catch {
    return supabaseUrl;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ColdGuardArgs = {
  cold: boolean;
  acknowledgeDestructive: boolean;
  confirmProjectRef: string | null;
  measuringUserId: string | null;
};

export type ColdGuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Pure. Decides whether a --cold run may proceed, before any write happens.
 * Always ok when --cold was not requested. Otherwise refuses unless:
 *   - COLD_ACKNOWLEDGE_FLAG was passed (the operator means to delete real rows),
 *   - --measuring-user-id names a plausible uuid (rule 6: never inferred), and
 *   - --confirm-project exactly matches the project this run actually
 *     resolves (rule 5: the operator has named the project, not just typed
 *     --cold out of habit).
 * Order matters for the message a person sees first: the acknowledgement
 * comes before the project check, since a run missing both should be told
 * about the destructive nature of --cold before being told about a mismatched
 * ref.
 */
export function evaluateColdGuard(args: ColdGuardArgs, actualProjectRef: string): ColdGuardResult {
  if (!args.cold) return { ok: true };

  if (!args.acknowledgeDestructive) {
    return {
      ok: false,
      reason:
        `--cold nulls leagues.last_pulsed_at / capture_completed_at, resets leagues.pulse_status, ` +
        `and deletes manager_pulse_cache, manager_pulse_live_reports and manager_pulse_runs rows on ` +
        `whichever Supabase project this run is pointed at. Pass ${COLD_ACKNOWLEDGE_FLAG} to confirm ` +
        `that is what you mean to do.`,
    };
  }

  if (!args.measuringUserId || !UUID_RE.test(args.measuringUserId)) {
    return {
      ok: false,
      reason:
        "--cold requires --measuring-user-id <uuid>: the operator's own auth.users id, named " +
        "explicitly. It is never inferred from the newest manager_pulse_runs row, so a stranger's " +
        "run history is never deleted by mistake.",
    };
  }

  if (!args.confirmProjectRef) {
    return {
      ok: false,
      reason:
        `--cold requires --confirm-project <ref>. This run resolves to project ref ` +
        `"${actualProjectRef}" from NEXT_PUBLIC_SUPABASE_URL; pass --confirm-project ${actualProjectRef} ` +
        `once you have checked that is really the project you mean to reset.`,
    };
  }

  if (args.confirmProjectRef !== actualProjectRef) {
    return {
      ok: false,
      reason:
        `--confirm-project ${args.confirmProjectRef} does not match this run's resolved project ref ` +
        `"${actualProjectRef}". Refusing --cold rather than guessing which one you meant.`,
    };
  }

  return { ok: true };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Same rollover rule as lib/sleeper.ts currentNflSeason and
 * lib/manager-pulse/service.ts's private currentSeason: the NFL season
 * "year" rolls over in the spring, so a lookup before March is still asking
 * about the season that just finished. */
function resolveDefaultWindow(settings: ManagerPulseSettings): { seasonFrom: number; seasonTo: number } {
  const seasonTo = Number(currentNflSeason());
  const seasonFrom = seasonTo - (settings.capture.seasonWindowDefault - 1);
  return { seasonFrom, seasonTo };
}

/* -------------------------------------------------------------------------- */
/* --cold: the destructive reset                                              */
/* -------------------------------------------------------------------------- */

type ColdResetResult = {
  resetLeagues: string[];
  skippedRelayed: string[];
  failedSeasons: number[];
  deletedCache: number;
  deletedLiveReports: number;
  deletedRuns: number;
  measuringUserId: string;
};

async function coldReset(
  admin: ReturnType<typeof getServiceClient>,
  sleeperUserId: string,
  settings: ManagerPulseSettings,
  /** Whose manager_pulse_runs rows may be deleted for this subject. Named
   * explicitly by the operator (--measuring-user-id), never inferred: see
   * rule 6 in the file header. */
  measuringUserId: string,
): Promise<ColdResetResult> {
  const { seasonFrom, seasonTo } = resolveDefaultWindow(settings);

  const { leagueSeasons, failedSeasons } = await discoverLeagueSeasons({
    sleeperUserId,
    seasonFrom,
    seasonTo,
    settings,
  });

  const allSleeperLeagueIds = leagueSeasons.map((ls) => ls.sleeperLeagueId);

  // Rule 2: never reset a league that community_leagues (this codebase's
  // real "actively relayed" concept, migration 0234) marks is_active.
  const relayedIds = new Set<string>();
  for (const idChunk of chunk(allSleeperLeagueIds, 200)) {
    if (idChunk.length === 0) continue;
    const { data, error } = await admin
      .from("community_leagues")
      .select("sleeper_league_id")
      .in("sleeper_league_id", idChunk)
      .eq("is_active", true);
    if (error) throw new Error(`community_leagues check failed: ${error.message}`);
    for (const row of data ?? []) relayedIds.add(row.sleeper_league_id);
  }

  const resettable = leagueSeasons.filter((ls) => !relayedIds.has(ls.sleeperLeagueId));
  const skipped = leagueSeasons.filter((ls) => relayedIds.has(ls.sleeperLeagueId));

  console.log(
    `  cold reset: ${resettable.length} league-season(s) to reset, ${skipped.length} skipped (actively relayed)`,
  );
  for (const ls of skipped) {
    console.log(
      `    SKIPPED sleeper_league_id=${ls.sleeperLeagueId} season=${ls.season}: in community_leagues with is_active=true, a relayed league is somebody's live room`,
    );
  }
  if (failedSeasons.length > 0) {
    console.log(
      `  WARNING: discovery could not reach Sleeper for season(s) ${failedSeasons.join(", ")}; those seasons are undercounted in this reset and in the run that follows`,
    );
  }

  const resetLeagues: string[] = [];
  for (const ls of resettable) {
    const { error } = await admin
      .from("leagues")
      .update({ last_pulsed_at: null, capture_completed_at: null, pulse_status: "pending" })
      .eq("sleeper_league_id", ls.sleeperLeagueId);
    if (error) {
      console.error(`    FAILED to reset sleeper_league_id=${ls.sleeperLeagueId}: ${error.message}`);
      continue;
    }
    resetLeagues.push(ls.sleeperLeagueId);
    console.log(`    reset sleeper_league_id=${ls.sleeperLeagueId} season=${ls.season}`);
  }

  const { error: cacheError, count: cacheCount } = await admin
    .from("manager_pulse_cache")
    .delete({ count: "exact" })
    .eq("sleeper_user_id", sleeperUserId);
  if (cacheError) throw new Error(`manager_pulse_cache delete failed: ${cacheError.message}`);

  const { error: liveError, count: liveCount } = await admin
    .from("manager_pulse_live_reports")
    .delete({ count: "exact" })
    .eq("sleeper_user_id", sleeperUserId);
  if (liveError) throw new Error(`manager_pulse_live_reports delete failed: ${liveError.message}`);

  // The measuring user is the one the operator named on the command line
  // (--measuring-user-id), never inferred from the newest run: a heuristic
  // reading "whoever most recently looked this handle up" can delete a
  // stranger's run history if anyone else queried the same reference handle
  // more recently than the operator did. Only rows belonging to this exact
  // user_id are ever touched.
  const { error: runsError, count: runsCount } = await admin
    .from("manager_pulse_runs")
    .delete({ count: "exact" })
    .eq("sleeper_user_id", sleeperUserId)
    .eq("user_id", measuringUserId);
  if (runsError) throw new Error(`manager_pulse_runs delete failed: ${runsError.message}`);
  const deletedRuns = runsCount ?? 0;
  console.log(`  deleted ${deletedRuns} prior manager_pulse_runs row(s) for user_id=${measuringUserId}`);

  console.log(
    `  deleted ${cacheCount ?? 0} manager_pulse_cache row(s), ${liveCount ?? 0} manager_pulse_live_reports row(s)`,
  );

  return {
    resetLeagues,
    skippedRelayed: skipped.map((ls) => ls.sleeperLeagueId),
    failedSeasons,
    deletedCache: cacheCount ?? 0,
    deletedLiveReports: liveCount ?? 0,
    deletedRuns,
    measuringUserId,
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP: the site's own routes, never the engine                              */
/* -------------------------------------------------------------------------- */

function baseUrl(): string {
  return process.env.MEASURE_BASE_URL ?? SITE.url;
}

/** GET one route with the session cookie attached, never logged. Redirects are
 * followed manually so a redirect to /login can be reported plainly instead of
 * silently rendering a login page as though it were the report. */
async function getWithCookie(
  url: string,
  cookie: string | null,
): Promise<{ status: number; location: string | null; ok: boolean }> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    ok: res.status >= 200 && res.status < 300,
  };
}

type RunProgressResponse = {
  status: ProgressSample["status"];
  requestedAt: string;
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  leaguesProcessing: number;
  queueAhead: number;
  workerSeenAt: string | null;
  partialVersion: number;
  detail: string | null;
};

async function getRunProgress(
  runId: string,
  cookie: string | null,
): Promise<RunProgressResponse | null> {
  const res = await fetch(`${baseUrl()}/api/manager-pulse/runs/${runId}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!res.ok) return null;
  return (await res.json()) as RunProgressResponse;
}

const POLL_INTERVAL_MS = 1000;
/** A generous ceiling so a hung run cannot spin this script forever. */
const MAX_POLLS = 900; // 15 minutes at one poll per second.

/* -------------------------------------------------------------------------- */
/* One handle, one run                                                        */
/* -------------------------------------------------------------------------- */

type HandleMeasurement = {
  handle: string;
  cold: boolean;
  resolved: boolean;
  runId: string | null;
  queueDepthAtT0: number | null;
  tPageMs: number;
  transitions: PollTransitions;
  pollCount: number;
  runLeaguesByStatus: Record<string, number>;
  leagueSeasons: number;
  sleeperCalls: number | null;
  sleeperCallsNotCountedJobs: number;
  durationStats: DurationStats;
  captureDurationMinutes: number | null;
  callsPerMinute: number | null;
  note: string | null;
};

async function measureHandle(params: {
  admin: ReturnType<typeof getServiceClient>;
  handle: string;
  cold: boolean;
  /** Required whenever cold is true; guarded by evaluateColdGuard in main()
   * before this function is ever called with cold: true. */
  measuringUserId: string | null;
  cookie: string | null;
  settings: ManagerPulseSettings;
}): Promise<HandleMeasurement> {
  const { admin, handle, cold, measuringUserId, cookie, settings } = params;

  const base: HandleMeasurement = {
    handle,
    cold,
    resolved: false,
    runId: null,
    queueDepthAtT0: null,
    tPageMs: 0,
    transitions: {
      firstLeagueSeconds: null,
      firstLiveSeconds: null,
      computingSeconds: null,
      completeSeconds: null,
    },
    pollCount: 0,
    runLeaguesByStatus: {},
    leagueSeasons: 0,
    sleeperCalls: null,
    sleeperCallsNotCountedJobs: 0,
    durationStats: { max: null, p95: null },
    captureDurationMinutes: null,
    callsPerMinute: null,
    note: null,
  };

  const resolved = await resolveManagerHandle(handle);
  if (!resolved) {
    base.note = "handle did not resolve against Sleeper; not_found";
    return base;
  }
  base.resolved = true;
  const sleeperUserId = resolved.sleeperUserId;

  if (cold) {
    if (!measuringUserId) {
      // Defensive only: main() runs evaluateColdGuard before cold ever
      // reaches this function, so this should be unreachable.
      throw new Error("internal error: --cold reached measureHandle without a --measuring-user-id");
    }
    console.log(`[measure] --cold reset for handle=${handle} (sleeper_user_id=${sleeperUserId})`);
    await coldReset(admin, sleeperUserId, settings, measuringUserId);
  }

  const { count: queueDepth } = await admin
    .from("league_sync_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "processing"]);
  base.queueDepthAtT0 = queueDepth ?? null;

  const t0 = Date.now();
  const pageUrl = `${baseUrl()}/tools/manager-pulse/${encodeURIComponent(handle)}`;
  const pageRes = await getWithCookie(pageUrl, cookie);
  base.tPageMs = Date.now() - t0;

  if (pageRes.status >= 300 && pageRes.status < 400) {
    const toLogin = (pageRes.location ?? "").includes("/login");
    base.note = toLogin
      ? "GET /tools/manager-pulse redirected to /login: pass --cookie for a signed-in admin session"
      : `GET /tools/manager-pulse redirected to ${pageRes.location ?? "unknown"}`;
    return base;
  }
  if (!pageRes.ok) {
    base.note = `GET /tools/manager-pulse returned HTTP ${pageRes.status}`;
    return base;
  }

  // The run id, per the plan: the newest manager_pulse_runs row for the
  // subject. A report already warm within reportTtlHours is served straight
  // from manager_pulse_cache with no run touched at all, in which case this
  // is the prior run (already terminal) and the poll below observes it
  // complete on the first sample, correctly reporting a near-instant warm hit.
  const { data: runRow, error: runRowError } = await admin
    .from("manager_pulse_runs")
    .select("id")
    .eq("sleeper_user_id", sleeperUserId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runRowError) {
    base.note = `manager_pulse_runs lookup failed: ${runRowError.message}`;
    return base;
  }
  if (!runRow) {
    base.note = "no manager_pulse_runs row exists for this subject (no leagues, or the page errored)";
    return base;
  }
  base.runId = runRow.id;

  const samples: ProgressSample[] = [];
  for (let i = 0; i < MAX_POLLS; i += 1) {
    const tSeconds = (Date.now() - t0) / 1000;
    const progress = await getRunProgress(runRow.id, cookie);
    if (!progress) {
      base.note = "a poll of /api/manager-pulse/runs/<run_id> failed; stopping early";
      break;
    }
    samples.push({
      tSeconds,
      status: progress.status,
      leaguesTotal: progress.leaguesTotal,
      leaguesDone: progress.leaguesDone,
      leaguesFailed: progress.leaguesFailed,
      partialVersion: progress.partialVersion,
    });
    if (progress.status === "complete" || progress.status === "error") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  base.pollCount = samples.length;
  base.transitions = detectPollTransitions(samples);
  if (samples.length > 0) base.leagueSeasons = samples[samples.length - 1].leaguesTotal;
  if (samples.length >= MAX_POLLS && base.transitions.completeSeconds === null) {
    base.note = `hit the ${MAX_POLLS}-poll ceiling without reaching complete`;
  }

  // Post-completion reads.
  const runLeagueRows = await fetchAllRows(admin, "manager_pulse_run_leagues", runRow.id, "status");
  for (const row of runLeagueRows) {
    const status = (row as { status: string }).status;
    base.runLeaguesByStatus[status] = (base.runLeaguesByStatus[status] ?? 0) + 1;
  }

  const jobRows = await fetchAllJobStats(admin, runRow.id);
  const calls = jobRows.filter((j) => j.sleeper_calls !== null).map((j) => j.sleeper_calls as number);
  base.sleeperCallsNotCountedJobs = jobRows.filter((j) => j.sleeper_calls === null).length;
  base.sleeperCalls = calls.length > 0 || jobRows.length === 0 ? calls.reduce((a, b) => a + b, 0) : null;
  if (jobRows.length > 0 && calls.length === 0) {
    // Every job predates migration 0264 (sleeper_calls always null): "not
    // counted" is the honest answer, never a summed zero.
    base.sleeperCalls = null;
  }
  const durations = jobRows.filter((j) => j.duration_ms !== null).map((j) => j.duration_ms as number);
  base.durationStats = computeDurationStats(durations);

  const { data: runRowFull, error: runRowFullError } = await admin
    .from("manager_pulse_runs")
    .select("requested_at, completed_at")
    .eq("id", runRow.id)
    .maybeSingle();
  if (!runRowFullError && runRowFull?.completed_at) {
    const minutes =
      (Date.parse(runRowFull.completed_at) - Date.parse(runRowFull.requested_at)) / 60000;
    base.captureDurationMinutes = minutes > 0 ? minutes : null;
    if (base.captureDurationMinutes && base.sleeperCalls !== null) {
      base.callsPerMinute = base.sleeperCalls / base.captureDurationMinutes;
    }
  }

  return base;
}

/** Paged select of one column from a table filtered by run_id, at the
 * project's 200-row .in()/1000-row page convention (here just a plain page,
 * since the filter is a single run_id rather than an .in() list). */
async function fetchAllRows(
  admin: ReturnType<typeof getServiceClient>,
  table: "manager_pulse_run_leagues",
  runId: string,
  column: "status",
): Promise<Array<{ status: string }>> {
  const PAGE = 1000;
  const out: Array<{ status: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(column)
      .eq("run_id", runId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    const page = data ?? [];
    out.push(...(page as Array<{ status: string }>));
    if (page.length < PAGE) break;
  }
  return out;
}

async function fetchAllJobStats(
  admin: ReturnType<typeof getServiceClient>,
  runId: string,
): Promise<Array<{ sleeper_calls: number | null; duration_ms: number | null }>> {
  const PAGE = 1000;
  const out: Array<{ sleeper_calls: number | null; duration_ms: number | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("league_sync_jobs")
      .select("sleeper_calls, duration_ms")
      .eq("manager_run_id", runId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`league_sync_jobs read failed: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Printing and the measurements log                                         */
/* -------------------------------------------------------------------------- */

function fmtSeconds(v: number | null): string {
  return v === null ? "n/a" : `${v.toFixed(1)}s`;
}

function fmtCount(v: number | null): string {
  return v === null ? "not counted" : String(v);
}

function printHuman(m: HandleMeasurement): void {
  console.log("");
  console.log(`Handle: ${m.handle}`);
  console.log(`  Mode: ${m.cold ? "cold" : "warm"}`);
  if (!m.resolved) {
    console.log(`  Result: ${m.note}`);
    return;
  }
  console.log(`  Queue depth at t0: ${m.queueDepthAtT0 ?? "unknown"}`);
  console.log(`  Page response: ${m.tPageMs}ms`);
  console.log(`  Run id: ${m.runId ?? "none"}`);
  console.log(`  Polls taken: ${m.pollCount}`);
  console.log(`  First league: ${fmtSeconds(m.transitions.firstLeagueSeconds)}`);
  console.log(`  First live: ${fmtSeconds(m.transitions.firstLiveSeconds)}`);
  console.log(`  Computing: ${fmtSeconds(m.transitions.computingSeconds)}`);
  console.log(`  Complete: ${fmtSeconds(m.transitions.completeSeconds)}`);
  console.log(`  League-seasons: ${m.leagueSeasons}`);
  const statusParts = Object.entries(m.runLeaguesByStatus)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ");
  console.log(`  Run leagues by status: ${statusParts || "none"}`);
  console.log(`  Sleeper calls: ${fmtCount(m.sleeperCalls)}`);
  console.log(
    `  Job duration ms: max=${fmtCount(m.durationStats.max)} p95=${fmtCount(m.durationStats.p95)}`,
  );
  if (m.sleeperCallsNotCountedJobs > 0) {
    console.log(
      `  Note: ${m.sleeperCallsNotCountedJobs} job(s) for this run predate migration 0264 and have ` +
        `sleeper_calls=null and duration_ms=null. Nulls are EXCLUDED from the stats above, never ` +
        `counted as zero, so "Sleeper calls" and the duration figures are undercounted by exactly ` +
        `those job(s).`,
    );
  }
  console.log(
    `  Capture duration: ${m.captureDurationMinutes ? `${m.captureDurationMinutes.toFixed(2)} min` : "n/a"}`,
  );
  console.log(
    `  Calls per minute: ${m.callsPerMinute !== null ? m.callsPerMinute.toFixed(1) : "not counted"}`,
  );
  if (m.note) console.log(`  Note: ${m.note}`);
}

type MeasurementLogLine = {
  handle: string;
  cold: boolean;
  label: string | null;
  commit: string;
  date: string;
  dateEastern: string;
  settings: {
    sync: ManagerPulseSettings["sync"];
    captureCaps: {
      maxLeaguesPerRun: number;
      maxLeaguesPerSeason: number;
    };
  };
  result: Omit<HandleMeasurement, "handle" | "cold">;
};

async function appendMeasurementLog(
  line: MeasurementLogLine,
): Promise<void> {
  const filePath = path.join(process.cwd(), "docs", "manager-pulse", "measurements.jsonl");
  await appendFile(filePath, `${JSON.stringify(line)}\n`, "utf8");
}

/* -------------------------------------------------------------------------- */
/* main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.handles.length === 0) {
    console.error(
      "Usage: npm run measure:manager-pulse -- --handle <h> [--handle <h2> ...] [--label <text>] " +
        `[--cold ${COLD_ACKNOWLEDGE_FLAG} --confirm-project <ref> --measuring-user-id <uuid>]`,
    );
    console.error(
      "Set the MEASURE_ADMIN_COOKIE environment variable to the signed-in admin session cookie; it is never accepted on argv.",
    );
    process.exit(1);
  }

  // Refused unconditionally, whether or not --cold was passed: argv is
  // readable by other users through the process table and lands in shell
  // history, and there is no way to make that safe. The value itself was
  // never read (see parseArgs); only the fact that the flag appeared.
  if (args.legacyCookieFlagUsed) {
    console.error(
      "[measure-manager-pulse] REFUSING: --cookie on the command line is not accepted. It is readable " +
        "by other users through the process table (/proc/<pid>/cmdline, ps) and lands verbatim in shell " +
        "history. Set the MEASURE_ADMIN_COOKIE environment variable instead and drop --cookie from the invocation.",
    );
    process.exit(1);
  }

  const admin = getServiceClient();
  const settings = await loadManagerPulseSettings(admin);

  // Rule: assert the throttle bypass is on BEFORE doing anything else,
  // including a --cold reset, so a repeated measurement run is never
  // silently rate-limited into an unrepresentative number.
  if (!settings.capture.adminBypassThrottle) {
    console.error(
      "[measure-manager-pulse] REFUSING to run: manager_pulse_settings.capture.adminBypassThrottle is off. " +
        "Turn it on at /admin/manager-pulse before measuring, or repeated runs will be throttled and the numbers will not be comparable.",
    );
    process.exit(1);
  }

  const commit = gitCommit();
  const now = new Date();

  if (args.cold) {
    // Print exactly what a --cold run is pointed at and what it will do,
    // before either guard check below, so the operator sees this whether or
    // not the run is about to be refused.
    const actualProjectRef = extractProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    console.log(
      `[measure-manager-pulse] --cold requested. project ref=${actualProjectRef} base URL=${baseUrl()}`,
    );
    console.log(
      `[measure-manager-pulse] this would null leagues.last_pulsed_at / capture_completed_at and reset ` +
        `pulse_status on every league-season for handle(s): ${args.handles.join(", ")}; delete their ` +
        `manager_pulse_cache and manager_pulse_live_reports rows; and delete manager_pulse_runs rows for ` +
        `user_id=${args.measuringUserId ?? "(none given)"} on those handles. Leagues in community_leagues ` +
        `with is_active=true are skipped (see file header, rule 2).`,
    );

    const guard = evaluateColdGuard(args, actualProjectRef);
    if (!guard.ok) {
      console.error(`[measure-manager-pulse] REFUSING --cold: ${guard.reason}`);
      process.exit(1);
    }
  }

  const cookie = process.env.MEASURE_ADMIN_COOKIE ?? null;
  if (!cookie) {
    console.log(
      "[measure-manager-pulse] MEASURE_ADMIN_COOKIE is not set. GET /tools/manager-pulse/<handle> requires a signed-in session, " +
        "so every handle below will most likely redirect to /login and report nothing. Set MEASURE_ADMIN_COOKIE to a value copied from a browser session.",
    );
  }

  let anyFailed = false;

  for (const handle of args.handles) {
    console.log(`[measure-manager-pulse] measuring handle=${handle} cold=${args.cold}`);
    const measurement = await measureHandle({
      admin,
      handle,
      cold: args.cold,
      measuringUserId: args.measuringUserId,
      cookie,
      settings,
    });

    printHuman(measurement);

    const { handle: _handle, cold: _cold, ...rest } = measurement;
    const logLine: MeasurementLogLine = {
      handle,
      cold: args.cold,
      label: args.label,
      commit,
      date: now.toISOString(),
      dateEastern: formatEastern(now.toISOString()),
      settings: {
        sync: settings.sync,
        captureCaps: {
          maxLeaguesPerRun: settings.capture.maxLeaguesPerRun,
          maxLeaguesPerSeason: settings.capture.maxLeaguesPerSeason,
        },
      },
      result: rest,
    };
    console.log(`  JSON: ${JSON.stringify(logLine)}`);
    await appendMeasurementLog(logLine);

    if (!measurement.resolved || measurement.transitions.completeSeconds === null) {
      anyFailed = true;
    }
  }

  console.log("");
  console.log(
    anyFailed
      ? "[measure-manager-pulse] done, at least one handle did not complete cleanly (see notes above)"
      : "[measure-manager-pulse] done",
  );
  if (anyFailed) process.exit(1);
}

// Guarded so scripts/measure-manager-pulse.test.ts can import the pure
// functions above (detectPollTransitions, computeDurationStats, percentile,
// parseArgs) without also running main(): importing an ESM module for its
// exports must never have the side effect of starting a CLI run against the
// database.
const isRunDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isRunDirectly) {
  main().catch((err) => {
    console.error("[measure-manager-pulse] unexpected error:", err);
    process.exit(1);
  });
}
