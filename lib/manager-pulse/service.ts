/**
 * THE PUBLIC DOOR.
 *
 * Two entry points, and everything outside lib/manager-pulse/ goes through one
 * of them. Nothing else in the codebase imports the engine, the loader or the
 * capture step directly. That boundary is the whole reason this feature is a
 * service rather than a page: League Pulse Trade Ideas is the second consumer,
 * and it must be able to ask a structured question without dragging a page's
 * worth of loading behind it.
 *
 *   getManagerFootprint   the whole report. What /tools/manager-pulse renders.
 *   getManagerTendencies  the compact per-manager summary. What Trade Ideas reads.
 *   listRecentLookups     the handles one reader has looked up. The entry page.
 *
 * NEITHER THROWS. Every failure mode is a member of the returned union, because
 * a page that renders a manager's history must be able to say what went wrong
 * rather than falling over.
 *
 * ABSOLUTE RULE: `getManagerTendencies` is READ ONLY. It never queues a
 * capture, never calls Sleeper, and never computes a report. A manager we hold
 * no cached row for comes back ABSENT from the map, which the caller reads as
 * "no opinion" rather than as a neutral one. This is the same on-demand-only
 * rule that governs Power Pulse, Positional WAR and the Manager Ledger, and it
 * exists for the same reason: loading a league page must not be able to trigger
 * forty-eight league captures on behalf of eleven strangers.
 *
 * ABSOLUTE RULE: the cache key is (manager, season window, model version), and
 * the fingerprint decides staleness WITHIN that key. Both are needed. The key
 * separates answers to different questions; the fingerprint notices when the
 * answer to the same question has changed because more history arrived.
 *
 * WHY THE CACHE READ HAPPENS BEFORE THE CAPTURE CLAIM
 * A reader whose report is already warm should pay nothing: no Sleeper request,
 * no cooldown, no queue. So the order is cache, then capture. It also means a
 * reader who looks up the same manager twice in a minute gets an instant answer
 * the second time instead of a throttle message, which is the difference
 * between a tool that feels fast and one that feels like it is rationing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { currentNflSeason } from "@/lib/nfl-season";
import { loadManagerPulseSettings } from "./settings";
import {
  startManagerCapture,
  readCaptureProgress,
  findOpenRun,
  type CaptureOutcome,
} from "./capture";
import { isValidSleeperHandle, resolveManagerHandle } from "./discover";
import { claimManagerLookupSlot } from "./rate-limit";
import type {
  GetManagerFootprintRequest,
  GetManagerTendenciesRequest,
  ManagerFootprintResult,
  ManagerPulseSettings,
  ManagerReport,
  ManagerTendency,
} from "./types";

type Admin = SupabaseClient<Database>;

/* -------------------------------------------------------------------------- */
/* Cache reads and writes                                                     */
/* -------------------------------------------------------------------------- */

type CachedReport = {
  report: ManagerReport;
  fingerprint: string;
  generatedAt: string;
};

/**
 * The stored report for this exact question, if there is one.
 *
 * Named columns, never `select("*")`: `report` is a multi-kilobyte document and
 * this function is called on every page load, warm or cold.
 */
async function readCachedReport(
  admin: Admin,
  key: { sleeperUserId: string; seasonFrom: number; seasonTo: number; modelVersion: string },
): Promise<CachedReport | null> {
  const { data, error } = await admin
    .from("manager_pulse_cache")
    .select("report, fingerprint, generated_at")
    .eq("sleeper_user_id", key.sleeperUserId)
    .eq("season_from", key.seasonFrom)
    .eq("season_to", key.seasonTo)
    .eq("model_version", key.modelVersion)
    .maybeSingle();

  if (error || !data) return null;
  return {
    report: data.report as unknown as ManagerReport,
    fingerprint: data.fingerprint,
    generatedAt: data.generated_at,
  };
}

