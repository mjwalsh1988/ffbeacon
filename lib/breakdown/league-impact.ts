/**
 * "Which of these two actually helps MY team?"
 *
 * A generic comparison answers who is the better player. It cannot answer the
 * question a manager is really asking, because two players with near-identical
 * value can do completely different things to one specific roster. A third
 * running back who never cracks your lineup is worth nothing to you this year;
 * a boring tight end who displaces a replacement-level starter for nine weeks is
 * worth a lot. The gap between those two answers is the whole point of this file.
 *
 * The method is the one the FAAB calculator already uses, run twice:
 *   1. Project every roster in the league under the league's OWN scoring.
 *   2. Build the reader's optimal lineup for every remaining week as it stands.
 *   3. Add candidate A, rebuild, measure. Then the same for candidate B.
 *   4. Simulate the season three times (as-is, with A, with B) for playoff odds.
 *
 * READ ONLY, ALWAYS. This is a hypothetical about a roster that does not exist.
 * It never writes, never stamps the Power Pulse cache, and never syncs matchups.
 * A league with no stored schedule loses playoff odds and says so, rather than
 * reaching out to Sleeper from a comparison tool.
 *
 * SHARED WORK. Both candidates are measured against the same projected league,
 * so the expensive half (loading and projecting every roster) happens once. Only
 * the lineup swap and one extra simulation are per-candidate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { closestScoringBase, describeLeagueScoring } from "@/lib/league-scoring";
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
import { loadPowerPulseSettings, type PowerPulseSettings } from "@/lib/power-pulse/settings";
import { simulateSeason, type SimTeam } from "@/lib/power-pulse/simulate";
import {
  buildOptimalLineup,
  lineupSigma,
  startingSlots,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import { computeLineupSwap, type CandidateWeek } from "@/lib/faab/marginal";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import type { LeagueImpact } from "./metrics";

type ServiceClient = SupabaseClient<Database>;

/**
 * Monte Carlo runs for the odds delta.
 *
 * Three simulations run per comparison rather than the usual two, so this is
 * deliberately lighter than the Power Pulse page's own count. The seed is fixed
 * (shared with Power Pulse) so the same comparison always returns the same odds
 * instead of drifting on every refresh.
 */
const SIMULATION_RUNS = 2000;

export type LeagueImpactInput = {
  leagueRowId: string;
  sleeperRosterId: number;
  /** Sleeper ids of the two players being compared, in slot order. */
  candidateSleeperIds: [string | null, string | null];
};

export type LeagueImpactReport = {
  league: {
    sleeperLeagueId: string;
    name: string;
    season: number;
    teams: number;
    currentWeek: number;
    lastRegularWeek: number;
    scoringDescription: string;
    /** True when the league's own scoring settings drove the projections. */
    usedLeagueScoring: boolean;
  };
  team: {
    rosterId: number;
    name: string;
    record: string;
  };
  /** Impact per slot. Null when we could not measure that player here. */
  impacts: [LeagueImpact | null, LeagueImpact | null];
  /** Anything the reader needs told plainly rather than inferred. */
  notices: string[];
};

export type LeagueImpactOutcome =
  | { ok: true; report: LeagueImpactReport }
  | { ok: false; error: string };

type RosterWeeks = Map<number, LineupCandidate[]>;

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

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
  pulseSettings: PowerPulseSettings;
}): {
  byWeek: RosterWeeks;
  meta: Map<string, { name: string; position: string }>;
  usedLeagueScoring: boolean;
} {
  // IR and taxi players cannot start, so they are neither lineup candidates nor
  // drop candidates: cutting them frees nothing that matters here.
  const ineligible = new Set([...roster.reserveSleeperIds, ...roster.taxiSleeperIds]);
  const rosterPlayers = roster.playerSleeperIds
    .filter((sid) => !ineligible.has(sid))
    .map((sid) => players.get(sid))
    .filter((p): p is PlayerRow => Boolean(p));

  const meta = new Map<string, { name: string; position: string }>();
  const byWeek: RosterWeeks = new Map();
  for (const week of weeks) byWeek.set(week, []);
  let usedLeagueScoring = false;

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
      usedLeagueScoring = usedLeagueScoring || projected.usedLeagueScoring;
      byWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points,
        sigma: projected.sigma,
      });
    }
  }

  return { byWeek, meta, usedLeagueScoring };
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

/** Optimal lineup total and spread for one week, for rosters we do not swap. */
function lineupTotals(
  slots: string[],
  candidates: LineupCandidate[],
): { mean: number; sigma: number } {
  const lineup = buildOptimalLineup(slots, candidates);
  return { mean: lineup.total, sigma: lineupSigma(lineup.slots) };
}

