/**
 * Manager Pulse: finalize a run.
 *
 * MPS-T040. This is the block that used to run inline at the end of
 * `service.ts getManagerFootprint`, moved here so the render path never
 * computes a report: `service.ts` returns `{ status: "building", progress }`
 * the moment a run has real work, and this module is what a background pass
 * calls once that run's captures are done. `finalizeComputingRuns` in
 * `league-bulk-sync.ts` is the caller, through
 * `coalesce("finalize:" + runId)` so one run is never finalized twice at
 * once.
 *
 * NEVER THROWS. Every path closes the run: a matching fingerprint closes it
 * as complete without writing, a successful compute writes the cache and the
 * tendency row and closes it as complete, and anything that goes wrong closes
 * it as error with a fixed, generic detail string (the real message goes to
 * the service-role-only manager_pulse_run_errors table). A run left open is a
 * reader stuck on a progress bar forever.
 *
 * COVERAGE IS CARRIED, NEVER DROPPED. League-seasons the run could not read
 * are counted into report.limits.leagueSeasonsFailed, and the cap-dropped ones
 * into leagueSeasonsSkipped, so the page can say the report is partial. A run
 * with any failure writes the report but NOT the tendency row: Trade Ideas
 * reads tendencies with no reader there to see a caveat.
 *
 * THE HANDLE IS RESOLVED ONCE, AT CAPTURE TIME. This module never calls
 * Sleeper: `avatarUrl` comes from the newest cached report's identity when
 * one exists, else null, rather than a second resolve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadManagerPulseInput } from "./load";
import { computeFootprint } from "./engine";
import { buildTendency, tendencySamples } from "./tendencies";
import { managerPulseFingerprint } from "./fingerprint";
import type {
  ManagerLeagueCategory,
  ManagerPulseSettings,
  ManagerReport,
  ManagerTendency,
} from "./types";

type Admin = SupabaseClient<Database>;

const GENERIC_ERROR_DETAIL = "The report could not be built.";

type CachedReport = {
  report: ManagerReport;
  fingerprint: string;
  generatedAt: string;
};

/**
 * The stored report for this exact question, if there is one.
 *
 * Named columns, never `select("*")`: `report` is a multi-kilobyte document.
 * finalize.ts already knows the subject's Sleeper user id from the run row,
 * so this reads by id only; the handle-based lookup lives in service.ts,
 * which is the render path and does not always have an id yet.
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
 * Store a report and its tendency row.
 *
 * Non-fatal by design. A failed write means the next reader recomputes, which
 * is slower and correct. Failing the request instead would throw away a report
 * we have already built, which is slower and ruder.
 */