/**
 * The stored report for this handle, if there is one, WITHOUT resolving the
 * handle against Sleeper first.
 *
 * `sleeper_handle` is stored as Sleeper's own username casing, which can differ
 * from what a reader typed, so the match has to be case-insensitive.
 *
 * THE PATTERN IS ESCAPED, AND THAT IS NOT PARANOIA. `ilike` is a LIKE match,
 * whose wildcards are `%` and `_`, and `HANDLE_PATTERN` in discover.ts is
 * `/^[a-z0-9_]{1,32}$/`: it explicitly ALLOWS an underscore, because Sleeper
 * handles contain them all the time. Unescaped, a reader looking up `a_b` would
 * match a stored report for `axb` and be shown ONE REAL PERSON'S HISTORY UNDER
 * ANOTHER PERSON'S HANDLE. Validation does not save us here; it is the
 * validated character set that is dangerous.
 *
 * (The same mistake, with `%`, was found by review in the admin cache
 * invalidator, where it would have deleted every stored report instead.)
 *
 * Ordered newest first so a handle with more than one stored window (a rare
 * settings change mid-life) returns the freshest row for this exact window.
 */
/**
 * A string to be matched by LIKE as itself, with its wildcards escaped.
 *
 * Backslash is LIKE's default escape character, so `_` becomes `\_` and `%`
 * becomes `\%`. The backslash itself is escaped first, or escaping the
 * wildcards would re-introduce one.
 */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function readCachedReportByHandle(
  admin: Admin,
  key: { handle: string; seasonFrom: number; seasonTo: number; modelVersion: string },
): Promise<CachedReport | null> {
  const { data, error } = await admin
    .from("manager_pulse_cache")
    .select("report, fingerprint, generated_at")
    .ilike("sleeper_handle", likeLiteral(key.handle))
    .eq("season_from", key.seasonFrom)
    .eq("season_to", key.seasonTo)
    .eq("model_version", key.modelVersion)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    report: data.report as unknown as ManagerReport,
    fingerprint: data.fingerprint,
    generatedAt: data.generated_at,
  };
}

/**
 * Mark a run finished, so its progress row stops reading as in flight.
 *
 * `service.ts` calls this only from the MPS-T002 guarantee below: a run that
 * never gets past the capture step and throws for some other reason is still
 * closed as error rather than left open. The normal "capture finished, report
 * built" close happens in `finalize.ts`, which owns its own copy of this
 * helper so it does not have to import the render path to reach it.
 */
