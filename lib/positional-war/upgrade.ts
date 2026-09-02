import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { closestScoringBase } from "@/lib/league-scoring";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflState } from "@/lib/sleeper";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadSchedule,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { startingSlots, type LineupCandidate } from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { simulateWithReplacements, type WeeklyDistribution } from "@/lib/power-pulse/what-if";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { computeLineupSwap, type CandidateWeek, type RosterMetaEntry } from "@/lib/faab/marginal";
import { loadCachedWeekly } from "@/lib/trade-impact/load";
import { matchViewerRoster, type ViewerCandidate } from "@/lib/league-viewer";
import { loadPositionalWarView, loadViewerCandidates } from "@/lib/league-positional-war-data";
import type { WarCurvePoint } from "@/lib/positional-war/types";

/**
 * The upgrade what-if (section 15.1.2 of docs/league-pulse-positional-war-plan.md).
 *
 * THE ARCHITECTURAL CONSTRAINT THIS FILE MUST NEVER VIOLATE
 *
 * Positional WAR is a curve that renders on every visit to a league's Overview,
 * Power Pulse, and Positional WAR pages. If this module's simulation ran during
 * that render, every reader who merely loaded a page would spend a rate-limit
 * slot on a Monte Carlo season they never asked for, and the limit would start
 * firing for ordinary browsing. So nothing in this file may be called from a
 * page render. It is reached ONLY through the server action in
 * app/leagues/[league_id]/positional-war/actions.ts, itself reached only by an
 * explicit button press on /leagues/[id]/positional-war, below the chart.
 *
 * This is the OPPOSITE of the Trade Ideas arrangement, where
 * `?mode=build&in=...&out=...` legitimately decodes a trade out of the URL and
 * evaluates it during render, so lib/trade-impact/rate-limit.ts has to meter
 * that server-rendered path too. There is no equivalent path here: no URL
 * parameter encodes "run the upgrade what-if", so there is nothing for a GET
 * to decode and nothing for a render to evaluate. The only entry point is the
 * action, and the action is the only place that may call runUpgradeWhatIf.
 *
 * WHAT THIS ANSWERS, AND WHY IT IS NOT POSITIONAL WAR
 *
 * "If I added the best available player at this position who is not already
 * mine, what would that do to MY season." That is team-specific: it depends on
 * who is already on the roster, so it is answered in projected wins and
 * playoff odds, never in WAR (see lib/positional-war/naming.test.ts, which
 * allowlists this file for exactly that vocabulary because this is the one
 * place both metrics are required to appear together, each under its own
 * label).
 *
 * REUSE, NOT NEW LINEUP CODE
 *
 * The swap itself is computeLineupSwap() from lib/faab/marginal.ts. It already
 * rebuilds the optimal lineup week by week with the target added and the cut
 * applied, already handles the cascading lineup changes that follow, and
 * already refuses to name a cut it should not name. Turning that into playoff
 * and title odds is simulateWithReplacements() from lib/power-pulse/what-if.ts,
 * the same extraction lib/faab/league-faab.ts already uses for a single
 * signing. Nothing here duplicates either.
 *
 * THE BASELINE RULE
 *
 * Exactly one team changes. The viewer's team uses weeklyBefore on the before
 * side and weeklyAfter on the after side, both from the SAME computeLineupSwap
 * call. Every other team reads its distribution from
 * league_power_pulse_cache.weekly on both sides, never recomputed, so the only
 * thing that can move between the two simulation runs is the viewer's own
 * lineup. This is precisely lib/faab/league-faab.ts's pattern for a single
 * signing, and the shared seed in simulateSeason means both runs see identical
 * dice.
 */

type ServiceClient = SupabaseClient<Database>;
type AnySupabase =
  | ServiceClient
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Every reason the panel or the action declines to answer. */
export type UpgradeWhatIfRefusalReason =
  | "invalid"
  | "no-viewer"
  | "roster-mismatch"
  | "rate-limited"
  | "no-baseline"
  | "no-candidates"
  | "no-season-left"
  | "league-not-found";

export type UpgradeWhatIfTarget = {
  playerId: string;
  name: string;
  team: string | null;
  positionRank: number;
  /** The league-wide Positional WAR figure for this player, read straight off the cached curve. */
  positionalWar: number;
};

