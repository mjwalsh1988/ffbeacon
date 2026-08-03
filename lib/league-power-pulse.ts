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
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";

type ServiceClient = SupabaseClient<Database>;

/** How long a computed Power Pulse row stays fresh. */
export const POWER_PULSE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type PowerPulseResult =
  | { ok: true; teams: number; season: number; currentWeek: number; skipped?: string }
  | { ok: false; error: string };

/**
 * Whether this league needs a Power Pulse recompute. True when there are no
 * rows, when the freshest row is past the TTL, when the model version moved, or
 * when the stored week is behind the live NFL week.
 */
export async function powerPulseIsStale(
  supabase: ServiceClient,
  leagueRowId: string,
  currentWeek: number,
  modelVersion: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select("generated_at, through_week, model_version")
    .eq("league_id", leagueRowId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;
  if (data.model_version !== modelVersion) return true;
  if (Number(data.through_week) < currentWeek - 1) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= POWER_PULSE_TTL_MS;
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
 * refresh picks up the new week's schedule. `force` always recomputes.
 */
export async function refreshPowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  try {
    const settings = await loadPowerPulseSettings(supabase);
    if (!options.force) {
      const league = await loadLeague(supabase, leagueRowId);
      if (!league) return;
      const nflState = await getNflState();
      const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
      const stale = await powerPulseIsStale(
        supabase,
        leagueRowId,
        currentWeek,
        settings.modelVersion,
      );
      if (!stale) return;
    }

    const result = await calculateLeaguePowerPulse(supabase, leagueRowId, options);
    if (!result.ok) {
      console.warn(`[power-pulse] calc failed for league ${leagueRowId}: ${result.error}`);
    } else if (result.skipped) {
      console.log(`[power-pulse] skipped for league ${leagueRowId}: ${result.skipped}`);
    }
  } catch (err) {
    console.warn(`[power-pulse] calc threw for league ${leagueRowId}:`, (err as Error).message);
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

  // Opponent splits come from the two most recent completed seasons.
  const defenseSeasons = [league.season - 1, league.season - 2];

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
