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
import {
  LONG_TERM_INJURY_STATUSES,
  projectPlayerWeek,
  reliabilityMultiplier,
} from "@/lib/power-pulse/project";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { simulateWithReplacements } from "@/lib/power-pulse/what-if";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import {
  buildOptimalLineup,
  lineupSigma,
  startingSlots,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import {
  computeLineupSwap,
  type CandidateWeek,
  type RosterMetaEntry,
} from "./marginal";
import { loadPositionalWarView } from "@/lib/league-positional-war-data";
import { loadLeagueFreeAgents } from "./free-agents";
import { isChoppedLeague, resolveFinalWeek } from "@/lib/chopped/league";
import {
  computeChopped,
  loadAliveRosterIds,
  loadSeasonPoints,
  priceByAliveFraction,
} from "./league-chopped";
import { combinedMultiplier } from "./signals";
import { rosterIsFull } from "./roster";
import { buildSignals } from "./signals";
import { buildMarket } from "./market";
import { buildLadder, upgradeStrengthOf } from "./ladder";
import { buildReasons } from "./reasons";
import { simulateAuction, type AuctionRival } from "./auction";
import {
  biddersKey,
  choppedPhase,
  standardPhase,
  type PriorLeagueKind,
} from "./priors-build";
import { isSuperflexShape } from "./priors-load";
import { loadPriorCellsCached, pickCell } from "./priors-read";
import {
  computeLeagueTendencies,
  tendencyFor,
  tendencyLabel,
  type TendencyAuction,
} from "./tendency";
import {
  loadAuctionHistory,
  loadEliteValue,
  loadGameLogs,
  loadLeagueMoney,
  loadLeagueValueContext,
  loadPlayerValues,
  loadPositionalFinishes,
  loadPulseRank,
  loadRecentPointsPerGame,
  loadTeamDepth,
  loadTeamNames,
  starterAheadOf,
} from "./league-load";
import { classifyTeamStatus } from "@/lib/league-team-status";
import type {
  FaabConfidence,
  FaabSettings,
  GoalKey,
  LeagueFaabReport,
  MarginalValue,
  NeedLevel,
  RivalRow,
} from "./types";

type ServiceClient = SupabaseClient<Database>;

/**
 * How deep into the free agent list we look for a substitute. Forty covers
 * every startable player anybody would actually chase at one position, and
 * caps the projection read this adds to the chopped path.
 */
const SUBSTITUTE_POOL = 40;

/** Plain mean, for the substitute comparison. */
function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

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
  /** Which question the reader asked. Defaults to the admin's default goal. */
  goal?: GoalKey;
  /**
   * The value source the reader has chosen. Without it the cut guard and the
   * dynasty blend fall back to registry priority, which is how the calculator
   * ended up quoting one board while the page beside it quoted another.
   */
  sourceSlug?: string | null;
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
  faabInjury,
  ignoreInjuries = false,
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
  /** Whether a week-to-week OUT carries into the weeks after this one. */
  faabInjury: FaabSettings["injury"];
  /**
   * Project as if nobody were hurt. Used for the cut ranking only: a player on
   * IR projects zero every week, which makes the most valuable man on a roster
   * look like the cheapest one to release.
   */
  ignoreInjuries?: boolean;
}): { byWeek: RosterWeeks; meta: Map<string, RosterMetaEntry> } {
  // IR and taxi players cannot start, so they are not lineup candidates and are
  // not drop candidates either: cutting them frees nothing that matters here.
  const ineligible = new Set([...roster.reserveSleeperIds, ...roster.taxiSleeperIds]);
  const rosterPlayers = roster.playerSleeperIds
    .filter((sid) => !ineligible.has(sid))
    .map((sid) => players.get(sid))
    .filter((p): p is PlayerRow => Boolean(p));

  const meta = new Map<string, RosterMetaEntry>();
  // Disabling the whole injury block is the honest way to ask "what is he worth
  // when he plays": it drops the week-to-week haircuts as well as the season
  // ones, which is exactly the question the cut ranking is asking.
  const projectionSettings = ignoreInjuries
    ? { ...pulseSettings, injury: { ...pulseSettings.injury, enabled: false } }
    : pulseSettings;
  const byWeek: RosterWeeks = new Map();
  for (const week of weeks) byWeek.set(week, []);

  for (const player of rosterPlayers) {
    meta.set(player.playerId, {
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
        scoringSettings,
        defense,
        defenseSeasons,
        week,
        currentWeek,
        settings: projectionSettings,
      });
      if (!projected) continue;
      // The cut ranking asks "what is he worth when he plays", so it must not
      // see the carry either.
      const carry = ignoreInjuries
        ? 1
        : injuryCarryFactor({
            status: player.injuryStatus,
            week,
            currentWeek,
            availability: projections.get(player.playerId)?.get(week)?.availability,
            faabInjury,
            pulseSettings,
          });
      byWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points * carry,
        sigma: projected.sigma * carry,
      });
    }
  }

  return { byWeek, meta };
}