async function closeRun(
  admin: Admin,
  runId: string,
  status: "complete" | "error",
  detail: string | null,
): Promise<void> {
  try {
    await admin
      .from("manager_pulse_runs")
      .update({
        status,
        detail,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch {
    // A run row that never closes is an observability problem, not a reader's
    // problem. The report is already built and returned either way.
  }
}

/**
 * Whether this user may skip the throttling, read fresh on every lookup.
 *
 * `user_preferences.is_admin` is the flag, a trigger blocks self-promotion, and
 * only the service role can set it (migration 0018), so reading it here with
 * the admin client is the same answer `requireAdmin` gives a page.
 *
 * Read rather than passed in on purpose: a caller-supplied "I am an admin" is a
 * claim, and a claim is exactly what a bypass must not accept. This costs one
 * indexed read and is skipped entirely when the setting is off.
 *
 * Never throws, and fails CLOSED: any error means no bypass, so a broken read
 * makes an admin wait like everyone else rather than opening the gate.
 */
async function canBypassThrottle(
  admin: Admin,
  userId: string,
  settings: ManagerPulseSettings,
): Promise<boolean> {
  if (!settings.capture.adminBypassThrottle) return false;
  try {
    const { data, error } = await admin
      .from("user_preferences")
      .select("is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return false;
    return Boolean(data?.is_admin);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* The report                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The whole Manager Pulse report for one Sleeper handle.
 *
 * `admin` must be the SERVICE-ROLE client: every table this touches is
 * service-role only, and the caller is responsible for having established that
 * the reader is signed in before asking.
 *
 * `userId` is the SIGNED-IN READER, not the subject of the report. It is what
 * the cooldown and the rate limit are measured against. Passing the subject's
 * id here would meter the wrong person.
 */
export async function getManagerFootprint(
  admin: Admin,
  userId: string,
  request: GetManagerFootprintRequest,
  /**
   * The settings row, when the caller already holds it. The page reads it to
   * decide the panel's poll interval, and reading it twice per render is one
   * indexed query nobody needs. Omitted, it is read here as before.
   */
  presetSettings?: ManagerPulseSettings,
): Promise<ManagerFootprintResult> {
  // MPS-T002's guarantee, kept even though most of what it originally
  // guarded (a thrown compute) moved out to finalize.ts in MPS-T040: a run
  // that reaches "started" or "warm" and then something in THIS function
  // throws before returning is still closed as error rather than left open
  // for a reader who will never see the drainer's finalize pass explain why.
  let openRunId: string | null = null;
  try {
    const settings = presetSettings ?? (await loadManagerPulseSettings(admin));
    // Resolved once, from the database rather than from the caller, and used
    // for both throttles below. See canBypassThrottle.
    const bypassThrottle = await canBypassThrottle(admin, userId, settings);

    // Resolve the subject first, because the cache is keyed on the Sleeper user
    // id and we cannot check for a warm report without it.
    //
    // THE METER GOES ROUND THE SLEEPER CALL, NOT ROUND THE CAPTURE.
    // Resolving a handle is the one outbound, third-party, enumerable request
    // in this whole path, and it happens on EVERY lookup including one that
    // ends at a warm cache. Metering only the capture left it free, which meant
    // a signed-in reader could walk a wordlist through the report route and
    // learn which handles exist, pointing the site's egress at api.sleeper.app
    // the whole time. Shape validation runs first and is still free, so garbage
    // costs nothing; a well-formed guess costs a slot.
    let sleeperUserId = request.sleeperUserId ?? null;
    let handle = request.handle ?? "";
    let resolvedSubject: {
      sleeperUserId: string;
      handle: string;
      avatarUrl: string | null;
    } | null = null;

    const { seasonFrom, seasonTo } = resolveWindow(request.seasons, settings);
    const modelVersion = settings.modelVersion;
    const maxAge = request.maxAge ?? settings.capture.reportTtlHours * 3_600_000;

    if (!sleeperUserId) {
      const trimmed = typeof handle === "string" ? handle.trim() : "";
      if (!isValidSleeperHandle(trimmed)) {
        return { status: "not_found", handle: trimmed };
      }

      // WARM-BY-HANDLE, BEFORE THE SLEEPER CALL. A cache hit here makes no
      // outbound request at all, so it costs nothing and legitimately skips
      // the rate-limit claim below, which exists only to meter the Sleeper
      // resolve. Do not move the claim above this: a resolve must never run
      // unmetered, but a read that never resolves needs no meter.
      const warmByHandle = await readCachedReportByHandle(admin, {
        handle: trimmed,
        seasonFrom,
        seasonTo,
        modelVersion,
      });
      const warmByHandleAgeMs = warmByHandle
        ? Date.now() - Date.parse(warmByHandle.generatedAt)
        : Infinity;
      if (warmByHandle && warmByHandleAgeMs <= maxAge) {
        return {
          status: "ready",
          report: warmByHandle.report,
          generatedAt: warmByHandle.generatedAt,
          stale: false,
        };
      }

      if (!bypassThrottle) {
        const lookupClaim = await claimManagerLookupSlot({ admin, userId, settings });
        if (!lookupClaim.ok) {
          return { status: "throttled", retryAfterSeconds: lookupClaim.retryAfterSeconds };
        }
      }

      const resolved = await resolveManagerHandle(trimmed);
      if (!resolved) return { status: "not_found", handle: trimmed };
      resolvedSubject = resolved;
      sleeperUserId = resolved.sleeperUserId;
      handle = resolved.handle;
    }

    // 1. Warm cache. A reader whose report is already built pays nothing.
    const cached = await readCachedReport(admin, {
      sleeperUserId,
      seasonFrom,
      seasonTo,
      modelVersion,
    });
    const cachedAgeMs = cached ? Date.now() - Date.parse(cached.generatedAt) : Infinity;
    if (cached && cachedAgeMs <= maxAge) {
      return {
        status: "ready",
        report: cached.report,
        generatedAt: cached.generatedAt,
        stale: false,
      };
    }

    // 2. RESUME BEFORE CLAIM. A capture this reader already has open for this
    // exact question is the answer to this render, not a reason to open a
    // second one. See `findOpenRun`: without this, every re-render during a
    // capture walked into `try_claim_manager_pulse`, was refused by the
    // cooldown it had itself just spent, and the reader who waited out the
    // whole sync was told "one lookup at a time" and left with no report for
    // an hour. Costs one indexed read on the warm-miss path and nothing at all
    // on the warm path, which returned above.
    const openRun = await findOpenRun(admin, {
      userId,
      sleeperUserId,
      seasonFrom,
      seasonTo,
      settings,
    });

    // 3. Capture. Validates, meters, claims the cooldown, queues what is stale.
    // The subject is passed down so the handle is resolved ONCE per lookup.
    // Without it this call repeats the same outbound request we just made and
    // just paid for.
    const capture: CaptureOutcome = openRun
      ? {
          // A run still reading leagues is "started"; one that has finished
          // reading and is waiting for a render to compute it is "warm". Same
          // two outcomes `startManagerCapture` returns, decided from the run's
          // own status rather than from a fresh claim.
          status: openRun.progress.status === "capturing" ? "started" : "warm",
          runId: openRun.runId,
          progress: openRun.progress,
        }
      : await startManagerCapture({
          admin,
          userId,
          handle,
          seasons: request.seasons,
          settings,
          bypassThrottle,
          ...(resolvedSubject ? { resolved: resolvedSubject } : {}),
        });

    if (capture.status === "started" || capture.status === "warm") {
      openRunId = capture.runId;
    }

    if (capture.status === "not_found") return { status: "not_found", handle };
    if (capture.status === "empty") return { status: "empty", reason: "no_leagues" };
    if (capture.status === "throttled") {
      // A stale report beats a throttle message. The reader asked for this
      // manager, we have an answer for this manager, and the only thing the
      // cooldown is protecting is the Sleeper refetch we are declining to do.
      if (cached) {
        return {
          status: "ready",
          report: cached.report,
          generatedAt: cached.generatedAt,
          stale: true,
        };
      }
      return {
        status: "throttled",
        retryAfterSeconds: capture.retryAfterSeconds,
        budgetUsed: capture.budgetUsed,
        budgetTotal: capture.budgetTotal,
      };
    }
    if (capture.status === "error") return { status: "error", detail: capture.detail };

    // Both remaining outcomes ("started": still reading leagues, "warm":
    // done reading and waiting to be computed) hand back real progress and
    // nothing else. The render path never loads or computes a report: a
    // background pass finalizes the run (finalize.ts) once its leagues are
    // in, woken by the same signal T003 uses to wake the drainer, and the
    // panel reads a live checkpoint (live-report.ts) in the meantime.
    return { status: "building", progress: capture.progress };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    console.error("[manager-pulse/service] getManagerFootprint failed:", detail);
    if (openRunId) {
      await closeRun(admin, openRunId, "error", "The report could not be built.");
    }
    return { status: "error", detail: "The report could not be built." };
  }
}

/**
 * Progress for one run, for the page's polling client.
 *
 * A thin pass-through so a caller never needs to import the capture module.
 */
export async function getCaptureProgress(admin: Admin, runId: string) {
  return readCaptureProgress(admin, runId);
}

/* -------------------------------------------------------------------------- */
/* Tendencies: the cross-tool read                                            */
/* -------------------------------------------------------------------------- */

/**
 * The compact tendency for each of these managers, for the ones we hold.
 *
 * ONE batched query. Trade Ideas calls this once per league page with eleven
 * ids, and it must stay one query however many ids arrive.
 *
 * ABSOLUTE: read only. Absent means absent. A manager with no row is left out
 * of the map entirely rather than given an empty tendency, because an empty
 * tendency reads as "we looked and there is nothing to say", and that is a
 * different claim from "we have never looked".
 *
 * `preloadedSettings`: pass the settings row when the caller has already
 * loaded it for something else on the same request (Trade Ideas needs it
 * again for its tendency thresholds), so this never issues a second read of
 * the same single-row table. Loaded here as before when omitted.
 */
export async function getManagerTendencies(
  admin: Admin,
  request: GetManagerTendenciesRequest,
  preloadedSettings?: ManagerPulseSettings,
): Promise<Map<string, ManagerTendency>> {
  const out = new Map<string, ManagerTendency>();
  const ids = Array.from(new Set(request.sleeperUserIds.filter((id) => id && id.length > 0)));
  if (ids.length === 0) return out;

  try {
    const settings = preloadedSettings ?? (await loadManagerPulseSettings(admin));
    if (!settings.tendency.enabledForTradeIdeas) return out;

    const minSample = request.minSample ?? settings.samples.minSeasonsForTendency;
    const maxAgeMs = settings.capture.tendencyTtlHours * 3_600_000;
    const now = Date.now();

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await admin
        .from("manager_pulse_tendencies")
        .select(
          "sleeper_user_id, tendency, dynasty_sample, redraft_sample, seasons_covered, model_version, generated_at",
        )
        .in("sleeper_user_id", chunk);
      if (error) {
        console.error("[manager-pulse/service] tendency read failed:", error.message);
        return out;
      }

      for (const row of data ?? []) {
        // A row written under a superseded model version is not this model's
        // opinion. Dropping it is how a modelVersion bump takes effect without
        // deleting anything.
        if (row.model_version !== settings.modelVersion) continue;
        if (now - Date.parse(row.generated_at) > maxAgeMs) continue;
        if (row.seasons_covered < minSample) continue;
        out.set(row.sleeper_user_id, row.tendency as unknown as ManagerTendency);
      }
    }
  } catch (err) {
    // Trade Ideas must render with or without this. An outage here removes a
    // few sentences from a card; it does not break the page.
    console.error(
      "[manager-pulse/service] getManagerTendencies failed:",
      err instanceof Error ? err.message : err,
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The season window, clamped to the settings bounds. */
function resolveWindow(
  seasons: number | undefined,
  settings: ManagerPulseSettings,
): { seasonFrom: number; seasonTo: number } {
  const { seasonWindowDefault, seasonWindowMin, seasonWindowMax } = settings.capture;
  const requested =
    typeof seasons === "number" && Number.isFinite(seasons)
      ? Math.trunc(seasons)
      : seasonWindowDefault;
  const size = Math.min(seasonWindowMax, Math.max(seasonWindowMin, requested));
  // The current NFL season is the top of the window. Derived here rather than
  // from a clock inside the engine, which stays pure.
  //
  // MPS-T001 (finding F14): this used to be a private copy of the rollover
  // rule, using getUTCMonth() / getUTCFullYear(). capture.ts computes the
  // same window with currentNflSeason(), which uses LOCAL time. Two copies of
  // one rule disagreed for a few hours around every March rollover on a
  // non-UTC runtime, so the cache read here and the run row capture.ts wrote
  // could land in different season windows. Importing the one shared,
  // client-safe copy from lib/nfl-season.ts (not lib/sleeper.ts, which pulls
  // in node:async_hooks) closes that gap.
  const seasonTo = Number(currentNflSeason());
  return { seasonFrom: seasonTo - (size - 1), seasonTo };
}

/* -------------------------------------------------------------------------- */
/* Recent lookups: the entry page's own read                                  */
/* -------------------------------------------------------------------------- */

export type RecentManagerLookup = {
  handle: string;
  lookedUpAt: string;
};

/**
 * The handles this reader has looked up, newest first, deduplicated.
 *
 * The entry page was one input field alone on an empty screen, with no way
 * back to a report you built five minutes ago short of retyping the handle.
 * This is that list.
 *
 * ONE INDEXED READ, against `manager_pulse_runs_user_idx`. It reads a small
 * window of the reader's newest runs and folds repeats out in memory rather
 * than asking Postgres for a distinct-on, because the window is bounded and a
 * reader who looked the same person up four times wants one row, not four.
 *
 * `admin` may be the SERVICE-ROLE client or the reader's own session client:
 * `manager_pulse_runs` is owner-readable, so a session client sees exactly this
 * reader's rows and nobody else's either way. `userId` is still passed and
 * filtered on, so a service-role caller cannot accidentally read everybody's.
 *
 * Never throws. An empty list is a fine entry page.
 */
export async function listRecentLookups(
  client: Admin,
  userId: string,
  limit = 6,
): Promise<RecentManagerLookup[]> {
  try {
    const { data, error } = await client
      .from("manager_pulse_runs")
      .select("sleeper_handle, requested_at")
      .eq("user_id", userId)
      .not("sleeper_handle", "is", null)
      .order("requested_at", { ascending: false })
      .limit(Math.max(limit * 4, limit));
    if (error || !data) return [];

    const seen = new Set<string>();
    const out: RecentManagerLookup[] = [];
    for (const row of data) {
      const handle = (row.sleeper_handle ?? "").trim();
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ handle, lookedUpAt: row.requested_at });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    console.error(
      "[manager-pulse/service] listRecentLookups failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
