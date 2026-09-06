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
 * it as error with a fixed, generic detail string. A run left open is a
 * reader stuck on a progress bar forever.
 *
 * THE HANDLE IS RESOLVED ONCE, AT CAPTURE TIME. This module never calls
 * Sleeper: `avatarUrl` comes from the newest cached report's identity when
 * one exists, else null, rather than a second resolve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
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
    tendency: ManagerTendency;
  },
): Promise<void> {
  const samples = tendencySamples(params.tendency);
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

type RunLeague = {
  sleeperLeagueId: string;
  season: number;
  leagueName: string | null;
  category: ManagerLeagueCategory | null;
};

/** The league-seasons this run decided the report covers. Paged. */
async function readRunLeagues(admin: Admin, runId: string): Promise<RunLeague[]> {
  const out: RunLeague[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("manager_pulse_run_leagues")
      .select("sleeper_league_id, season, league_name, league_category, status")
      .eq("run_id", runId)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      // A league we could not read contributes nothing rather than contributing
      // a hole the report would have to explain twice.
      if (row.status === "failed" || row.status === "skipped") continue;
      out.push({
        sleeperLeagueId: row.sleeper_league_id,
        season: row.season,
        leagueName: row.league_name,
        category: (row.league_category as ManagerLeagueCategory | null) ?? null,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
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

    const runLeagues = await readRunLeagues(admin, runId);
    if (runLeagues.length === 0) {
      await closeRun(admin, runId, "complete", "No league-seasons in the window.");
      await deleteLiveReport(admin, cacheKey);
      return;
    }

    const input = await loadManagerPulseInput(admin, {
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
      leagueSeasonsSkipped: 0,
    });

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

    const tendency = buildTendency(input, report);
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
    await closeRun(admin, runId, "error", GENERIC_ERROR_DETAIL);
  }
}