export type UpgradeWhatIfResult = {
  position: PulsePosition;
  target: UpgradeWhatIfTarget;
  /**
   * Set when the true best-available player at this position was already on
   * the viewer's roster, so the comparison fell to the next rank down.
   * `positionRank` names the best-ranked player the viewer already holds.
   */
  fellBackFrom: { positionRank: number } | null;
  winsDelta: number | null;
  playoffOddsDeltaPoints: number | null;
  titleOddsDeltaPoints: number | null;
  droppedPlayerName: string | null;
};

/*
 * WHY THERE IS NO `dropNote` HERE.
 *
 * computeLineupSwap can decline to name a cut and explain why instead, and
 * this result used to carry that sentence through. It never carried one.
 * Both of the branches in lib/faab/marginal.ts chooseDrop() that produce a
 * note fire only when a DROP GUARD is configured: one when the guard refused
 * everybody, one to name the player the guard passed over. This caller
 * configures no guard (see the comment at the computeLineupSwap call below),
 * so the note was always null and the panel's branch for it could not render.
 *
 * The guard is not simply missing. Both of its modes rank the roster by trade
 * VALUE, and Positional WAR is source-independent by contract, so wiring one
 * here would put a value-source dependency into a surface whose whole point is
 * that the source toggle cannot change it. Rather than leave a field that is
 * structurally always null and a paragraph that can never render, the pass-
 * through is gone. lib/positional-war/upgrade.test.ts pins the invariant, so
 * if a guard ever is configured here the test fails and says to bring the
 * sentence back with it.
 */

export type UpgradeWhatIfOutcome =
  | { ok: true; result: UpgradeWhatIfResult }
  | { ok: false; reason: UpgradeWhatIfRefusalReason };

/**
 * Read-only. Decides whether the panel renders its interactive controls at
 * all, before any press. Neither branch runs a simulation: this is a roster
 * lookup and a cache row count, the same weight of read the panel already
 * does for the curve itself.
 */
export async function resolveUpgradePanelAvailability(
  supabase: AnySupabase,
  params: { leagueRowId: string; season: number; viewerRosterId: number | null },
): Promise<{ ok: true } | { ok: false; reason: "no-viewer" | "no-baseline" }> {
  if (params.viewerRosterId === null) return { ok: false, reason: "no-viewer" };
  const cachedWeekly = await loadCachedWeekly(supabase, params.leagueRowId, params.season);
  if (cachedWeekly.size === 0) return { ok: false, reason: "no-baseline" };
  return { ok: true };
}

/**
 * Gate 2: re-derive whose team the viewer actually owns, from
 * rosters.player_ids by way of matchViewerRoster, exactly as the overlay
 * (E1a) does. A submitted roster id is never trusted for computation; it is
 * only compared against what this derivation produces, and a mismatch is
 * refused rather than silently corrected, so a stale or forged id cannot make
 * the action answer for a team the caller did not ask about.
 */
export async function resolveUpgradeViewerRoster(
  supabase: AnySupabase,
  params: {
    leagueRowId: string;
    submittedRosterId: number;
    searchedUsername: string | null;
    focusedRosterId: number | null;
  },
): Promise<{ ok: true; rosterId: number } | { ok: false; reason: "no-viewer" | "roster-mismatch" }> {
  const candidates: ViewerCandidate[] = await loadViewerCandidates(supabase, params.leagueRowId);
  const derived = matchViewerRoster(candidates, params.searchedUsername, params.focusedRosterId);
  if (derived === null) return { ok: false, reason: "no-viewer" };
  if (derived !== params.submittedRosterId) return { ok: false, reason: "roster-mismatch" };
  return { ok: true, rosterId: derived };
}

/**
 * Gate 4, the computation. Called only after the action has validated shape,
 * re-derived and confirmed the viewer's roster (gate 2), and claimed a
 * rate-limit slot (gate 3). `rosterId` here is trusted because the caller is
 * required to have already run it through resolveUpgradeViewerRoster.
 */
