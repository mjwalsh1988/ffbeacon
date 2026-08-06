/**
 * League mode: price a waiver bid against one specific roster.
 *
 * READ ONLY, ALWAYS. This is a "what if" question about a roster that does not
 * exist yet, so it must never write. In particular it never stamps the Power
 * Pulse cache and never triggers a recompute: that cache belongs to the real
 * roster, and a hypothetical must not be able to overwrite it. It also does not
 * sync matchups. If a league has no stored schedule we lose playoff odds and
 * say so, rather than reaching out to Sleeper from a calculator.
 *
 * The shape of the answer:
 *   1. Project every roster in the league, using the Power Pulse model.
 *   2. Swap the free agent onto the reader's roster and rebuild every lineup.
 *   3. Simulate the season twice, before and after, for playoff and title odds.
 *   4. Ask the same question of every rival roster, to learn who else wants him.
 *   5. Read the money: budgets, contested-ness, and what this league pays.
 *   6. Turn all of it into a walk-away / likely / aggressive ladder.
 */

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
  type AccuracyRow,
  type PlayerRow,
  type ProjectionRow,
  type RosterRow,
} from "@/lib/power-pulse/load";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { simulateSeason, type SimTeam } from "@/lib/power-pulse/simulate";
import {
  buildOptimalLineup,
  lineupSigma,
  startingSlots,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { computeLineupSwap, type CandidateWeek } from "./marginal";
import { buildSignals } from "./signals";
import { buildMarket, summarizeComparableBids } from "./market";
import { buildLadder } from "./ladder";
import {
  loadGameLogs,
  loadLeagueMoney,
  loadPositionalFinishes,
  loadTeamNames,
  loadWinningBids,
} from "./league-load";
import type {
  FaabConfidence,
  FaabSettings,
  LeagueFaabReport,
  MarginalValue,
  NeedLevel,
} from "./types";

type ServiceClient = SupabaseClient<Database>;

export type LeagueFaabInput = {
  leagueRowId: string;
  /** The reader's own Sleeper roster in this league. */
  sleeperRosterId: number;
  /** Sleeper id of the player being bid on. */
  candidateSleeperId: string;
  needLevel: NeedLevel;
  /** Overrides the budget we derive from Sleeper, when the reader edits it. */
  budgetOverride?: number | null;
  /**
   * Used only when the league publishes no FAAB budget through Sleeper, which
   * would otherwise leave every team on zero and price every bid at nothing.
   * The manual calculator's budget box is the sensible stand-in.
   */
  fallbackBudget?: number | null;
  settings: FaabSettings;
};

export type LeagueFaabOutcome =
  | { ok: true; report: LeagueFaabReport }
  | { ok: false; error: string };

/** Per-week projected points for one roster, ready for lineup building. */
type RosterWeeks = Map<number, LineupCandidate[]>;

function buildRosterWeeks({
  roster,
  players,
  accuracy,
  projections,
  weeks,
  currentWeek,
  scoringSettings,
  defense,
  defenseSeasons,
  pulseSettings,
}: {
  roster: RosterRow;
  players: Map<string, PlayerRow>;
  accuracy: Map<string, AccuracyRow>;
  projections: Map<string, Map<number, ProjectionRow>>;
  weeks: number[];
  currentWeek: number;
  scoringSettings: Parameters<typeof projectPlayerWeek>[0]["scoringSettings"];
  defense: Parameters<typeof projectPlayerWeek>[0]["defense"];
  defenseSeasons: number[];
  pulseSettings: Parameters<typeof projectPlayerWeek>[0]["settings"];
}): { byWeek: RosterWeeks; meta: Map<string, { name: string; position: string }> } {
  // IR and taxi players cannot start, so they are not lineup candidates and are
  // not drop candidates either: cutting them frees nothing that matters here.
  const ineligible = new Set([...roster.reserveSleeperIds, ...roster.taxiSleeperIds]);
  const rosterPlayers = roster.playerSleeperIds
    .filter((sid) => !ineligible.has(sid))
    .map((sid) => players.get(sid))
    .filter((p): p is PlayerRow => Boolean(p));

  const meta = new Map<string, { name: string; position: string }>();
  const byWeek: RosterWeeks = new Map();
  for (const week of weeks) byWeek.set(week, []);

  for (const player of rosterPlayers) {
    meta.set(player.playerId, { name: player.name, position: player.position });
    const acc = accuracy.get(player.playerId) ?? null;
    const reliability = reliabilityMultiplier(acc, pulseSettings);
    for (const week of weeks) {
      const projected = projectPlayerWeek({
        projection: projections.get(player.playerId)?.get(week),
        subject: player,
        accuracy: acc,
        reliability,
        scoringSettings,
        defense,
        defenseSeasons,
        week,
        currentWeek,
        settings: pulseSettings,
      });
      if (!projected) continue;
      byWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points,
        sigma: projected.sigma,
      });
    }
  }

  return { byWeek, meta };
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function simTeamsFrom(
  rosters: RosterRow[],
  weekly: Map<number, Map<number, { mean: number; sigma: number }>>,
): SimTeam[] {
  return rosters.map((roster) => {
    const weeks = weekly.get(roster.sleeperRosterId) ?? new Map();
    const means = [...weeks.values()].map((w) => w.mean);
    const sigmas = [...weeks.values()].map((w) => w.sigma);
    return {
      sleeperRosterId: roster.sleeperRosterId,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: roster.pointsFor,
      weeks,
      mean: meanOf(means),
      sigma: meanOf(sigmas),
    };
  });
}

