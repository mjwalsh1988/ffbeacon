/**
 * Power Pulse orchestrator.
 *
 * The public entry point, mirroring lib/league-power-rankings.ts: load one
 * league's world, run the model, upsert league_power_pulse_cache. Idempotent,
 * so re-running replaces the rows for that league season.
 *
 * Unlike the value power rankings, there is no format or source loop. Power
 * Pulse is computed from Sleeper projections under the league's own scoring
 * settings, so there is exactly one answer per team per season.
 *
 * A failure here is never fatal to a league page. The caller logs and moves on,
 * and the deep view falls back to the value rankings.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { closestScoringBase } from "@/lib/league-scoring";
import { isDraftPending } from "@/lib/league-readiness";
import { getNflState } from "@/lib/sleeper";
import { resolveCurrentWeek, syncLeagueMatchups } from "@/lib/league-matchups";
import { computePowerPulse, type PowerPulseTeamResult } from "@/lib/power-pulse/engine";
import {
  loadAccuracy,
  loadCompletedResults,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadSchedule,
} from "@/lib/power-pulse/load";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";

type ServiceClient = SupabaseClient<Database>;

/** How long a computed Power Pulse row stays fresh. */
export const POWER_PULSE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * How long a non-'ok' Power Pulse verdict is left alone before the next view
 * retries it. See the bypass table on refreshPowerPulse for the conditions
 * that let a league skip this wait entirely.
 */
export const POWER_PULSE_RETRY_MS = 15 * 60 * 1000; // 15 minutes

export type PowerPulseResult =
  | { ok: true; teams: number; season: number; currentWeek: number; skipped?: string }
  | { ok: false; error: string };

/** The verdict persisted to leagues.power_pulse_status. */
export type PowerPulseVerdictStatus = "ok" | "skipped" | "settled" | "error";

const MAX_DETAIL_LENGTH = 500;

function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}

// calculateLeaguePowerPulse's `skipped` reason strings, sorted into the two
// verdicts. 'skipped' is for a reason that is likely to clear up soon (a
// fetch that timed out, rosters or projections that have not synced yet).
// 'settled' is for a reason that is a statement about the season/week and
// will not change until a real event happens (no schedule yet, no draft yet,
// the season is over). Matched by exact string or prefix because several of
// these carry a dynamic suffix (a week number, a list of failed weeks).
const SKIPPED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r.startsWith("incomplete schedule fetch"),
  (r) => r === "no rosters",
  (r) => r === "no teams scored",
  (r) => r.startsWith("no weekly projections stored for"),
];
const SETTLED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r === "no published schedule",
  (r) => r === "draft pending with empty rosters",
  (r) => r.startsWith("no regular season games remaining from week"),
];

/**
 * Map calculateLeaguePowerPulse's return shape to the verdict persisted on
 * leagues.power_pulse_status. This is a lookup over an already-exhaustive set
 * of reason strings, not new calculation logic.
 *
 * A skipped reason this function does not recognise classifies as 'skipped'
 * rather than 'settled': skipped carries the shorter backoff, so an
 * unclassified reason is retried soon rather than possibly parked forever.
 * The cost of an unnecessary extra retry is one recompute; the cost of a
 * wrongly-'settled' league is silence.
 */
export function classifyPowerPulseResult(
  result: PowerPulseResult,
): { status: PowerPulseVerdictStatus; detail: string } {
  if (!result.ok) {
    return { status: "error", detail: result.error };
  }
  if (!result.skipped) {
    return {
      status: "ok",
      detail: `${result.teams} team${result.teams === 1 ? "" : "s"} scored, through week ${result.currentWeek}`,
    };
  }
  const reason = result.skipped;
  if (SKIPPED_REASON_TESTS.some((test) => test(reason))) {
    return { status: "skipped", detail: reason };
  }
  if (SETTLED_REASON_TESTS.some((test) => test(reason))) {
    return { status: "settled", detail: reason };
  }
  return { status: "skipped", detail: reason };
}