export async function runUpgradeWhatIf(
  supabase: ServiceClient,
  params: { sleeperLeagueId: string; position: PulsePosition; rosterId: number },
): Promise<UpgradeWhatIfOutcome> {
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("id, season")
    .eq("sleeper_league_id", params.sleeperLeagueId)
    .maybeSingle();
  if (!leagueRow || leagueRow.season == null) return { ok: false, reason: "league-not-found" };
  const leagueRowId = leagueRow.id;
  const season = Number(leagueRow.season);

  // Cheap gate before the expensive reads: no cached Power Pulse rows means no
  // baseline for the eleven teams we are not projecting, and inventing one
  // would report a swing that is really just eleven teams at zero.
  const cachedWeekly = await loadCachedWeekly(supabase, leagueRowId, season);
  if (cachedWeekly.size === 0) return { ok: false, reason: "no-baseline" };

  const view = await loadPositionalWarView(supabase, leagueRowId, season);
  const curve = view?.curves.find((c) => c.position === params.position) ?? null;
  if (!curve || curve.curve.length === 0) return { ok: false, reason: "no-candidates" };

  const league = await loadLeague(supabase, leagueRowId);
  if (!league) return { ok: false, reason: "league-not-found" };

  const rosters = await loadRosters(supabase, leagueRowId);
  const mine = rosters.find((r) => r.sleeperRosterId === params.rosterId);
  if (!mine) return { ok: false, reason: "no-viewer" };

  const owned = new Set<string>([
    ...mine.playerSleeperIds,
    ...mine.reserveSleeperIds,
    ...mine.taxiSleeperIds,
  ]);

  // The target: the highest-WAR player at this position who is not already
  // the viewer's, read straight off the cached curve (curve.curve is already
  // ordered best-WAR-first, per lib/positional-war/engine.ts). No search: the
  // curve was computed once for the whole league and this only walks it.
  let chosen: WarCurvePoint | null = null;
  let skippedRank: number | null = null;
  for (const point of curve.curve) {
    if (point.sleeperId && owned.has(point.sleeperId)) {
      if (skippedRank === null) skippedRank = point.positionRank;
      continue;
    }
    if (!point.sleeperId) continue;
    chosen = point;
    break;
  }
  if (!chosen || !chosen.sleeperId) return { ok: false, reason: "no-candidates" };
  const targetSleeperId = chosen.sleeperId;

  const nflState = await getNflState();
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  const lastRegularWeek = Math.max(currentWeek, league.playoffWeekStart - 1);
  const weeks: number[] = [];
  for (let w = currentWeek; w <= lastRegularWeek; w += 1) weeks.push(w);
  if (weeks.length === 0) return { ok: false, reason: "no-season-left" };

  const slots = startingSlots(league.rosterPositions);
  if (slots.length === 0) return { ok: false, reason: "no-candidates" };

  // IR and taxi players cannot start, so a cut there frees nothing that
  // matters here; the same exclusion computeLineupSwap's caller applies in
  // lib/faab/league-faab.ts.
  const ineligible = new Set([...mine.reserveSleeperIds, ...mine.taxiSleeperIds]);
  const rosteredSleeperIds = mine.playerSleeperIds.filter((sid) => !ineligible.has(sid));

  const allSleeperIds = Array.from(new Set([...rosteredSleeperIds, targetSleeperId]));
  const players = await loadPlayers(supabase, allSleeperIds);
  const targetPlayer = players.get(targetSleeperId);
  if (!targetPlayer) return { ok: false, reason: "no-candidates" };

  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = defenseSeasonsFor(league.season);
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));
  const pulseSettings = await loadPowerPulseSettings(supabase);

  const [projectionRows, accuracy, defense, schedule] = await Promise.all([
    loadProjections(supabase, playerIds, season, currentWeek),
    loadAccuracy(supabase, playerIds, scoringBase),
    loadDefenseSplits(supabase, scoringBase, defenseSeasons),
    loadSchedule(supabase, leagueRowId, season),
  ]);

  const projections = new Map<string, Map<number, ProjectionRow>>();
  for (const row of projectionRows) {
    const byWeek = projections.get(row.playerId) ?? new Map<number, ProjectionRow>();
    byWeek.set(row.week, row);
    projections.set(row.playerId, byWeek);
  }

  const rosterMeta = new Map<string, RosterMetaEntry>();
  const rosterByWeek = new Map<number, LineupCandidate[]>();
  for (const week of weeks) rosterByWeek.set(week, []);

  for (const sid of rosteredSleeperIds) {
    const player = players.get(sid);
    if (!player) continue;
    rosterMeta.set(player.playerId, {
      name: player.name,
      position: player.position,
      team: player.team,
      injuryStatus: player.injuryStatus,
    });
    const acc = accuracy.get(player.playerId) ?? null;
    const reliability = reliabilityMultiplier(acc, pulseSettings);
    for (const week of weeks) {
      const projected = projectPlayerWeek({
        projection: projections.get(player.playerId)?.get(week),
        subject: player,
        accuracy: acc,
        reliability,
        scoringSettings: league.scoringSettings,
        defense,
        defenseSeasons,
        week,
        currentWeek,
        settings: pulseSettings,
      });
      if (!projected) continue;
      rosterByWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points,
        sigma: projected.sigma,
      });
    }
  }

  const targetAccuracy = accuracy.get(targetPlayer.playerId) ?? null;
  const targetReliability = reliabilityMultiplier(targetAccuracy, pulseSettings);
  const candidateByWeek = new Map<number, CandidateWeek>();
  for (const week of weeks) {
    const projected = projectPlayerWeek({
      projection: projections.get(targetPlayer.playerId)?.get(week),
      subject: targetPlayer,
      accuracy: targetAccuracy,
      reliability: targetReliability,
      scoringSettings: league.scoringSettings,
      defense,
      defenseSeasons,
      week,
      currentWeek,
      settings: pulseSettings,
    });
    if (!projected) continue;
    candidateByWeek.set(week, {
      points: projected.points,
      sigma: projected.sigma,
      opponent: projected.opponent,
      opponentMultiplier: projected.opponentMultiplier,
    });
  }
  if (candidateByWeek.size === 0) return { ok: false, reason: "no-candidates" };

  const mustDrop = mine.playerSleeperIds.length >= league.rosterPositions.length;

  // No drop guard: FAAB's guard exists because a real dollar bid must not
  // suggest cutting an asset the market prices above the claim. This is a
  // free question with no bid attached, so the plain lineup-cost ranking
  // computeLineupSwap already does is the whole answer.
  const swap = computeLineupSwap({
    slots,
    weeks,
    rosterByWeek,
    candidateByWeek,
    candidatePlayerId: targetPlayer.playerId,
    candidatePosition: targetPlayer.position,
    rosterMeta,
    mustDrop,
  });

  // Baseline: every other team from the Power Pulse cache, the viewer's team
  // from the swap just computed. See the module header for why only one team
  // may ever be recomputed here.
  const baseline = new Map<number, WeeklyDistribution>();
  for (const [rosterId, dist] of cachedWeekly) baseline.set(rosterId, dist);
  baseline.set(mine.sleeperRosterId, swap.weeklyBefore);

  const everyRosterCovered = rosters.every((r) => baseline.has(r.sleeperRosterId));
  if (!everyRosterCovered) return { ok: false, reason: "no-baseline" };

  const upcoming = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );

  const simulated = simulateWithReplacements({
    rosters,
    baseline,
    replacements: new Map([[mine.sleeperRosterId, swap.weeklyAfter]]),
    upcoming,
    options: {
      runs: pulseSettings.simulation.runs,
      seed: pulseSettings.simulation.seed,
      playoffTeams: league.playoffTeams,
      playoffWeekStart: league.playoffWeekStart,
    },
  });
  if (!simulated) return { ok: false, reason: "no-season-left" };

  const before = simulated.before.get(mine.sleeperRosterId);
  const after = simulated.after.get(mine.sleeperRosterId);
  if (!before || !after) return { ok: false, reason: "no-season-left" };

  const asPoints = (v: number) => v * 100;

  const result: UpgradeWhatIfResult = {
    position: params.position,
    target: {
      playerId: targetPlayer.playerId,
      name: targetPlayer.name,
      team: targetPlayer.team,
      positionRank: chosen.positionRank,
      positionalWar: chosen.war,
    },
    fellBackFrom: skippedRank !== null ? { positionRank: skippedRank } : null,
    winsDelta: after.expectedWins - before.expectedWins,
    playoffOddsDeltaPoints: asPoints(after.playoffOdds - before.playoffOdds),
    titleOddsDeltaPoints: asPoints(after.titleOdds - before.titleOdds),
    droppedPlayerName: swap.dropCost?.name ?? null,
  };

  return { ok: true, result };
}