export async function calculateLeagueImpact(
  supabase: ServiceClient,
  input: LeagueImpactInput,
): Promise<LeagueImpactOutcome> {
  const league = await loadLeague(supabase, input.leagueRowId);
  if (!league) return { ok: false, error: "We do not have this league synced yet." };

  const rosters = await loadRosters(supabase, input.leagueRowId);
  if (rosters.length === 0) {
    return { ok: false, error: "We hold no rosters for this league yet." };
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

  const candidateIds = input.candidateSleeperIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (candidateIds.length === 0) {
    return { ok: false, error: "Neither player has a Sleeper id we can match." };
  }

  const rosteredSleeperIds = new Set(rosters.flatMap((r) => r.playerSleeperIds));
  const allSleeperIds = Array.from(new Set([...rosteredSleeperIds, ...candidateIds]));
  const players = await loadPlayers(supabase, allSleeperIds);

  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = defenseSeasonsFor(league.season);
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  const pulseSettings = await loadPowerPulseSettings(supabase);

  // The projection source is resolved, never assumed. See
  // resolveProjectionSourceForWindow in lib/projections/source.ts: it makes no
  // query while the FF Beacon projection engine is disabled, and the day it is
  // enabled this surface moves onto our own numbers with every other one
  // instead of being the odd screen still quoting Sleeper's.
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek: currentWeek,
    settings: pulseSettings.beaconProjections,
  });

  const [projectionRows, accuracy, defense, schedule] = await Promise.all([
    loadProjections(supabase, playerIds, league.season, currentWeek, undefined, projectionSource),
    loadAccuracy(supabase, playerIds, scoringBase, projectionSource),
    loadDefenseSplits(supabase, scoringBase, defenseSeasons),
    loadSchedule(supabase, input.leagueRowId, league.season),
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

  // ---- every roster, projected once ---------------------------------------
  const rosterWeeksById = new Map<number, RosterWeeks>();
  const rosterMetaById = new Map<number, Map<string, { name: string; position: string }>>();
  let usedLeagueScoring = false;
  for (const roster of rosters) {
    const built = buildRosterWeeks({ roster, ...projectArgs });
    rosterWeeksById.set(roster.sleeperRosterId, built.byWeek);
    rosterMetaById.set(roster.sleeperRosterId, built.meta);
    usedLeagueScoring = usedLeagueScoring || built.usedLeagueScoring;
  }

  // ---- the league as it stands, for the "before" odds ----------------------
  const weeklyBefore = new Map<number, Map<number, { mean: number; sigma: number }>>();
  for (const roster of rosters) {
    const byWeek = rosterWeeksById.get(roster.sleeperRosterId) ?? new Map();
    const weekMap = new Map<number, { mean: number; sigma: number }>();
    for (const week of weeks) weekMap.set(week, lineupTotals(slots, byWeek.get(week) ?? []));
    weeklyBefore.set(roster.sleeperRosterId, weekMap);
  }

  const upcoming = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );
  const simOptions = {
    runs: SIMULATION_RUNS,
    seed: pulseSettings.simulation.seed,
    playoffTeams: league.playoffTeams,
    playoffWeekStart: league.playoffWeekStart,
  };

  let oddsBefore: { playoff: number; title: number; wins: number } | null = null;
  if (upcoming.length > 0) {
    const before = simulateSeason(simTeamsFrom(rosters, weeklyBefore), upcoming, simOptions);
    const b = before.get(mine.sleeperRosterId);
    if (b) oddsBefore = { playoff: b.playoffOdds, title: b.titleOdds, wins: b.expectedWins };
  }

  // Sleeper's roster_positions carries every slot including bench, so its length
  // is the roster limit. At the limit, adding anyone means cutting someone.
  const rosterFull = mine.playerSleeperIds.length >= league.rosterPositions.length;
  const myWeeks: RosterWeeks = rosterWeeksById.get(mine.sleeperRosterId) ?? new Map();
  const myMeta: Map<string, { name: string; position: string }> =
    rosterMetaById.get(mine.sleeperRosterId) ?? new Map();
  const notices: string[] = [];

  function impactFor(sleeperId: string | null): LeagueImpact | null {
    if (!sleeperId) return null;
    const candidate = players.get(sleeperId);
    if (!candidate) return null;

    const alreadyMine = mine!.playerSleeperIds.includes(sleeperId);
    const holder = rosters.find((r) => r.playerSleeperIds.includes(sleeperId));

    const acc = accuracy.get(candidate.playerId) ?? null;
    const rel = reliabilityMultiplier(acc, pulseSettings);
    const candidateByWeek = new Map<number, CandidateWeek>();
    for (const week of weeks) {
      const projected = projectPlayerWeek({
        projection: projections.get(candidate.playerId)?.get(week),
        subject: candidate,
        accuracy: acc,
        reliability: rel,
        scoringSettings: league!.scoringSettings,
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
    if (candidateByWeek.size === 0) return null;

    // A player already on the roster is measured as "what would I lose without
    // him", so the reader gets a comparable number instead of a flat zero. His
    // own rows are stripped from the baseline and he is added back, which is
    // exactly the same swap run from the other direction.
    const baselineWeeks: RosterWeeks = alreadyMine
      ? new Map(
          [...myWeeks.entries()].map(([week, list]) => [
            week,
            list.filter((c) => c.playerId !== candidate.playerId),
          ]),
        )
      : myWeeks;

    const swap = computeLineupSwap({
      slots,
      weeks,
      rosterByWeek: baselineWeeks,
      candidateByWeek,
      candidatePlayerId: candidate.playerId,
      candidatePosition: candidate.position as PulsePosition,
      rosterMeta: myMeta,
      // Adding someone you already roster costs no roster spot.
      mustDrop: rosterFull && !alreadyMine,
    });

    let playoffAfter: number | null = null;
    let titleAfter: number | null = null;
    let winsAfter: number | null = null;
    // The odds a delta is measured FROM must be the same scenario the lineup
    // gain was measured from. For a free agent that is the league as it stands,
    // already simulated once above. For a player the reader ALREADY rosters, the
    // swap measured against a baseline with him removed, so comparing its result
    // to the full-roster odds would report a gain of roughly zero next to a
    // clearly positive points-per-week: two numbers describing two different
    // questions. That case gets its own before-simulation.
    let candidateOddsBefore = oddsBefore;
    if (upcoming.length > 0) {
      if (alreadyMine) {
        const weeklyStripped = new Map(weeklyBefore);
        weeklyStripped.set(mine!.sleeperRosterId, swap.weeklyBefore);
        const stripped = simulateSeason(
          simTeamsFrom(rosters, weeklyStripped),
          upcoming,
          simOptions,
        );
        const s = stripped.get(mine!.sleeperRosterId);
        candidateOddsBefore = s
          ? { playoff: s.playoffOdds, title: s.titleOdds, wins: s.expectedWins }
          : null;
      }

      // Shallow copy on purpose: only this roster's week map is replaced, every
      // other roster keeps pointing at the shared, unmutated inner map, so one
      // candidate's simulation cannot contaminate the other's.
      const weeklyAfter = new Map(weeklyBefore);
      weeklyAfter.set(mine!.sleeperRosterId, swap.weeklyAfter);
      const after = simulateSeason(simTeamsFrom(rosters, weeklyAfter), upcoming, simOptions);
      const r = after.get(mine!.sleeperRosterId);
      if (r) {
        playoffAfter = r.playoffOdds;
        titleAfter = r.titleOdds;
        winsAfter = r.expectedWins;
      }
    }

    return {
      netPointsPerWeek: swap.netPointsPerWeek,
      pointsPerStartedWeek: swap.pointsPerStartedWeek,
      weeksStarting: swap.weeksStarting,
      weeksConsidered: swap.weeksConsidered,
      isBenchOnly: swap.isBenchOnly,
      dropName: swap.dropCost?.name ?? null,
      dropCostPerWeek: swap.dropCost?.pointsPerWeek ?? null,
      playoffOddsBefore: candidateOddsBefore?.playoff ?? null,
      playoffOddsAfter: playoffAfter,
      titleOddsBefore: candidateOddsBefore?.title ?? null,
      titleOddsAfter: titleAfter,
      expectedWinsAdded:
        candidateOddsBefore != null && winsAfter != null
          ? winsAfter - candidateOddsBefore.wins
          : null,
      onYourRoster: alreadyMine,
      rosteredBy:
        holder && holder.sleeperRosterId !== mine!.sleeperRosterId ? holder.teamName : null,
      weeks: swap.weeks.map((w) => ({
        week: w.week,
        startsForYou: w.startsForYou,
        pointsAdded: w.pointsAdded,
      })),
    };
  }

  const impacts: [LeagueImpact | null, LeagueImpact | null] = [
    impactFor(input.candidateSleeperIds[0]),
    impactFor(input.candidateSleeperIds[1]),
  ];

  if (oddsBefore === null) {
    notices.push(
      "We hold no remaining schedule for this league, so the lineup numbers are here but the playoff odds are not.",
    );
  }
  if (!usedLeagueScoring) {
    notices.push(
      "This league's scoring settings were not complete enough to score against directly, so we used the closest standard scoring instead.",
    );
  }
  if (impacts[0] === null || impacts[1] === null) {
    notices.push(
      "We could only measure one of these two against your roster. The other has no weekly projections on file from here on.",
    );
  }
  if (rosterFull) {
    notices.push(
      "Your roster is full, so each number below is after cutting whoever costs you least.",
    );
  }

  const record = `${mine.wins}-${mine.losses}${mine.ties > 0 ? `-${mine.ties}` : ""}`;

  return {
    ok: true,
    report: {
      league: {
        sleeperLeagueId: league.sleeperLeagueId,
        name: league.name,
        season: league.season,
        teams: rosters.length,
        currentWeek,
        lastRegularWeek,
        scoringDescription: describeLeagueScoring(league.scoringSettings),
        usedLeagueScoring,
      },
      team: {
        rosterId: mine.sleeperRosterId,
        name: mine.teamName,
        record,
      },
      impacts,
      notices,
    },
  };
}