/**
 * The machine-readable suffix a 'settled' verdict's detail carries, recording
 * the (season, currentWeek, playoffWeekStart) triple that made it settled.
 * Format: `<reason> [settled season=2026 week=9 playoffStart=15]`. Appended
 * after classifyPowerPulseResult's plain-English reason and parsed back by
 * the backoff check below, so a settled league only recomputes when that
 * triple actually changes rather than on a timer.
 */
const SETTLED_TRIPLE_SUFFIX = / \[settled season=(\d+) week=(\d+) playoffStart=(\d+)\]$/;

function encodeSettledDetail(
  reason: string,
  season: number,
  currentWeek: number,
  playoffWeekStart: number,
): string {
  return `${reason} [settled season=${season} week=${currentWeek} playoffStart=${playoffWeekStart}]`;
}

function parseSettledTriple(
  detail: string | null,
): { season: number; currentWeek: number; playoffWeekStart: number } | null {
  if (!detail) return null;
  const m = SETTLED_TRIPLE_SUFFIX.exec(detail);
  if (!m) return null;
  return { season: Number(m[1]), currentWeek: Number(m[2]), playoffWeekStart: Number(m[3]) };
}

type BackoffRow = {
  last_pulsed_at: string | null;
  power_pulse_status: string | null;
  power_pulse_detail: string | null;
  power_pulse_attempted_at: string | null;
};

/**
 * Whether an 'error' or 'skipped' verdict is still inside its retry window.
 *
 * Bypassed when leagues.last_pulsed_at has advanced past the attempt: that is
 * what keeps a league responsive on draft night. pulseLeagueCore writes
 * rosters and advances last_pulsed_at on every real resync (a roster sync, a
 * draft finishing), so a league that changed since the last attempt is worth
 * retrying on the very next view rather than waiting out fifteen minutes.
 * Without this clause, "draft pending with empty rosters" would have to be
 * classified 'skipped' instead of 'settled' to stay responsive, and the
 * classification table in the plan would be wrong.
 */
function withinRetryBackoff(row: BackoffRow): boolean {
  if (!row.power_pulse_attempted_at) return false;
  const attemptedAt = new Date(row.power_pulse_attempted_at).getTime();
  if (Number.isNaN(attemptedAt)) return false;
  if (Date.now() - attemptedAt >= POWER_PULSE_RETRY_MS) return false;
  if (row.last_pulsed_at) {
    const lastPulsedAt = new Date(row.last_pulsed_at).getTime();
    if (!Number.isNaN(lastPulsedAt) && lastPulsedAt > attemptedAt) return false;
  }
  return true;
}

/**
 * Whether this league needs a Power Pulse recompute.
 *
 * The backoff check runs first, before any of the queries below, so a league
 * whose last attempt was not 'ok' and has not earned a bypass costs one
 * select and returns false without touching Sleeper. Only a 'settled'
 * verdict whose stored triple needs checking calls getCurrentWeek() (a
 * single, process-wide memoised ping, not a per-league round trip); an
 * 'error' or 'skipped' verdict inside its retry window never does.
 *
 * Past the backoff, this is the original staleness check: true when there
 * are no rows, when the freshest row is past the TTL, when the model version
 * moved, or when the stored week is behind the live NFL week.
 */