export async function calculateLeagueFaab(
  supabase: ServiceClient,
  input: LeagueFaabInput,
): Promise<LeagueFaabOutcome> {
  const { settings } = input;

  const league = await loadLeague(supabase, input.leagueRowId);
  if (!league) return { ok: false, error: "We do not have this league synced yet." };

  const rosters = await loadRosters(supabase, input.leagueRowId);
  if (rosters.length === 0) {
    return { ok: false, error: "We have no rosters stored for this league yet." };
  }

  const mine = rosters.find((r) => r.sleeperRosterId === input.sleeperRosterId);
  if (!mine) return { ok: false, error: "We could not find your team in this league." };

  const nflState = await getNflState();
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  const lastRegularWeek = Math.max(currentWeek, league.playoffWeekStart - 1);

  const weeks: number[] = [];
  for (let w = currentWeek; w <= lastRegularWeek; w += 1) weeks.push(w);
  if (weeks.length === 0) {
    return { ok: false, error: "This league's regular season is already over." };
  }

  // ---- who is on a roster, and is our man among them? ---------------------
  const rosteredSleeperIds = new Set(rosters.flatMap((r) => r.playerSleeperIds));
  const allSleeperIds = Array.from(
    new Set([...rosteredSleeperIds, input.candidateSleeperId]),
  );
  const players = await loadPlayers(supabase, allSleeperIds);

  const candidate = players.get(input.candidateSleeperId);
  if (!candidate) {
    return {
      ok: false,
      error: "We do not have weekly data for this player, so we cannot price him here.",
    };
  }

  const holder = rosters.find((r) => r.playerSleeperIds.includes(input.candidateSleeperId));
  const teamNames = await loadTeamNames(supabase, input.leagueRowId);

  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = [league.season - 1, league.season - 2];
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  const pulseSettings = await loadPowerPulseSettings(supabase);

  const [projectionRows, accuracy, defense, schedule, money] = await Promise.all([
    loadProjections(supabase, playerIds, league.season, currentWeek),
    loadAccuracy(supabase, playerIds, scoringBase),
    loadDefenseSplits(supabase, scoringBase, defenseSeasons),
    loadSchedule(supabase, input.leagueRowId, league.season),
    loadLeagueMoney(supabase, input.leagueRowId),
  ]);

  const projections = new Map<string, Map<number, ProjectionRow>>();
  for (const row of projectionRows) {
    const byWeek = projections.get(row.playerId) ?? new Map<number, ProjectionRow>();
    byWeek.set(row.week, row);
    projections.set(row.playerId, byWeek);
  }

  const slots = startingSlots(league.rosterPositions);
  if (slots.length === 0) {
    return { ok: false, error: "We could not read this league's starting lineup shape." };
  }

  const projectArgs = {
    players,
    accuracy,
    projections,
    weeks,
    currentWeek,
    scoringSettings: league.scoringSettings,
    defense,
    defenseSeasons,
    pulseSettings,
  };

  // ---- the candidate, projected on exactly the same terms ------------------
  const candidateAccuracy = accuracy.get(candidate.playerId) ?? null;
  const candidateReliability = reliabilityMultiplier(candidateAccuracy, pulseSettings);
  const candidateByWeek = new Map<number, CandidateWeek>();
  for (const week of weeks) {
    const projected = projectPlayerWeek({
      projection: projections.get(candidate.playerId)?.get(week),
      subject: candidate,
      accuracy: candidateAccuracy,
      reliability: candidateReliability,
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

  if (candidateByWeek.size === 0) {
    return {
      ok: false,
      error: `We have no weekly projections stored for ${candidate.name} from week ${currentWeek} on, so there is nothing to measure against your roster.`,
    };
  }

  // ---- every roster, projected --------------------------------------------
  const rosterWeeksById = new Map<number, RosterWeeks>();
  const rosterMetaById = new Map<number, Map<string, { name: string; position: string }>>();
  for (const roster of rosters) {
    const built = buildRosterWeeks({ roster, ...projectArgs });
    rosterWeeksById.set(roster.sleeperRosterId, built.byWeek);
    rosterMetaById.set(roster.sleeperRosterId, built.meta);
  }

  // ---- the swap, on the reader's roster ------------------------------------
  // Sleeper's roster_positions carries every slot including bench, so its length
  // is the roster limit. At the limit, adding him means cutting someone.
  const mustDrop = mine.playerSleeperIds.length >= league.rosterPositions.length;

  const swap = computeLineupSwap({
    slots,
    weeks,
    rosterByWeek: rosterWeeksById.get(mine.sleeperRosterId) ?? new Map(),
    candidateByWeek,
    candidatePlayerId: candidate.playerId,
    candidatePosition: candidate.position as PulsePosition,
    rosterMeta: rosterMetaById.get(mine.sleeperRosterId) ?? new Map(),
    mustDrop,
  });

  // ---- playoff odds, before and after --------------------------------------
  const weeklyBefore = new Map<number, Map<number, { mean: number; sigma: number }>>();
  for (const roster of rosters) {
    const byWeek = rosterWeeksById.get(roster.sleeperRosterId) ?? new Map();
    const weekMap = new Map<number, { mean: number; sigma: number }>();
    if (roster.sleeperRosterId === mine.sleeperRosterId) {
      for (const [week, value] of swap.weeklyBefore) weekMap.set(week, value);
    } else {
      for (const week of weeks) {
        const lineup = buildLineupTotals(slots, byWeek.get(week) ?? []);
        weekMap.set(week, lineup);
      }
    }
    weeklyBefore.set(roster.sleeperRosterId, weekMap);
  }

  const weeklyAfter = new Map(weeklyBefore);
  weeklyAfter.set(mine.sleeperRosterId, swap.weeklyAfter);

  const upcoming = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );

  let oddsBefore: { playoff: number; title: number; wins: number } | null = null;
  let oddsAfter: { playoff: number; title: number; wins: number } | null = null;

  if (upcoming.length > 0) {
    const simOptions = {
      runs: settings.marginal.simulationRuns,
      seed: pulseSettings.simulation.seed,
      playoffTeams: league.playoffTeams,
      playoffWeekStart: league.playoffWeekStart,
    };
    const before = simulateSeason(simTeamsFrom(rosters, weeklyBefore), upcoming, simOptions);
    const after = simulateSeason(simTeamsFrom(rosters, weeklyAfter), upcoming, simOptions);
    const b = before.get(mine.sleeperRosterId);
    const a = after.get(mine.sleeperRosterId);
    if (b) oddsBefore = { playoff: b.playoffOdds, title: b.titleOdds, wins: b.expectedWins };
    if (a) oddsAfter = { playoff: a.playoffOdds, title: a.titleOdds, wins: a.expectedWins };
  }

  const marginal: MarginalValue = {
    weeksConsidered: swap.weeksConsidered,
    weeksStarting: swap.weeksStarting,
    pointsPerWeek: swap.pointsPerWeek,
    pointsPerStartedWeek: swap.pointsPerStartedWeek,
    netPointsPerWeek: swap.netPointsPerWeek,
    expectedWinsAdded:
      oddsBefore && oddsAfter ? oddsAfter.wins - oddsBefore.wins : null,
    playoffOddsBefore: oddsBefore?.playoff ?? null,
    playoffOddsAfter: oddsAfter?.playoff ?? null,
    titleOddsBefore: oddsBefore?.title ?? null,
    titleOddsAfter: oddsAfter?.title ?? null,
    weeks: swap.weeks,
    dropCost: swap.dropCost,
    isBenchOnly: swap.isBenchOnly,
  };

  // ---- how many rivals actually want him -----------------------------------
  // No drop search for rivals: we only need to know whether he cracks their
  // lineup, and pricing their bench is not our business.
  let interestedRivals: number | null = null;
  let rivalsChecked: number | null = null;
  if (settings.market.rivalNeed.enabled) {
    let interested = 0;
    let checked = 0;
    for (const roster of rosters) {
      if (roster.sleeperRosterId === mine.sleeperRosterId) continue;
      checked += 1;
      const rivalSwap = computeLineupSwap({
        slots,
        weeks,
        rosterByWeek: rosterWeeksById.get(roster.sleeperRosterId) ?? new Map(),
        candidateByWeek,
        candidatePlayerId: candidate.playerId,
        candidatePosition: candidate.position as PulsePosition,
        rosterMeta: rosterMetaById.get(roster.sleeperRosterId) ?? new Map(),
        mustDrop: false,
      });
      if (rivalSwap.netPointsPerWeek >= settings.market.rivalNeed.minPointsPerWeek) {
        interested += 1;
      }
    }
    interestedRivals = interested;
    rivalsChecked = checked;
  }

  // ---- the money -----------------------------------------------------------
  const myBudgetRow = money.budgets.find((b) => b.sleeperRosterId === mine.sleeperRosterId);
  const derivedBudget = myBudgetRow?.remaining ?? 0;
  const fallbackBudget =
    input.fallbackBudget != null && Number.isFinite(input.fallbackBudget)
      ? Math.max(0, Math.floor(input.fallbackBudget))
      : 0;
  const yourBudget =
    input.budgetOverride != null && Number.isFinite(input.budgetOverride)
      ? Math.max(0, Math.floor(input.budgetOverride))
      : money.totalBudget !== null
        ? derivedBudget
        : fallbackBudget;

  const rivalBudgets = money.budgets
    .filter((b) => b.sleeperRosterId !== mine.sleeperRosterId)
    .map((b) => b.remaining);

  const seasons: number[] = [];
  for (let s = 0; s < settings.market.history.lookbackSeasons; s += 1) {
    seasons.push(league.season - s);
  }
  const bids = settings.market.history.enabled
    ? await loadWinningBids(supabase, input.leagueRowId, seasons)
    : [];
  const comparable = summarizeComparableBids(bids, settings.market.history.minSamples);

  const market = buildMarket({
    yourBudget,
    rivalBudgets: money.totalBudget === null ? [] : rivalBudgets,
    interestedRivals,
    rivalsChecked,
    comparable,
    currentWeek,
    lastRegularWeek,
    settings: settings.market,
  });

  // ---- the player reads ----------------------------------------------------
  const [gameLogs, finishes] = await Promise.all([
    loadGameLogs(supabase, candidate.playerId, league.season),
    settings.signals.ceiling.enabled
      ? loadPositionalFinishes(
          supabase,
          candidate.playerId,
          scoringBase,
          league.season - settings.signals.ceiling.lookbackSeasons,
        )
      : Promise.resolve([]),
  ]);

  const playerSignals = buildSignals({
    position: candidate.position,
    accuracy: candidateAccuracy
      ? {
          beatRate: candidateAccuracy.beatRate,
          availabilityRate: candidateAccuracy.availabilityRate,
          ratioStdev: candidateAccuracy.ratioStdev,
          weeksPlayed: candidateAccuracy.weeksPlayed,
        }
      : null,
    gameLogs,
    weeks: swap.weeks,
    positionalFinishes: finishes,
    currentSeason: league.season,
    settings: settings.signals,
  });

  // ---- how sure are we? ----------------------------------------------------
  const confidence = gradeConfidence({
    accuracyWeeks: candidateAccuracy?.weeksPlayed ?? 0,
    hasOdds: oddsBefore !== null,
    hasSnapData: gameLogs.some((g) => g.snapPct !== null),
    weeksProjected: candidateByWeek.size,
  });

  const ladder = buildLadder({
    marginal,
    playerSignals,
    marketSignals: market.signals,
    market: market.read,
    remainingBudget: yourBudget,
    needLevel: input.needLevel,
    settings,
    confidence,
  });

  const notices = [...ladder.notices];
  if (money.totalBudget === null) {
    notices.push(
      "This league does not publish a FAAB budget through Sleeper, so we could not read anyone's remaining money. The bid below is priced on the roster upgrade alone.",
    );
  }
  if (oddsBefore === null) {
    notices.push(
      "We have no stored schedule for the rest of this season, so this bid is priced on lineup points only, without playoff odds.",
    );
  }

  return {
    ok: true,
    report: {
      league: {
        sleeperLeagueId: league.sleeperLeagueId,
        name: league.name,
        season: league.season,
        teams: rosters.length,
        rosterId: mine.sleeperRosterId,
        teamName: teamNames.get(mine.sleeperRosterId) ?? `Team ${mine.sleeperRosterId}`,
        currentWeek,
      },
      player: {
        playerId: candidate.playerId,
        sleeperId: candidate.sleeperId,
        name: candidate.name,
        position: candidate.position,
        team: candidate.team,
        injuryStatus: candidate.injuryStatus,
      },
      availability: holder ? "rostered" : "free",
      rosteredBy: holder
        ? (teamNames.get(holder.sleeperRosterId) ?? `Team ${holder.sleeperRosterId}`)
        : null,
      marginal,
      signals: [...playerSignals, ...market.signals],
      market: market.read,
      ladder: ladder.ladder,
      aggressionLabel: ladder.aggressionLabel,
      isDumpCandidate: ladder.isDumpCandidate,
      headline: ladder.headline,
      explanation: ladder.explanation,
      notices,
      confidence,
    },
  };
}

/** Optimal lineup total and spread for one week, for the rosters we do not swap. */
function buildLineupTotals(
  slots: string[],
  candidates: LineupCandidate[],
): { mean: number; sigma: number } {
  const lineup = buildOptimalLineup(slots, candidates);
  return { mean: lineup.total, sigma: lineupSigma(lineup.slots) };
}

/**
 * How much to trust this answer.
 *
 * Said out loud rather than buried, because in September almost every one of
 * these is a thin read and a confident-looking number would be a lie.
 */
function gradeConfidence({
  accuracyWeeks,
  hasOdds,
  hasSnapData,
  weeksProjected,
}: {
  accuracyWeeks: number;
  hasOdds: boolean;
  hasSnapData: boolean;
  weeksProjected: number;
}): FaabConfidence {
  let score = 0;
  if (accuracyWeeks >= 8) score += 2;
  else if (accuracyWeeks >= 4) score += 1;
  if (hasOdds) score += 1;
  if (hasSnapData) score += 1;
  if (weeksProjected >= 4) score += 1;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}