async function writeReport(
  admin: Admin,
  params: {
    sleeperUserId: string;
    handle: string;
    seasonFrom: number;
    seasonTo: number;
    modelVersion: string;
    report: ManagerReport;
    fingerprint: string;
    /** Null for a partial run: the report is stored, the tendency is not. */
    tendency: ManagerTendency | null;
  },
): Promise<void> {
  try {
    const { error: reportError } = await admin.from("manager_pulse_cache").upsert(
      {
        sleeper_user_id: params.sleeperUserId,
        sleeper_handle: params.handle,
        season_from: params.seasonFrom,
        season_to: params.seasonTo,
        model_version: params.modelVersion,
        report: params.report as unknown as Database["public"]["Tables"]["manager_pulse_cache"]["Insert"]["report"],
        fingerprint: params.fingerprint,
        league_seasons_counted: params.report.counts.leagueSeasons,
        dynasty_seasons_counted: params.report.counts.dynasty,
        redraft_seasons_counted: params.report.counts.redraft,
        generated_at: params.report.generatedAt,
      },
      { onConflict: "sleeper_user_id,season_from,season_to,model_version" },
    );
    if (reportError) throw new Error(reportError.message);

    if (!params.tendency) return;
    const samples = tendencySamples(params.tendency);
    const { error: tendencyError } = await admin.from("manager_pulse_tendencies").upsert(
      {
        sleeper_user_id: params.sleeperUserId,
        sleeper_handle: params.handle,
        tendency:
          params.tendency as unknown as Database["public"]["Tables"]["manager_pulse_tendencies"]["Insert"]["tendency"],
        dynasty_sample: samples.dynasty,
        redraft_sample: samples.redraft,
        seasons_covered: params.tendency.seasonsCovered,
        season_from: params.seasonFrom,
        season_to: params.seasonTo,
        model_version: params.modelVersion,
        generated_at: params.report.generatedAt,
      },
      { onConflict: "sleeper_user_id" },
    );
    if (tendencyError) throw new Error(tendencyError.message);
  } catch (err) {
    console.error(
      "[manager-pulse/finalize] report write failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Mark a run finished, so its progress row stops reading as in flight. */
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
    // A run row that never closes is an observability problem, not a
    // reader's problem: the cache (or its honest absence) is the real answer.
  }
}

/**
 * Delete the subject's live report row, on a successful finalize.
 *
 * Nothing from a live report is ever read once the full report exists, so a
 * live row left behind is a stale-but-harmless partial, not a correctness
 * bug. This is a courtesy cleanup: never throws, and a failure here does not
 * change the run's outcome.
 */
async function deleteLiveReport(
  admin: Admin,
  key: { sleeperUserId: string; seasonFrom: number; seasonTo: number; modelVersion: string },
): Promise<void> {
  try {
    await admin
      .from("manager_pulse_live_reports")
      .delete()
      .eq("sleeper_user_id", key.sleeperUserId)
      .eq("season_from", key.seasonFrom)
      .eq("season_to", key.seasonTo)
      .eq("model_version", key.modelVersion);
  } catch {
    // Courtesy cleanup. The finalized report is the answer either way.
  }
}

/**
 * Keep the real reason a run failed, for whoever has to diagnose it.
 *
 * `manager_pulse_runs.detail` is owner-readable and the progress poll hands it
 * straight to the page, so it only ever carries the fixed generic sentence. The
 * underlying message goes to `manager_pulse_run_errors` (migration 0325), which
 * is service-role only, and to the server log. Never throws: a diagnostics
 * write that fails must not change how the run closes.
 */
async function recordRunError(admin: Admin, runId: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err ?? "unknown error")).slice(0, 2000);
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : null;
  try {
    // Untyped: the table arrives with migration 0325, ahead of regenerated types.
    await (admin as unknown as SupabaseClient).from("manager_pulse_run_errors").upsert(
      {
        run_id: runId,
        stage: "finalize",
        message,
        stack,
        created_at: new Date().toISOString(),
      },
      { onConflict: "run_id" },
    );
  } catch {
    // The console line in the caller already has the message.
  }
}

/**
 * How long a run may sit in 'pending' before the drainer calls it abandoned.
 *
 * 'pending' lasts from the claim to the enqueue, which is one request's worth
 * of work. A run still pending a quarter of an hour later belongs to a request
 * that died in between, and it would otherwise be "resumed" by every later
 * render and parked on a progress bar with nothing behind it.
 */
export const PENDING_RUN_ABANDON_MS = 15 * 60_000;

/**
 * Close every run stuck in 'pending' past `PENDING_RUN_ABANDON_MS`.
 *
 * Runs in the drainer beside the finalize pass, never in a page render. The
 * close refunds the budget (`counts_against_cooldown` false,
 * `leagues_charged` 0), because a run that queued nothing cost nothing, and
 * it is guarded on status so a run the enqueue moved on in the meantime is
 * left alone. Returns how many rows it closed. Never throws.
 */