export async function powerPulseIsStale(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  playoffWeekStart: number,
  getCurrentWeek: () => Promise<number>,
  modelVersion: string,
): Promise<boolean> {
  const { data: backoffRow } = await supabase
    .from("leagues")
    .select("last_pulsed_at, power_pulse_status, power_pulse_detail, power_pulse_attempted_at")
    .eq("id", leagueRowId)
    .maybeSingle();

  if (backoffRow) {
    const status = backoffRow.power_pulse_status;
    if (status === "error" || status === "skipped") {
      if (withinRetryBackoff(backoffRow)) return false;
    } else if (status === "settled") {
      const stored = parseSettledTriple(backoffRow.power_pulse_detail);
      if (stored) {
        const currentWeek = await getCurrentWeek();
        if (
          stored.season === season &&
          stored.currentWeek === currentWeek &&
          stored.playoffWeekStart === playoffWeekStart
        ) {
          return false;
        }
      }
    }
    // null / 'pending' / 'ok': no backoff. A null status (a pre-migration row,
    // or a league that has never attempted Power Pulse) behaves as 'pending':
    // no backoff, a normal first attempt.
  }

  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select("generated_at, through_week, model_version")
    .eq("league_id", leagueRowId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;
  if (data.model_version !== modelVersion) return true;
  const currentWeek = await getCurrentWeek();
  if (Number(data.through_week) < currentWeek - 1) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= POWER_PULSE_TTL_MS;
}

async function stampAttempted(
  supabase: ServiceClient,
  leagueRowId: string,
  attemptedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("leagues")
    .update({ power_pulse_attempted_at: attemptedAt })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[power-pulse] could not stamp attempted_at for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Persist the verdict. Called after calculateLeaguePowerPulse returns (or,
 * from the catch block below, after it throws), so this always runs after
 * whatever cache rows it wrote or cleared. power_pulse_succeeded_at is
 * stamped only when result.ok is true: 'ok', 'skipped', and 'settled' are all
 * a completed run that reached an honest answer, 'error' is not.
 */
async function writeVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  result: PowerPulseResult,
): Promise<void> {
  const { status, detail } = classifyPowerPulseResult(result);
  let finalDetail = detail;
  if (status === "settled" && result.ok) {
    // The triple recorded is the one this verdict was reached under. Reading
    // playoffWeekStart back from the league row (rather than threading it
    // through PowerPulseResult) keeps calculateLeaguePowerPulse's return
    // shape untouched.
    const league = await loadLeague(supabase, leagueRowId);
    const playoffWeekStart = league?.playoffWeekStart ?? 15;
    finalDetail = encodeSettledDetail(detail, result.season, result.currentWeek, playoffWeekStart);
  }
  finalDetail = truncateDetail(finalDetail);

  const update: Database["public"]["Tables"]["leagues"]["Update"] = {
    power_pulse_status: status,
    power_pulse_detail: finalDetail,
  };
  if (result.ok) {
    update.power_pulse_succeeded_at = new Date().toISOString();
  }

  const { error } = await supabase.from("leagues").update(update).eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[power-pulse] could not write verdict for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Recompute Power Pulse for a league if it is stale, swallowing every failure.
 *
 * This is what pulseLeague calls. Power Pulse is a bonus surface: a league page
 * must still render its rosters, transactions, and value rankings when the
 * model cannot run, so nothing here is allowed to throw.
 *
 * Gating mirrors the power rankings: recompute at most once per TTL, plus
 * whenever the live NFL week moves past the stored one, so a Sunday night
 * refresh picks up the new week's schedule. `force` always recomputes and
 * always bypasses the backoff below.
 *
 * Backoff bypass table (see powerPulseIsStale / withinRetryBackoff for the
 * mechanics):
 *
 * | Last status      | Retried immediately when                              |
 * | ---------------- | ------------------------------------------------------ |
 * | error, skipped    | force:true, OR last_pulsed_at advanced since the attempt |
 * | settled           | force:true, OR (season, currentWeek, playoffWeekStart) changed |
 *
 * power_pulse_attempted_at is stamped before calculateLeaguePowerPulse runs,
 * so a crash mid-run still leaves an honest attempt and the retry window
 * still applies rather than hot-looping. power_pulse_succeeded_at and the
 * status/detail are written after the cache rows land (writeVerdict runs
 * after calculateLeaguePowerPulse returns).
 */
export async function refreshPowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  let attemptedAt: string | null = null;
  try {
    const settings = await loadPowerPulseSettings(supabase);
    if (!options.force) {
      const league = await loadLeague(supabase, leagueRowId);
      if (!league) return;
      // Lazy: only invoked (and only then does it touch Sleeper) if
      // powerPulseIsStale's backoff check does not already resolve the
      // question on its own.
      const getCurrentWeek = () =>
        getNflState().then((state) =>
          resolveCurrentWeek(state, league.season, league.playoffWeekStart),
        );
      const stale = await powerPulseIsStale(
        supabase,
        leagueRowId,
        league.season,
        league.playoffWeekStart,
        getCurrentWeek,
        settings.modelVersion,
      );
      if (!stale) return;
    }

    attemptedAt = new Date().toISOString();
    await stampAttempted(supabase, leagueRowId, attemptedAt);

    const result = await calculateLeaguePowerPulse(supabase, leagueRowId, options);
    await writeVerdict(supabase, leagueRowId, result);

    if (!result.ok) {
      console.warn(`[power-pulse] calc failed for league ${leagueRowId}: ${result.error}`);
    } else if (result.skipped) {
      console.log(`[power-pulse] skipped for league ${leagueRowId}: ${result.skipped}`);
    }
  } catch (err) {
    console.warn(`[power-pulse] calc threw for league ${leagueRowId}:`, (err as Error).message);
    if (attemptedAt) {
      // attempted_at was already stamped for this run; record why it did not
      // complete rather than leaving the previous verdict looking current.
      await writeVerdict(supabase, leagueRowId, {
        ok: false,
        error: (err as Error).message,
      }).catch(() => {});
    }
  }
}

export async function calculateLeaguePowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<PowerPulseResult> {
  const league = await loadLeague(supabase, leagueRowId);
  if (!league) return { ok: false, error: "league row not found" };

  const settings = await loadPowerPulseSettings(supabase);

  const nflState = await getNflState();
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);

  // Refresh the head-to-head slate before reading it.
  const matchupSync = await syncLeagueMatchups(
    supabase,
    league.id,
    league.sleeperLeagueId,
    league.season,
    currentWeek,
    { force: options.force },
  );
  if (!matchupSync.ok) {
    console.warn(
      `[power-pulse] matchup sync failed for league ${leagueRowId}: ${matchupSync.error}`,
    );
  }

  // A schedule we could not fully fetch is not a schedule we may reason about.
  // Sleeper timing out or throttling looks exactly like "this league has no
  // games" once the failure is flattened into an empty list, and scoring a
  // league against an empty slate produces a table of 0.0 win projections and
  // 0%/100% playoff odds that then sits in the cache for the full TTL. Bail
  // before the expensive loads and leave whatever is already cached alone; the
  // absence of a fresh row makes the next page view retry.
  if (matchupSync.failedWeeks.length > 0) {
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: `incomplete schedule fetch (weeks ${matchupSync.failedWeeks.join(", ")} did not answer)`,
    };
  }

  // Sleeper answered the probe with no games, so this league has no slate at
  // all. Stop before the roster, player, and projection loads rather than
  // paying for them on every view of an undrafted league.
  if (matchupSync.noScheduleYet) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: "no published schedule",
    };
  }

  const rosters = await loadRosters(supabase, leagueRowId);
  if (rosters.length === 0) {
    return { ok: true, teams: 0, season: league.season, currentWeek, skipped: "no rosters" };
  }

  // Nothing drafted yet. Every team would score zero, the ranks would be a
  // shuffle of ties, and we would cache that as though it meant something. Bail
  // before the expensive loads; the UI renders the pre-draft state instead.
  const rostersFilled = rosters.some((r) => r.playerSleeperIds.length > 0);
  if (isDraftPending(league.status) && !rostersFilled) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: "draft pending with empty rosters",
    };
  }

  const sleeperIds = Array.from(
    new Set(rosters.flatMap((r) => r.playerSleeperIds)),
  );
  const players = await loadPlayers(supabase, sleeperIds);
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  const scoringBase = closestScoringBase(league.scoringSettings);

  // Opponent splits come from whichever of the current season and the two
  // before it actually have a usable row; opponentMultiplier picks.
  const defenseSeasons = defenseSeasonsFor(league.season);

  const [projections, accuracy, defense, schedule, results] = await Promise.all([
    loadProjections(supabase, playerIds, league.season, currentWeek),
    loadAccuracy(supabase, playerIds, scoringBase),
    loadDefenseSplits(supabase, scoringBase, defenseSeasons),
    loadSchedule(supabase, leagueRowId, league.season),
    loadCompletedResults(supabase, leagueRowId, league.season),
  ]);

  if (projections.length === 0) {
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: `no weekly projections stored for ${league.season} from week ${currentWeek}`,
    };
  }

  // No games left to play means there is nothing to project. This covers the
  // league waiting on its draft, the league whose schedule Sleeper has not
  // published, and the season that is already over. All three used to fall
  // through and cache "0.0 expected wins out of 1 game" for every team, which
  // reads as a real answer and is not one. Store nothing instead; the UI has
  // honest empty states, and no row means the next view recomputes.
  const remainingSlate = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );
  if (remainingSlate.length === 0) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped:
        schedule.weeks.length === 0
          ? "no published schedule"
          : `no regular season games remaining from week ${currentWeek}`,
    };
  }

  const teams = computePowerPulse({
    league,
    rosters,
    players,
    projections,
    accuracy,
    defense,
    defenseSeasons,
    schedule: schedule.weeks,
    setLineups: schedule.setLineups,
    results,
    currentWeek,
    settings,
  });

  if (teams.length === 0) {
    return { ok: true, teams: 0, season: league.season, currentWeek, skipped: "no teams scored" };
  }

  const generatedAt = new Date().toISOString();
  const rows = teams.map((t) => toCacheRow(t, leagueRowId, league.season, currentWeek, settings.modelVersion, generatedAt));

  const { error } = await supabase
    .from("league_power_pulse_cache")
    .upsert(rows, { onConflict: "league_id,roster_id,season" });
  if (error) return { ok: false, error: `power pulse upsert failed: ${error.message}` };

  return { ok: true, teams: teams.length, season: league.season, currentWeek };
}