/**
 * Keep a player who is OUT this week out NEXT week too, where the source has
 * not already answered for that week.
 *
 * lib/power-pulse/project.ts applies a week-to-week designation to the
 * CURRENT week only (injuryMultiplier, the `week === currentWeek` line), and
 * carries forward only the long-term ones (IR, PUP, SUS and friends). That is
 * right for Power Pulse, which is projecting a whole season and should not
 * assume a hamstring lasts to Christmas. It is wrong for a FAAB bid, which is
 * mostly bought BECAUSE somebody is hurt: a starter ruled out on Tuesday came
 * back as fully healthy in week two of the same claim, and the upgrade the
 * reader was paying for quietly shrank.
 *
 * The carry stops the moment the source answers. `availability: "projected"`
 * means the feed published a real number for that week knowing what it knows,
 * so it has priced the injury in and nothing here knows better. This only
 * fills the silence.
 *
 * Scoped to this module on purpose: changing injuryMultiplier itself would
 * move Power Pulse, Lineups, Schedules and the Manager Ledger, which is a
 * separate decision. `settings.injury.carryOutFromSource` switches it off.
 */
const CARRIED_STATUSES = new Set(["OUT", "DOUBTFUL"]);

function injuryCarryFactor({
  status,
  week,
  currentWeek,
  availability,
  faabInjury,
  pulseSettings,
}: {
  status: string | null;
  week: number;
  currentWeek: number;
  availability: string | null | undefined;
  faabInjury: FaabSettings["injury"];
  pulseSettings: Parameters<typeof projectPlayerWeek>[0]["settings"];
}): number {
  if (!faabInjury.carryOutFromSource) return 1;
  if (week <= currentWeek) return 1;
  if (!pulseSettings.injury.enabled) return 1;
  const key = (status ?? "").toUpperCase();
  if (!CARRIED_STATUSES.has(key)) return 1;
  // Long-term designations are already carried by the shared model.
  if (LONG_TERM_INJURY_STATUSES.has(key)) return 1;
  // The source published a real number for this week. It answered.
  if (availability === "projected") return 1;
  const multiplier = pulseSettings.injury.multipliers[key];
  return typeof multiplier === "number" && Number.isFinite(multiplier) ? multiplier : 1;
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

  // The money is read here rather than with the other loaders below because
  // it carries Sleeper's league type, and whether this is a chopped league
  // decides which weeks we even project: a chopped season has no playoff
  // week to stop at, it runs until one team is left.
  const money = await loadLeagueMoney(supabase, input.leagueRowId);
  const chopped = isChoppedLeague({
    type: money.sleeperType,
    disable_elimination: 0,
  });
  const aliveIds = chopped
    ? await loadAliveRosterIds(supabase, input.leagueRowId)
    : rosters.map((r) => r.sleeperRosterId);
  const aliveSet = new Set(aliveIds);

  if (chopped && !aliveSet.has(mine.sleeperRosterId)) {
    return {
      ok: false,
      error: "Your team has been chopped in this league, so there is nothing left to bid on.",
    };
  }

  const nflState = await getNflState();
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  const choppedFinal = resolveFinalWeek(currentWeek, aliveIds.length);
  const lastRegularWeek = chopped
    ? Math.max(currentWeek, choppedFinal.finalWeek)
    : Math.max(currentWeek, league.playoffWeekStart - 1);

  const weeks: number[] = [];
  for (let w = currentWeek; w <= lastRegularWeek; w += 1) weeks.push(w);
  if (weeks.length === 0) {
    return { ok: false, error: "This league's regular season is already over." };
  }

  // ---- the playoff weeks ---------------------------------------------------
  // The old model stopped at the last regular season week, so a player added
  // in week 10 was priced on four weeks when he will actually play seven, and
  // the three that decide the title counted for nothing.
  //
  // They are added here and WEIGHTED by the chance of playing them, which is
  // filled in below once the odds are known. Counting them in full would
  // price every roster as though it were already in the bracket.
  const playoffWeeks: number[] = [];
  if (!chopped && settings.playoffValue.enabled) {
    const rounds = playoffRoundCount(league.playoffTeams, league.playoffRoundType);
    for (let i = 0; i < rounds; i += 1) {
      const week = league.playoffWeekStart + i;
      if (week > lastRegularWeek && week <= 18) playoffWeeks.push(week);
    }
  }
  const allWeeks = [...weeks, ...playoffWeeks];

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

  const [projectionRows, accuracy, defense, schedule, valueContext, seasonPoints] =
    await Promise.all([
      loadProjections(supabase, playerIds, league.season, currentWeek, undefined, projectionSource),
      loadAccuracy(supabase, playerIds, scoringBase, projectionSource),
      loadDefenseSplits(supabase, scoringBase, defenseSeasons),
      // A chopped league has no head-to-head question to answer, so the
      // schedule is not read for one. Sleeper publishes placeholder matchup
      // ids for chopped leagues and the old model turned them into a playoff
      // race that does not exist.
      chopped
        ? Promise.resolve({ weeks: [], setLineups: new Map<string, string[]>() })
        : loadSchedule(supabase, input.leagueRowId, league.season),
      loadLeagueValueContext(supabase, input.leagueRowId),
      chopped ? loadSeasonPoints(supabase, input.leagueRowId) : Promise.resolve(new Map()),
    ]);

  // Priced on the board that matches this league, so a dynasty roster and a
  // redraft roster get the two different answers they should get about what an
  // injured star is worth. Only the reader's own roster plus the candidate,
  // because only the reader is being told to cut anybody.
  const mineWithCandidate = Array.from(
    new Set(
      [...mine.playerSleeperIds, input.candidateSleeperId]
        .map((sid) => players.get(sid)?.playerId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const playerValues =
    settings.dropGuard.enabled || settings.dynastyValue.enabled
      ? await loadPlayerValues(
          supabase,
          valueContext.formatConfigId,
          mineWithCandidate,
          input.sourceSlug ?? null,
        )
      : new Map<string, number>();

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
    // Every week we might price, playoff weeks included. They are weighted
    // down later by the chance of actually playing them.
    weeks: allWeeks,
    currentWeek,
    scoringSettings: league.scoringSettings,
    defense,
    defenseSeasons,
    pulseSettings,
    faabInjury: settings.injury,
  };

  // ---- the candidate, projected on exactly the same terms ------------------
  const candidateAccuracy = accuracy.get(candidate.playerId) ?? null;
  const candidateReliability = reliabilityMultiplier(candidateAccuracy, pulseSettings);
  const candidateByWeek = new Map<number, CandidateWeek>();
  for (const week of allWeeks) {
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
    const candidateCarry = injuryCarryFactor({
      status: candidate.injuryStatus,
      week,
      currentWeek,
      availability: projections.get(candidate.playerId)?.get(week)?.availability,
      faabInjury: settings.injury,
      pulseSettings,
    });
    candidateByWeek.set(week, {
      points: projected.points * candidateCarry,
      sigma: projected.sigma * candidateCarry,
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
  // Only the ACTIVE squad counts against the limit. Sleeper's players array
  // holds reserve and taxi ids too, and counting those forced a phantom cut on
  // a fifth of the rosters carrying an injured player. See lib/faab/roster.ts.
  const mustDrop = rosterIsFull(mine, league.rosterPositions);

  // A second projection pass over ONE roster, the reader's, with injuries
  // switched off. It never touches the lineup math or the simulation; it only
  // ranks who is cheapest to release. Skipped entirely when no cut is required.
  const healthyRosterByWeek =
    mustDrop && settings.dropGuard.enabled && settings.dropGuard.useHealthyBaseline
      ? buildRosterWeeks({ roster: mine, ...projectArgs, ignoreInjuries: true }).byWeek
      : undefined;

  const swapArgs = {
    slots,
    weeks: allWeeks,
    rosterByWeek: rosterWeeksById.get(mine.sleeperRosterId) ?? new Map(),
    candidateByWeek,
    candidatePlayerId: candidate.playerId,
    candidatePosition: candidate.position as PulsePosition,
    rosterMeta: rosterMetaById.get(mine.sleeperRosterId) ?? new Map(),
    mustDrop,
    healthyRosterByWeek,
    rosterValues: playerValues,
    candidateValue: playerValues.get(candidate.playerId) ?? null,
    isKeeperLeague: valueContext.isKeeperLeague,
    dropGuard: settings.dropGuard,
  };

  // First pass, every week counted equally. The playoff weeks are reweighted
  // below, once we know the chance of playing them.
  let swap = computeLineupSwap(swapArgs);

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

  const upcoming = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );

  let oddsBefore: { playoff: number; title: number; wins: number } | null = null;
  let oddsAfter: { playoff: number; title: number; wins: number } | null = null;

  // One roster changes: mine, with the signing made and the cut applied. The
  // shared what-if runner returns null when there is nothing left to play, which
  // is the same "no odds available" case the old inline guard covered.
  //
  // Never run for a chopped league. There is no schedule, no opponent and no
  // bracket: the whole league is the opponent and the model is survival, in
  // computeChopped below.
  const simulated = chopped
    ? null
    : simulateWithReplacements({
        rosters,
        baseline: weeklyBefore,
        replacements: new Map([[mine.sleeperRosterId, swap.weeklyAfter]]),
        upcoming,
        options: {
          runs: settings.marginal.simulationRuns,
          seed: pulseSettings.simulation.seed,
          playoffTeams: league.playoffTeams,
          playoffWeekStart: league.playoffWeekStart,
          playoffRoundType: league.playoffRoundType,
          medianMatch: league.medianMatch,
        },
      });

  // UNITS. The simulator answers in a 0-to-1 probability; every consumer of
  // MarginalValue in this module reads percentage POINTS. The ladder compares
  // playoff odds against thresholds written as points (a 12-point swing is the
  // empty-the-clip bar, a team under 5 is already cooked), and the page prints
  // the number with a percent sign after it. Handing those a fraction printed
  // "0%" on every bid, marked every reader as mathematically eliminated, and
  // silently zeroed the odds half of the upgrade score, which is half the
  // recommendation by default. The conversion belongs here, once, at the only
  // point where the two scales meet.
  const asPoints = (odds: number) => odds * 100;

  if (simulated) {
    const b = simulated.before.get(mine.sleeperRosterId);
    const a = simulated.after.get(mine.sleeperRosterId);
    if (b) {
      oddsBefore = {
        playoff: asPoints(b.playoffOdds),
        title: asPoints(b.titleOdds),
        wins: b.expectedWins,
      };
    }
    if (a) {
      oddsAfter = {
        playoff: asPoints(a.playoffOdds),
        title: asPoints(a.titleOdds),
        wins: a.expectedWins,
      };
    }
  }

  // ---- reweight the playoff weeks -----------------------------------------
  // A week 15 start is worth everything to a team that will be playing that
  // week and nothing to one that will not, so each playoff week counts by the
  // chance of reaching it. The swap is recomputed rather than adjusted after
  // the fact, because the weighting belongs inside the per-week average; the
  // weekly distributions are unchanged, so the simulation above still stands.
  if (playoffWeeks.length > 0 && oddsBefore !== null) {
    const reachOdds = Math.min(1, Math.max(0, oddsBefore.playoff / 100));
    const weekWeights = new Map<number, number>();
    for (const week of playoffWeeks) {
      weekWeights.set(week, settings.playoffValue.playoffWeekWeight * reachOdds);
    }
    swap = computeLineupSwap({ ...swapArgs, weekWeights });
  } else if (playoffWeeks.length > 0) {
    // No odds means no honest weight for a playoff week, so they are left out
    // of the average entirely rather than counted as certainties.
    const weekWeights = new Map<number, number>();
    for (const week of playoffWeeks) weekWeights.set(week, 0);
    swap = computeLineupSwap({ ...swapArgs, weekWeights });
  }

  let marginal: MarginalValue = {
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
    dropOptions: swap.dropOptions,
    dropNote: swap.dropNote,
    isBenchOnly: swap.isBenchOnly,
  };

  // ---- what every rival would pay ------------------------------------------
  // The same swap test against every other roster, with no drop search: we
  // only need to know whether he cracks their lineup, and pricing their bench
  // is not our business. What is new is that the answer now carries a NUMBER
  // as well as a yes or no, because the auction model needs a centre for each
  // rival's bid, not just a count of who is interested.
  let interestedRivals: number | null = null;
  let rivalsChecked: number | null = null;
  const rivalWorthById = new Map<number, number>();
  // ONE definition of "would start him", used by the count, by the table and
  // by the simulation. Two definitions produced a card that said "nobody else
  // would start him" above a table of thirteen rivals bidding for him.
  const interestedSet = new Set<number>();
  if (settings.market.rivalNeed.enabled) {
    let interested = 0;
    let checked = 0;
    for (const roster of rosters) {
      if (roster.sleeperRosterId === mine.sleeperRosterId) continue;
      // An eliminated team is not a rival. Its budget is frozen, its roster
      // is empty, and counting it told readers in chopped leagues that half
      // the league was about to outbid them.
      if (!aliveSet.has(roster.sleeperRosterId)) continue;
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
      const wants = rivalSwap.netPointsPerWeek >= settings.market.rivalNeed.minPointsPerWeek;
      if (wants) {
        interested += 1;
        interestedSet.add(roster.sleeperRosterId);
      }
      // A rival's worth is measured on POINTS ALONE: they get the same upgrade
      // scale the reader does, with the odds terms absent, because simulating
      // eleven other seasons to price one waiver claim is not worth the second
      // it would cost and the points term carries nearly all of the signal.
      const rivalMarginal: MarginalValue = {
        weeksConsidered: rivalSwap.weeksConsidered,
        weeksStarting: rivalSwap.weeksStarting,
        pointsPerWeek: rivalSwap.pointsPerWeek,
        pointsPerStartedWeek: rivalSwap.pointsPerStartedWeek,
        netPointsPerWeek: rivalSwap.netPointsPerWeek,
        expectedWinsAdded: null,
        playoffOddsBefore: null,
        playoffOddsAfter: null,
        titleOddsBefore: null,
        titleOddsAfter: null,
        weeks: rivalSwap.weeks,
        dropCost: rivalSwap.dropCost,
        dropOptions: [],
        dropNote: null,
        isBenchOnly: rivalSwap.isBenchOnly,
      };
      rivalWorthById.set(
        roster.sleeperRosterId,
        upgradeStrengthOf(rivalMarginal, settings.marginal) * settings.marginal.maxPctFromUpgrade,
      );
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

  // Every model figure is a share of the league's FULL budget, so the two
  // conversions live together and are declared before anything reads them.
  const totalBudget = money.totalBudget ?? Math.max(1, yourBudget);
  const asPct = (dollars: number) => (dollars / Math.max(1, totalBudget)) * 100;

  const rivalBudgets = money.budgets
    .filter(
      (b) => b.sleeperRosterId !== mine.sleeperRosterId && aliveSet.has(b.sleeperRosterId),
    )
    .map((b) => b.remaining);

  // Sleeper leagues may set a floor under a claim. Most allow a zero bid, the
  // high-stakes formats do not, and a recommendation the league would reject
  // is worse than no recommendation.
  const leagueMinBid = money.minBid;

  const seasons: number[] = [];
  for (let s = 0; s < settings.market.history.lookbackSeasons; s += 1) {
    seasons.push(league.season - s);
  }

  const market = buildMarket({
    yourBudget,
    rivalBudgets: money.totalBudget === null ? [] : rivalBudgets,
    interestedRivals,
    rivalsChecked,
    // The history blend is gone. It pulled every recommendation toward the
    // median of every priced claim this league ever made, including the $1
    // cleanup adds and, in dynasty leagues, the offseason rookie claims, which
    // is how a season-changing running back came out at $5. What the league
    // pays now enters through heat, which is measured against the same
    // situation elsewhere rather than against every claim ever filed here.
    comparable: null,
    currentWeek,
    lastRegularWeek,
    leagueTotalBudget: money.totalBudget,
    settings: settings.market,
  });

  // ---- who else is on the wire, and how close are they ---------------------
  // Chopped leagues only, and the reason is the format: a whole roster lands
  // on waivers at once, so a rival who loses this auction usually has another
  // starter to chase and does not bid as hard for this one. Plan 7.12.6.
  //
  // Counted rather than assumed. Until this existed the Survival card printed
  // "0 substitutes" as though we had looked, which is worse than not showing
  // the figure at all: a fabricated measurement reads exactly like a real one.
  let substituteCount = 0;
  if (chopped && valueContext.formatConfigId) {
    try {
      const freeAgents = await loadLeagueFreeAgents(supabase, {
        leagueRowId: input.leagueRowId,
        formatConfigId: valueContext.formatConfigId,
        source: input.sourceSlug ?? "ktc",
      });
      const samePosition = (freeAgents?.players ?? [])
        .filter((p) => p.position === candidate.position)
        .filter((p) => p.sleeper_id && p.sleeper_id !== input.candidateSleeperId)
        .slice(0, SUBSTITUTE_POOL);

      if (samePosition.length > 0) {
        const candidateMean = meanOf([...candidateByWeek.values()].map((w) => w.points));
        const bar = candidateMean * settings.chopped.substituteShare;
        if (candidateMean > 0) {
          const ids = samePosition
            .map((p) => p.sleeper_id)
            .filter((id): id is string => Boolean(id));
          const subPlayers = await loadPlayers(supabase, ids);
          const subIds = [...subPlayers.values()].map((p) => p.playerId);
          const subRows = await loadProjections(
            supabase,
            subIds,
            league.season,
            currentWeek,
            undefined,
            projectionSource,
          );
          const subProjections = new Map<string, Map<number, ProjectionRow>>();
          for (const row of subRows) {
            const byWeek = subProjections.get(row.playerId) ?? new Map<number, ProjectionRow>();
            byWeek.set(row.week, row);
            subProjections.set(row.playerId, byWeek);
          }
          // The SAME projection path the candidate went through, so "nearly as
          // good as him" is a comparison rather than two different models.
          for (const player of subPlayers.values()) {
            const acc = accuracy.get(player.playerId) ?? null;
            const reliability = reliabilityMultiplier(acc, pulseSettings);
            const points: number[] = [];
            for (const week of weeks) {
              const projected = projectPlayerWeek({
                projection: subProjections.get(player.playerId)?.get(week),
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
              if (projected) points.push(projected.points);
            }
            if (points.length > 0 && meanOf(points) >= bar) substituteCount += 1;
          }
        }
      }
    } catch {
      // A failed read is not evidence that the wire is empty, so the count
      // stays at zero and the price simply does not get the discount.
      substituteCount = 0;
    }
  }

  // ---- the chopped model ---------------------------------------------------
  // Runs BEFORE the auction, because it is what tells the auction how the
  // shrinking field and each rival's own danger move their bids.
  // Survival instead of playoff odds, alive teams only, and a price that
  // falls as the field shrinks. Everything it needs is already in hand, so it
  // reads no cache and triggers no compute.
  const choppedOutcome = chopped
    ? computeChopped(
        {
          aliveRosterIds: aliveIds,
          startCount: rosters.length,
          currentWeek,
          weeklyByRoster: weeklyBefore,
          weeklyAfter: swap.weeklyAfter,
          seasonPointsByRoster: seasonPoints as Map<number, number>,
          myRosterId: mine.sleeperRosterId,
          budgetByRoster: new Map(
            money.budgets.map((b) => [b.sleeperRosterId, b.remaining] as const),
          ),
          totalBudget,
          substitutes: substituteCount,
          releaseCutoffWeek: null,
          seed: pulseSettings.simulation.seed,
        },
        settings,
        1,
      )
    : null;

  // ---- the auction ---------------------------------------------------------
  // Everything above answers "what is he worth to me". This answers "what
  // will it take", which is a question about the other eleven wallets.
  const priorCells = await loadPriorCellsCached();
  // A chopped league is priced against CHOPPED cells, and its phase is how
  // much of the field is left rather than the week of the calendar. Reading
  // type 3 as redraft (which it becomes once it is correctly not a keeper
  // league) judged a guillotine room hot or cold against redraft prices,
  // which is the category error this whole build exists to remove.
  const leagueKindForPriors: PriorLeagueKind = chopped
    ? "chopped"
    : valueContext.isKeeperLeague
      ? "dynasty"
      : "redraft";
  const aliveFractionNow = chopped
    ? aliveIds.length / Math.max(1, rosters.length)
    : null;
  const phaseFor = (week: number) =>
    chopped ? choppedPhase(aliveFractionNow) : standardPhase(week);
  const superflex = isSuperflexShape(league.rosterPositions);

  const auctions = settings.auction.enabled
    ? await loadAuctionHistory(supabase, input.leagueRowId, seasons)
    : [];

  // Every past auction is priced against the market cell for ITS OWN
  // situation, not against a single league-wide average, so a league that
  // happens to have chased three quarterbacks does not read as hot for that
  // reason alone.
  const tendencyAuctions: TendencyAuction[] = auctions.map((auction) => {
    const picked = pickCell(
      priorCells,
      {
        leagueKind: leagueKindForPriors,
        superflex,
        position: null,
        phase: phaseFor(auction.week),
        bidders: biddersKey(auction.bids.length),
      },
      settings.priors.minCellSamples,
    );
    const winner = auction.bids.find((b) => b.won) ?? auction.bids[0];
    return {
      week: auction.week,
      winningPct: asPct(winner?.amount ?? 0),
      bids: auction.bids.map((b) => ({ rosterId: b.rosterId, pct: asPct(b.amount) })),
      referencePct: picked?.cell.p50 ?? 5,
    };
  });
  const tendencies = computeLeagueTendencies(tendencyAuctions, settings.auction);

  const calendar = market.read.calendarMultiplier;
  const budgetPctOf = (dollars: number) => asPct(dollars);

  const auctionRivals: AuctionRival[] = money.budgets
    .filter(
      (b) => b.sleeperRosterId !== mine.sleeperRosterId && aliveSet.has(b.sleeperRosterId),
    )
    .map((b) => {
      const worth = rivalWorthById.get(b.sleeperRosterId) ?? 0;
      // In a chopped league two more things move a rival's bid: the field is
      // shrinking, which lowers every price, and a team in danger of the
      // trapdoor this week will pay over the odds to avoid it.
      const choppedScale = choppedOutcome
        ? priceByAliveFraction(
            choppedOutcome.read.aliveCount / Math.max(1, choppedOutcome.read.startCount),
            settings.chopped,
          ) * (choppedOutcome.dangerBoostByRoster.get(b.sleeperRosterId) ?? 1)
        : 1;
      return {
        rosterId: b.sleeperRosterId,
        budgetPct: budgetPctOf(b.remaining),
        interested: interestedSet.has(b.sleeperRosterId),
        centerPct:
          worth *
          tendencies.heat *
          tendencyFor(tendencies, b.sleeperRosterId) *
          calendar *
          choppedScale,
        waiverPosition: null,
      };
    });

  const strayCell = pickCell(
    priorCells,
    {
      leagueKind: leagueKindForPriors,
      superflex,
      position: candidate.position,
      phase: phaseFor(currentWeek),
      bidders: "any",
    },
    settings.priors.minCellSamples,
  );

  // Without published budgets there is nobody to simulate: we do not know
  // what anyone can spend, so we say so rather than inventing an opponent.
  const curve =
    settings.auction.enabled && money.totalBudget !== null
      ? simulateAuction({
          yourBudgetPct: budgetPctOf(yourBudget),
          // The tie rule. Sleeper breaks equal bids by rolling waiver order,
          // but our stored waiver_position is TODAY's value and a winning
          // claim moves that team to the back, so it cannot be read back onto
          // a past auction. Checked against 108 real ties: the winner held the
          // lower number 31 times and the higher 40. Passing null splits a tie
          // down the middle, which is the honest answer here.
          yourWaiverPosition: null,
          rivals: auctionRivals,
          strayCell: strayCell?.cell ?? null,
          settings: settings.auction,
          seed: pulseSettings.simulation.seed,
          totalBudget,
          minBid: leagueMinBid,
          // Chopped leagues only. A whole roster lands on waivers at once, so
          // a rival who loses this auction has somewhere else to spend and
          // bids less hard for this one. It is 1 today because the substitute
          // COUNT is not built on this path (see the note where the chopped
          // context is assembled), but the wiring is here so the count is the
          // only thing left to add.
          participationScale: choppedOutcome?.participationScale ?? 1,
        })
      : null;

  // ---- the player reads ----------------------------------------------------
  const [gameLogs, finishes, teamDepth] = await Promise.all([
    loadGameLogs(supabase, candidate.playerId, league.season),
    settings.signals.ceiling.enabled
      ? loadPositionalFinishes(
          supabase,
          candidate.playerId,
          scoringBase,
          league.season - settings.signals.ceiling.lookbackSeasons,
        )
      : Promise.resolve([]),
    settings.injury.teammateSignal.enabled
      ? loadTeamDepth(supabase, candidate.team, candidate.position)
      : Promise.resolve([]),
  ]);

  const teammate = starterAheadOf(teamDepth, candidate.playerId);
  const candidateDepthOrder =
    teamDepth.find((d) => d.playerId === candidate.playerId)?.depthOrder ?? null;

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
    teammate,
    depthOrder: candidateDepthOrder,
    teammateSettings: settings.injury.teammateSignal,
  });

  // ---- the breakout blend --------------------------------------------------
  // When the opportunity signal says his role has genuinely changed, the
  // published projection is often still describing the player he was: a back
  // who has taken over a backfield carries the projection of the back who was
  // splitting it. So the candidate's weekly points are pulled toward what he
  // has actually been scoring in the new role, under this league's own rules.
  //
  // Only on a role GROWTH. A shrinking role already shows up in the
  // projection, and blending toward recent points there would double count it.
  let breakoutNote: string | null = null;
  if (settings.breakout.enabled) {
    const roleGrew = playerSignals.some(
      (s) => s.id === "opportunity" && s.label === "His role just grew",
    );
    if (roleGrew) {
      const recent = await loadRecentPointsPerGame(
        supabase,
        candidate.playerId,
        league.season,
        league.scoringSettings,
        settings.signals.opportunity.recentGames,
      );
      if (recent !== null && recent > 0) {
        const w = Math.min(1, Math.max(0, settings.breakout.blendWeight));
        for (const [week, value] of candidateByWeek) {
          candidateByWeek.set(week, {
            ...value,
            points: value.points * (1 - w) + recent * w,
          });
        }
        // The swap has to be rebuilt on the new numbers, or the blend would
        // be a figure nothing in the answer actually used.
        swap = computeLineupSwap(swapArgs);
        // The reported figures come off the swap, so they are rebuilt with
        // it. The playoff odds are NOT re-simulated: a blend of a few points
        // a week does not move a season's odds enough to be worth a second
        // simulation inside a request, and saying so here is better than
        // quietly implying it was rerun.
        marginal = {
          ...marginal,
          weeksConsidered: swap.weeksConsidered,
          weeksStarting: swap.weeksStarting,
          pointsPerWeek: swap.pointsPerWeek,
          pointsPerStartedWeek: swap.pointsPerStartedWeek,
          netPointsPerWeek: swap.netPointsPerWeek,
          weeks: swap.weeks,
          dropCost: swap.dropCost,
          dropOptions: swap.dropOptions,
          dropNote: swap.dropNote,
          isBenchOnly: swap.isBenchOnly,
        };
        breakoutNote = "Projection adjusted for his new role.";
      }
    }
  }

  // ---- how sure are we? ----------------------------------------------------
  const confidence = gradeConfidence({
    accuracyWeeks: candidateAccuracy?.weeksPlayed ?? 0,
    hasOdds: oddsBefore !== null,
    hasSnapData: gameLogs.some((g) => g.snapPct !== null),
    weeksProjected: candidateByWeek.size,
  });

  // ---- who on this roster is already hurt ---------------------------------
  // Only the players who would START this week: a fourth receiver on injured
  // reserve is not the reason to spend, and listing him would bury the one
  // name that is. Read from what the projection source published, so the
  // status shown here is the same one the projection was built from.
  const injuredStarters: Array<{ name: string; status: string; position: string }> = [];
  {
    const thisWeek = rosterWeeksById.get(mine.sleeperRosterId)?.get(currentWeek) ?? [];
    const starters = new Set(
      buildOptimalLineup(slots, thisWeek)
        .slots.map((s) => s.playerId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const sid of mine.playerSleeperIds) {
      const player = players.get(sid);
      if (!player || !starters.has(player.playerId)) continue;
      const status = (player.injuryStatus ?? "").toUpperCase();
      if (!status || status === "ACTIVE" || status === "QUESTIONABLE") continue;
      injuredStarters.push({ name: player.name, status, position: player.position });
    }
  }

  // In superflex, a starting quarterback going out is the one injury that
  // cannot be streamed around, and the replacement is usually gone by
  // Wednesday. That is a reason to spend, and the ladder is told about it.
  const superflexQbEmergency =
    superflex &&
    candidate.position === "QB" &&
    injuredStarters.some((s) => s.position === "QB");

  // ---- the dynasty half of the answer --------------------------------------
  // In a dynasty or keeper league part of what a claim buys is the player
  // himself, and how much depends on who is asking. The reader's Power Pulse
  // rank is READ from the cache, never computed: a calculator must not be
  // able to start a Power Pulse run.
  let dynastyValuePct: number | null = null;
  let dynastyBlendWeight: number | null = null;
  if (settings.dynastyValue.enabled && valueContext.isKeeperLeague && !chopped) {
    const pulseRank = await loadPulseRank(
      supabase,
      input.leagueRowId,
      league.season,
      mine.sleeperRosterId,
    );
    const status = classifyTeamStatus({
      pulseRank,
      valueRank: null,
      teamCount: rosters.length,
      playoffTeams: league.playoffTeams,
      variant: "dynasty",
    });
    // A league with no cached rank gets the middle weight rather than no
    // dynasty value at all: "we do not know your situation" is a reason to
    // sit between the two answers, not to pick one of them.
    const key = status?.key ?? "middle";
    dynastyBlendWeight =
      settings.dynastyValue.blendByStatus[
        key as keyof typeof settings.dynastyValue.blendByStatus
      ] ?? settings.dynastyValue.blendByStatus.middle;

    const candidateValue = playerValues.get(candidate.playerId) ?? null;
    if (candidateValue !== null) {
      // Elite is the value at the rank a league this size actually starts,
      // scaled down: a top-quarter starter is the bar a claim is measured
      // against, not the single best player in the game.
      const eliteRank = Math.max(
        1,
        Math.round(rosters.length * slots.length * settings.dynastyValue.eliteRankFactor),
      );
      const eliteValue = await loadEliteValue(
        supabase,
        valueContext.formatConfigId,
        eliteRank,
        input.sourceSlug ?? null,
      );
      const dropValue = swap.dropCost ? (playerValues.get(swap.dropCost.playerId) ?? 0) : 0;
      if (eliteValue && eliteValue > 0) {
        const share = Math.min(1.25, Math.max(0, (candidateValue - dropValue) / eliteValue));
        dynastyValuePct = share * settings.marginal.maxPctFromUpgrade;
      }
    }
  }

  // A reader one bad week from elimination is not shopping for value, so the
  // page opens on "make sure I win" for them and says why.
  const goalDefault = choppedOutcome?.goalDefault ?? settings.goal.defaultGoal;

  const ladder = buildLadder({
    marginal,
    playerSignals,
    marketSignals: market.signals,
    market: market.read,
    remainingBudget: yourBudget,
    totalBudget,
    minBid: leagueMinBid,
    needLevel: input.needLevel,
    mode: "league",
    settings,
    confidence,
    goal: input.goal ?? goalDefault,
    winChanceAt: curve ? (dollars: number) => curve.winChanceAt(dollars) : null,
    rivalTop: curve ? { p50: curve.rivalTop.p50, p75: curve.rivalTop.p75 } : null,
    noRivalShare: curve?.noRivalShare ?? null,
    interestedRivals,
    superflexQbEmergency,
    worthPctOverride: choppedOutcome?.worthPct ?? null,
    dynastyValuePct,
    dynastyBlendWeight,
    choppedHeadline:
      choppedOutcome && choppedOutcome.goalDefault === "sure" ? "Survive this week" : null,
  });

  // ---- who else wants him, by name ----------------------------------------
  // Real team names, because they are already public on the league page and
  // "a rival" is not something a reader can plan around. Only the teams he
  // would actually start for are listed; the rest are counted.
  const rivalRows: RivalRow[] = [];
  let rivalsNotInterested = 0;
  for (const budgetRow of money.budgets) {
    if (budgetRow.sleeperRosterId === mine.sleeperRosterId) continue;
    // An eliminated team is not a rival and is not a team that "would not
    // start him" either: it is not in the league any more. Counting it would
    // pad the summary line under the table with teams that cannot bid, which
    // is the same mistake as leaving their budgets in the money.
    if (!aliveSet.has(budgetRow.sleeperRosterId)) continue;
    const wouldStart = interestedSet.has(budgetRow.sleeperRosterId);
    if (!wouldStart) {
      rivalsNotInterested += 1;
      continue;
    }
    const sim = auctionRivals.find((r) => r.rosterId === budgetRow.sleeperRosterId);
    const centre = sim?.centerPct ?? 0;
    const spread = Math.exp(settings.auction.bidSigma);
    const toDollars = (pct: number) =>
      Math.min(budgetRow.remaining, Math.round((Math.max(0, pct) / 100) * totalBudget));
    rivalRows.push({
      rosterId: budgetRow.sleeperRosterId,
      teamName:
        teamNames.get(budgetRow.sleeperRosterId) ?? `Team ${budgetRow.sleeperRosterId}`,
      budget: budgetRow.remaining,
      wouldStart: true,
      style: tendencyLabel(tendencies, budgetRow.sleeperRosterId),
      likelyBid:
        money.totalBudget === null || centre <= 0
          ? null
          : { low: toDollars(centre / spread), high: toDollars(centre * spread) },
    });
  }
  rivalRows.sort((a, b) => (b.likelyBid?.high ?? 0) - (a.likelyBid?.high ?? 0));

  // ---- Positional WAR, READ ONLY ------------------------------------------
  // The league's curve if it already has one. This never triggers a compute:
  // Positional WAR is on-demand through the league deep view, and a
  // calculator must not be able to start one.
  let positionalWar: LeagueFaabReport["positionalWar"] = null;
  try {
    const view = await loadPositionalWarView(supabase, input.leagueRowId, league.season);
    const curveForPosition = view?.curves.find((c) => c.position === candidate.position);
    const point = curveForPosition?.curve.find((p) => p.playerId === candidate.playerId);
    if (point && typeof point.war === "number") {
      positionalWar = {
        value: point.war,
        positionRank: point.positionRank,
        position: candidate.position,
      };
    }
  } catch {
    positionalWar = null;
  }

  const reasons = buildReasons({
    interestedRivals,
    rivalsWithStarterOut: null,
    netPointsPerWeek: marginal.netPointsPerWeek,
    dropName: marginal.dropCost?.name ?? null,
    // True when the playoff weeks actually entered the average, which needs
    // both that we projected them and that we had odds to weight them by.
    // Hardcoding false meant the "playoffs included" clause could never fire
    // on the very bids where it is the point.
    includesPlayoffWeeks: playoffWeeks.length > 0 && oddsBefore !== null,
    // A chopped league is never told about playoff odds it does not have.
    playoffOddsBefore: chopped ? null : marginal.playoffOddsBefore,
    playoffOddsAfter: chopped ? null : marginal.playoffOddsAfter,
    choppedBefore: choppedOutcome ? choppedOutcome.read.before.pChoppedThisWeek * 100 : null,
    choppedAfter: choppedOutcome ? choppedOutcome.read.after.pChoppedThisWeek * 100 : null,
    aliveCount: choppedOutcome?.read.aliveCount ?? null,
    moneyLeftInLeague: choppedOutcome?.read.moneyLeftInLeague ?? null,
    yourShareOfMoney: choppedOutcome?.read.yourShareOfMoney ?? null,
    heat: tendencies.heat,
    heatSamples: tendencies.heatSamples,
    richestRivalBudget: market.read.richestRivalBudget,
    yourBudget,
    calendarMultiplier: calendar,
    currentWeek,
    teammateName: teammate?.name ?? null,
    teammateStatus: teammate?.status ?? null,
    dynastyBlendWeight,
    dynastyValuePct,
    pointsWorthPct: ladder.pointsWorthPct,
  });

  const notices = [...ladder.notices];
  if (breakoutNote) notices.push(breakoutNote);
  if (money.totalBudget === null) {
    notices.push(
      "This league does not publish a FAAB budget through Sleeper, so we could not read anyone's remaining money. The bid below is priced on the roster upgrade alone.",
    );
  }
  // Only a standard league can be missing a schedule. A chopped league has no
  // schedule, no opponent and no playoff odds BY DESIGN, and telling its
  // reader we could not find them is the same category error as running a
  // playoff simulation on it.
  if (oddsBefore === null && !chopped) {
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
      leagueKind: chopped ? "chopped" : "standard",
      goalDefault,
      reasons,
      rivals: rivalRows,
      rivalsNotInterested,
      injuredStarters: injuredStarters.map((s) => ({
        name: s.name,
        status: s.status,
        weeksOut: null,
      })),
      positionalWar,
      chopped: choppedOutcome?.read ?? null,
      heat:
        tendencies.heatSamples > 0
          ? { value: tendencies.heat, samples: tendencies.heatSamples }
          : null,
      priorsFallback: strayCell?.fellBackTo ?? null,
    },
  };
}

/**
 * How many weeks a league's playoffs actually run for.
 *
 * Sleeper's playoff_round_type: 0 is one week a round, 1 is two weeks every
 * round, 2 is two weeks for the final only. A four-team bracket is two rounds,
 * six teams is three (the byes still play the same weeks), and the arithmetic
 * is the same ceil(log2) either way.
 */
function playoffRoundCount(playoffTeams: number, playoffRoundType: number): number {
  const teams = Math.max(2, Math.floor(playoffTeams || 4));
  const rounds = Math.max(1, Math.ceil(Math.log2(teams)));
  if (playoffRoundType === 1) return rounds * 2;
  if (playoffRoundType === 2) return rounds + 1;
  return rounds;
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
