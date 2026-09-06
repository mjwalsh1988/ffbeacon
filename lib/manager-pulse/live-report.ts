/**
 * Manager Pulse: the live report checkpoint.
 *
 * MPS-T041. A capture drains for minutes, and a reader watching the progress
 * bar wants something better than a bare count once real work has landed.
 * This module is what produces that: a report built from the league-seasons
 * a run has ALREADY finished, overwriting `manager_pulse_live_reports` for
 * the subject, on a schedule that does not hammer the database every time a
 * job settles.
 *
 * ABSOLUTE RULE: nothing a live report produces is ever written to
 * `manager_pulse_cache` or `manager_pulse_tendencies`. Only
 * `finalizeManagerPulseRun` (finalize.ts) writes those tables, and only from
 * the full, closed-out run. A live report is read by the progress panel and
 * nothing else, and `finalizeManagerPulseRun` deletes the subject's live row
 * once the real cache row exists.
 *
 * `shouldComputeLiveReport` is PURE: plain data in, a boolean out, no clock
 * read of its own (`nowMs` is passed in) and no I/O. `computeLiveReport` is
 * the impure half that reads the run, computes, and writes the checkpoint;
 * it never throws, and a failed write leaves the previous live report (and
 * the run's checkpoint columns) exactly where they were, rather than
 * recording a checkpoint that produced nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { coalesce } from "@/lib/request-coalesce";
import { loadManagerPulseInput } from "./load";
import { computeFootprint } from "./engine";
import type { ManagerLeagueCategory, ManagerPulseSettings, ManagerReport } from "./types";
import type { ManagerPulseSyncSettings } from "./default-settings";

type Admin = SupabaseClient<Database>;

/** Pure. Whether this run has crossed a checkpoint since its last one. */
export function shouldComputeLiveReport(input: {
  leaguesDone: number;
  lastCheckpointDone: number;
  lastCheckpointAt: string | null;
  nowMs: number;
  sync: ManagerPulseSyncSettings;
}): boolean {
  const { leaguesDone, lastCheckpointDone, lastCheckpointAt, nowMs, sync } = input;
  if (leaguesDone < sync.liveReportFirstAfter) return false;
  if (lastCheckpointDone === 0) return true;
  if (leaguesDone - lastCheckpointDone < sync.liveReportEveryLeagues) return false;
  if (lastCheckpointAt && nowMs - Date.parse(lastCheckpointAt) < sync.liveReportMinIntervalMs) return false;
  return true;
}

type ExistingLiveReport = {
  version: number;
  report: ManagerReport;
};

/** The subject's current live row, if there is one. Named columns only. */
async function readExistingLiveReport(
  admin: Admin,
  key: { sleeperUserId: string; seasonFrom: number; seasonTo: number; modelVersion: string },
): Promise<ExistingLiveReport | null> {
  const { data, error } = await admin
    .from("manager_pulse_live_reports")
    .select("version, report")
    .eq("sleeper_user_id", key.sleeperUserId)
    .eq("season_from", key.seasonFrom)
    .eq("season_to", key.seasonTo)
    .eq("model_version", key.modelVersion)
    .maybeSingle();
  if (error || !data) return null;
  return { version: data.version, report: data.report as unknown as ManagerReport };
}

type FinishedRunLeague = {
  sleeperLeagueId: string;
  season: number;
  leagueName: string | null;
  category: ManagerLeagueCategory | null;
};

/** The league-seasons this run has ALREADY finished reading. Paged. */
async function readFinishedRunLeagues(admin: Admin, runId: string): Promise<FinishedRunLeague[]> {
  const out: FinishedRunLeague[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("manager_pulse_run_leagues")
      .select("sleeper_league_id, season, league_name, league_category, status")
      .eq("run_id", runId)
      .in("status", ["fresh", "done"])
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
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
 * Compute over the finished league-seasons and overwrite the subject's live
 * row. Never throws.
 *
 * Two runs on one subject (a resumed run and a fresh one, or two readers who
 * happen to be asking about the same manager at once) serialize through
 * `coalesce("live:" + subjectKey)`, so `version` can only ever be read then
 * incremented by one writer at a time.
 *
 * A FAILED CHECKPOINT WRITE LEAVES THE PREVIOUS LIVE REPORT IN PLACE. The
 * upsert's own error is checked explicitly rather than left to the outer
 * catch, and the run's `live_checkpoint_done` / `live_checkpoint_at` are
 * updated only once the write has actually landed: recording a checkpoint
 * for a write that did not happen would tell the next pass a live report
 * already reflects this point in the run when it does not.
 */
export async function computeLiveReport(
  admin: Admin,
  runId: string,
  settings: ManagerPulseSettings,
): Promise<void> {
  try {
    const { data: run, error: runError } = await admin
      .from("manager_pulse_runs")
      .select("sleeper_user_id, sleeper_handle, season_from, season_to, leagues_total")
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run) return;

    const sleeperUserId = run.sleeper_user_id;
    const handle = run.sleeper_handle ?? "";
    const seasonFrom = run.season_from;
    const seasonTo = run.season_to;
    const modelVersion = settings.modelVersion;
    const subjectKey = `${sleeperUserId}:${seasonFrom}:${seasonTo}:${modelVersion}`;

    await coalesce(`live:${subjectKey}`, async () => {
      const existing = await readExistingLiveReport(admin, {
        sleeperUserId,
        seasonFrom,
        seasonTo,
        modelVersion,
      });
      const avatarUrl = existing?.report.identity.avatarUrl ?? null;

      const runLeagues = await readFinishedRunLeagues(admin, runId);

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

      const computedAt = new Date().toISOString();
      const report = computeFootprint(input, computedAt);
      const nextVersion = (existing?.version ?? 0) + 1;

      const { error: upsertError } = await admin.from("manager_pulse_live_reports").upsert(
        {
          sleeper_user_id: sleeperUserId,
          season_from: seasonFrom,
          season_to: seasonTo,
          model_version: modelVersion,
          report: report as unknown as Database["public"]["Tables"]["manager_pulse_live_reports"]["Insert"]["report"],
          coverage: runLeagues.length,
          coverage_total: run.leagues_total,
          version: nextVersion,
          computed_at: computedAt,
        },
        { onConflict: "sleeper_user_id,season_from,season_to,model_version" },
      );

      if (upsertError) {
        console.error("[manager-pulse/live-report] live row write failed:", upsertError.message);
        // Leave the previous live report AND the run's checkpoint columns
        // exactly where they were: this pass produced nothing durable.
        return;
      }

      await admin
        .from("manager_pulse_runs")
        .update({
          live_checkpoint_done: runLeagues.length,
          live_checkpoint_at: computedAt,
          updated_at: computedAt,
        })
        .eq("id", runId);
    });
  } catch (err) {
    console.error(
      "[manager-pulse/live-report] computeLiveReport failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