/**
 * Drop any cached rows for a league season we have just decided cannot be
 * scored.
 *
 * Declining to write a new row is not enough on its own: a league that was
 * scored under a previous run keeps showing those numbers forever, and the
 * numbers most likely to be sitting there are the degenerate ones this guard
 * exists to prevent. Only called from the branches that are a settled statement
 * about the league (no schedule, nothing drafted, no games left), never from a
 * transient fetch failure, where the previous answer is still the best one we
 * have.
 */
async function clearCache(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<void> {
  const { error } = await supabase
    .from("league_power_pulse_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error) {
    console.warn(
      `[power-pulse] could not clear stale cache for league ${leagueRowId}: ${error.message}`,
    );
  }
}

function toCacheRow(
  t: PowerPulseTeamResult,
  leagueId: string,
  season: number,
  currentWeek: number,
  modelVersion: string,
  generatedAt: string,
): Database["public"]["Tables"]["league_power_pulse_cache"]["Insert"] {
  return {
    league_id: leagueId,
    roster_id: t.rosterRowId,
    season,
    through_week: Math.max(0, currentWeek - 1),
    power_pulse: t.powerPulse,
    pulse_rank: t.pulseRank,
    score_points: t.scorePoints,
    score_points_rank: t.scorePointsRank,
    score_schedule: t.scoreSchedule,
    score_schedule_rank: t.scoreScheduleRank,
    score_depth: t.scoreDepth,
    score_depth_rank: t.scoreDepthRank,
    score_form: t.scoreForm,
    score_form_rank: t.scoreFormRank,
    expected_points_per_week: t.expectedPointsPerWeek,
    expected_points_stdev: t.expectedPointsStdev,
    expected_wins: t.expectedWins,
    projected_wins: t.projectedWins,
    projected_losses: t.projectedLosses,
    projected_ties: t.projectedTies,
    playoff_odds: t.playoffOdds,
    bye_odds: t.byeOdds,
    title_odds: t.titleOdds,
    last_place_odds: t.lastPlaceOdds,
    sos_points: t.sosPoints,
    sos_rank: t.sosRank,
    lineup_efficiency: t.lineupEfficiency,
    lineup_efficiency_rank: t.lineupEfficiencyRank,
    lineup_points_lost: t.lineupPointsLost,
    reliability_score: t.reliabilityScore,
    reliability_rank: t.reliabilityRank,
    weekly: t.weekly as unknown as Json,
    drivers: t.drivers as unknown as Json,
    components: t.components as unknown as Json,
    model_version: modelVersion,
    generated_at: generatedAt,
  };
}