export async function sweepAbandonedPendingRuns(
  admin: Admin,
  nowMs: number = Date.now(),
): Promise<number> {
  try {
    const cutoff = new Date(nowMs - PENDING_RUN_ABANDON_MS).toISOString();
    const now = new Date(nowMs).toISOString();
    const { data, error } = await admin
      .from("manager_pulse_runs")
      .update({
        status: "error",
        detail: "This lookup was interrupted before its leagues were queued. Try again.",
        counts_against_cooldown: false,
        leagues_charged: 0,
        completed_at: now,
        updated_at: now,
      })
      .eq("status", "pending")
      .lt("requested_at", cutoff)
      .select("id");
    if (error) {
      console.warn("[manager-pulse/finalize] pending-run sweep failed:", error.message);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.warn(
      "[manager-pulse/finalize] pending-run sweep failed:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * League-seasons dropped at discovery by the per-lookup cap, as recorded on
 * the run by capture.ts. Read on its own so a database without migration 0325
 * reads zero rather than failing the finalize.
 */
async function readLeaguesSkipped(admin: Admin, runId: string): Promise<number> {
  try {
    // Untyped: the column arrives with migration 0325, ahead of regenerated types.
    const { data, error } = await (admin as unknown as SupabaseClient)
      .from("manager_pulse_runs")
      .select("leagues_skipped")
      .eq("id", runId)
      .maybeSingle();
    if (error || !data) return 0;
    const value = Number((data as { leagues_skipped?: unknown }).leagues_skipped);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  } catch {
    return 0;
  }
}

type RunLeague = {
  sleeperLeagueId: string;
  season: number;
  leagueName: string | null;
  category: ManagerLeagueCategory | null;
};

type RunLeagueSet = {
  /** The league-seasons the report is built from. */
  read: RunLeague[];
  /** League-seasons the run meant to read and could not. */
  failed: number;
  /** League-seasons recorded on the run but not read ('skipped' rows). */
  skippedRows: number;
};

/** The league-seasons this run decided the report covers, and what it missed. Paged. */
async function readRunLeagues(admin: Admin, runId: string): Promise<RunLeagueSet> {
  const out: RunLeague[] = [];
  let failed = 0;
  let skippedRows = 0;
  // Throws on a failed page, so the run closes as an error rather than
  // finalizing over a partial league list.
  const rows = await fetchAllRows("manager-pulse run leagues", (from, to) =>
    admin
      .from("manager_pulse_run_leagues")
      .select("sleeper_league_id, season, league_name, league_category, status")
      .eq("run_id", runId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const row of rows) {
    // A league we could not read contributes nothing to the figures, but it is
    // COUNTED, so the report can say out loud that it is partial. Dropping it
    // silently is how a report built from 40 of 45 leagues used to present
    // itself as the whole history.
    if (row.status === "failed") {
      failed += 1;
      continue;
    }
    if (row.status === "skipped") {
      skippedRows += 1;
      continue;
    }
    out.push({
      sleeperLeagueId: row.sleeper_league_id,
      season: row.season,
      leagueName: row.league_name,
      category: (row.league_category as ManagerLeagueCategory | null) ?? null,
    });
  }
  return { read: out, failed, skippedRows };
}

/**
 * Build the report for one Manager Pulse run and close it out.
 *
 * `admin` must be the SERVICE-ROLE client. Callers should route this through
 * `coalesce("finalize:" + runId)` so a run cannot be finalized twice at once;
 * this function itself does not coalesce, since it has no way to know its own
 * run id is the right coalescing key from inside a shared module.
 *
 * NEVER THROWS: every path is wrapped, and the catch closes the run as error
 * rather than leaving it open.
 */
export async function finalizeManagerPulseRun(
  admin: Admin,
  runId: string,
  settings: ManagerPulseSettings,
): Promise<void> {
  try {
    const { data: run, error: runError } = await admin
      .from("manager_pulse_runs")
      .select("sleeper_user_id, sleeper_handle, season_from, season_to")
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run) {
      await recordRunError(admin, runId, new Error(runError?.message ?? "run row not found"));
      await closeRun(admin, runId, "error", GENERIC_ERROR_DETAIL);
      return;
    }

    const sleeperUserId = run.sleeper_user_id;
    const handle = run.sleeper_handle ?? "";
    const seasonFrom = run.season_from;
    const seasonTo = run.season_to;
    const modelVersion = settings.modelVersion;
    const cacheKey = { sleeperUserId, seasonFrom, seasonTo, modelVersion };

    // The newest cached report's identity supplies the avatar, since the
    // handle was already resolved once, at capture time.
    const cached = await readCachedReport(admin, cacheKey);
    const avatarUrl = cached?.report.identity.avatarUrl ?? null;

    const runLeagueSet = await readRunLeagues(admin, runId);
    const runLeagues = runLeagueSet.read;
    // A 'skipped' row is a league-season the run recorded and did not read,
    // which for the reader is the same thing as a failed one.
    const leagueSeasonsFailed = runLeagueSet.failed + runLeagueSet.skippedRows;
    const leagueSeasonsSkipped = await readLeaguesSkipped(admin, runId);

    if (runLeagues.length === 0) {
      if (leagueSeasonsFailed > 0) {
        // Every league-season this run meant to read failed. That is not an
        // empty window, and closing it as complete would cache nothing while
        // telling the reader there was nothing to find.
        await closeRun(admin, runId, "error", "None of this manager's leagues could be read from Sleeper.");
      } else {
        await closeRun(admin, runId, "complete", "No league-seasons in the window.");
      }
      await deleteLiveReport(admin, cacheKey);
      return;
    }

    const loaded = await loadManagerPulseInput(admin, {
      sleeperUserId,
      handle,
      avatarUrl,
      seasonFrom,
      seasonTo,
      settings,
      leagueSeasons: runLeagues.map((l) => ({
        sleeperLeagueId: l.sleeperLeagueId,
        season: l.season,
        category: l.category,
        leagueName: l.leagueName,
      })),
      leagueSeasonsSkipped,
    });
    // The loader does not know which league-seasons failed; the run's own
    // league rows do, so the count is added here and the engine carries it
    // into report.limits.
    const input = { ...loaded, leagueSeasonsFailed };

    const generatedAt = new Date().toISOString();
    const report = computeFootprint(input, generatedAt);

    const fingerprint = managerPulseFingerprint({
      seasonFrom,
      seasonTo,
      leagueSeasons: input.leagueSeasons.map((s) => ({
        leagueId: s.sleeperLeagueId,
        season: s.season,
      })),
      modelVersion,
      counts: {
        transactions: input.moves.length,
        drafts: input.drafts.length,
        settledMatchups: input.weeklyMoves.length,
      },
      // display is part of the fingerprint too: affinity.ts, results.ts and
      // narrative.ts all slice their "top N" lists INSIDE computeFootprint,
      // and the sliced result is what gets baked into manager_pulse_cache.
      settings: { samples: settings.samples, draft: settings.draft, display: settings.display },
    });

    // A fingerprint that matches the cached one means nothing that can
    // change the report has changed, so there is no reason to rewrite it.
    if (cached && cached.fingerprint === fingerprint) {
      await closeRun(admin, runId, "complete", null);
      await deleteLiveReport(admin, cacheKey);
      return;
    }

    // A PARTIAL OPINION NEVER FEEDS TRADE IDEAS. The report itself is stored,
    // labelled with its coverage, because a reader asked for it and is told
    // what it is missing. The tendency row is not: Trade Ideas reads it with no
    // reader in the loop to see a caveat, so a run that could not read every
    // league-season it set out to leaves the previous tendency row (if any)
    // exactly as it was.
    const tendency = leagueSeasonsFailed === 0 ? buildTendency(input, report) : null;
    await writeReport(admin, {
      sleeperUserId,
      handle,
      seasonFrom,
      seasonTo,
      modelVersion,
      report,
      fingerprint,
      tendency,
    });
    await closeRun(admin, runId, "complete", null);
    await deleteLiveReport(admin, cacheKey);
  } catch (err) {
    console.error(
      "[manager-pulse/finalize] finalizeManagerPulseRun failed:",
      err instanceof Error ? err.message : err,
    );
    await recordRunError(admin, runId, err);
    await closeRun(admin, runId, "error", GENERIC_ERROR_DETAIL);
  }
}
