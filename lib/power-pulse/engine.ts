/**
 * The Power Pulse calculation.
 *
 * Pure: everything arrives as plain data from lib/power-pulse/load.ts, so the
 * whole model is testable without a database.
 *
 * The pipeline, per team:
 *   1. Project every rostered player for every remaining week, in the league's
 *      own scoring, adjusted for opponent, reliability, availability, injury.
 *   2. Build the optimal starting lineup for each of those weeks.
 *   3. Turn the weekly lineup totals into a mean and a spread.
 *   4. Simulate the rest of the season to get wins, playoff odds, title odds.
 *   5. Score four components within the league and blend them into 1 to 99.
 *
 * Draft picks appear nowhere. Power Pulse answers who wins games, and a 2028
 * first cannot start for you in week 4.
 */

import type { PowerPulseSettings } from "./default-settings";
import { projectPlayerWeek, reliabilityMultiplier } from "./project";
import {
  buildOptimalLineup,
  lineupSigma,
  scoreSetLineup,
  startingSlots,
} from "./lineup";
import type { LineupCandidate } from "./lineup";
import {
  clamp,
  mean,
  rankDescending,
  round,
  stdev,
  zScores,
  zToDisplay,
} from "./math";
import { simulateSeason, type SimTeam } from "./simulate";
import type {
  AccuracyRow,
  DefenseRow,
  LeagueRow,
  PlayerRow,
  ProjectionRow,
  RosterRow,
} from "./load";
import {
  PULSE_POSITIONS,
  PULSE_SLOT_ELIGIBILITY,
  type PulsePosition,
  type ScheduleWeek,
} from "./types";

export type PowerPulseInput = {
  league: LeagueRow;
  rosters: RosterRow[];
  /** Keyed by Sleeper player id. */
  players: Map<string, PlayerRow>;
  projections: ProjectionRow[];
  /** Keyed by FF Beacon player id. */
  accuracy: Map<string, AccuracyRow>;
  /** Keyed by `${team}|${season}|${position}`. */
  defense: Map<string, DefenseRow>;
  /** Seasons present in `defense`, most recent first. */
  defenseSeasons: number[];
  schedule: ScheduleWeek[];
  /** Keyed by `${week}|${sleeperRosterId}`. */
  setLineups: Map<string, string[]>;
  /** Completed weekly point totals, keyed by Sleeper roster id. */
  results: Map<number, { week: number; points: number }[]>;
  /**
   * Measured lineup efficiency per Sleeper roster id, from the Manager Ledger.
   *
   * Read ONLY when `settings.lineupRealism.enabled` is true, and absent
   * entirely when it is false, so a league with no ledger behaves exactly as it
   * did before this existed. See `lineupRealismFactor` for what it does and for
   * why it is off by default.
   */
  lineupEfficiency?: Map<number, { efficiency: number; weeksGraded: number }>;
  /** First unplayed week. 1 during the preseason. */
  currentWeek: number;
  settings: PowerPulseSettings;
};

/**
 * How much of a team's optimal lineup to actually project them to score.
 *
 * Returns 1 when the correction is off, when the team has no measurement, or
 * when it has too few graded weeks to be evidence, so the default path through
 * this function changes nothing at all.
 *
 * Pure and exported for the tests. The floor matters more than it looks: a
 * manager who has started 76% of their points is not going to keep doing that
 * for fourteen more weeks, and a projection that assumes they will is a worse
 * prediction than the perfect-lineup assumption this replaces.
 */
export function lineupRealismFactor(
  settings: PowerPulseSettings,
  measured: { efficiency: number; weeksGraded: number } | undefined,
): number {
  const config = settings.lineupRealism;
  if (!config?.enabled) return 1;
  if (!measured) return 1;
  if (measured.weeksGraded < config.minWeeks) return 1;
  if (!Number.isFinite(measured.efficiency) || measured.efficiency <= 0) return 1;

  const blended = 1 - config.blend * (1 - Math.min(1, measured.efficiency));
  return Math.min(1, Math.max(config.floor, blended));
}

export type PowerPulseDriver = {
  label: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
};

export type PowerPulseTeamResult = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  powerPulse: number;
  pulseRank: number | null;
  scorePoints: number;
  scorePointsRank: number | null;
  scoreSchedule: number;
  scoreScheduleRank: number | null;
  scoreDepth: number;
  scoreDepthRank: number | null;
  scoreForm: number | null;
  scoreFormRank: number | null;
  expectedPointsPerWeek: number;
  expectedPointsStdev: number;
  expectedWins: number;
  projectedWins: number;
  projectedLosses: number;
  projectedTies: number;
  playoffOdds: number;
  byeOdds: number;
  titleOdds: number;
  lastPlaceOdds: number;
  sosPoints: number;
  sosRank: number | null;
  lineupEfficiency: number | null;
  lineupEfficiencyRank: number | null;
  lineupPointsLost: number | null;
  reliabilityScore: number;
  reliabilityRank: number | null;
  weekly: Array<{
    week: number;
    opponentRosterId: number | null;
    opponentName: string | null;
    mean: number;
    sigma: number;
    winProb: number | null;
  }>;
  drivers: PowerPulseDriver[];
  components: {
    positionPoints: Record<string, number>;
    positionRanks: Record<string, number | null>;
    starters: Array<{
      playerId: string;
      name: string;
      position: string;
      points: number;
    }>;
    depthDropoffPct: number;
    unfilledSlotRate: number;
    formRatio: number | null;
    usedLeagueScoring: boolean;
    weeksProjected: number;
  };
};

type PlayerWeek = {
  week: number;
  points: number;
  rawPoints: number;
  sigma: number;
  opponentMultiplier: number;
};

type TeamWork = {
  roster: RosterRow;
  players: Array<{
    player: PlayerRow;
    accuracy: AccuracyRow | null;
    reliability: number;
  }>;
  /** Keyed by week, then FF Beacon player id. */
  byWeek: Map<number, Map<string, PlayerWeek>>;
  weekLineups: Array<{
    week: number;
    total: number;
    sigma: number;
    unfilled: number;
  }>;
  meanPoints: number;
  sigma: number;
  lineupEfficiency: number | null;
  lineupPointsLost: number | null;
  reliability: number;
  depthDropoffPct: number;
  unfilledSlotRate: number;
  formRatio: number | null;
  positionPoints: Record<PulsePosition, number>;
  starters: Array<{
    playerId: string;
    name: string;
    position: string;
    points: number;
  }>;
  usedLeagueScoring: boolean;
};

export function computePowerPulse(
  input: PowerPulseInput,
): PowerPulseTeamResult[] {
  const { league, rosters, players, settings, currentWeek } = input;
  if (rosters.length === 0) return [];

  const slots = startingSlots(league.rosterPositions);
  const lastRegularWeek = Math.max(currentWeek, league.playoffWeekStart - 1);

  // Projections indexed for O(1) lookup.
  const projectionsByPlayer = new Map<string, Map<number, ProjectionRow>>();
  for (const row of input.projections) {
    const byWeek =
      projectionsByPlayer.get(row.playerId) ?? new Map<number, ProjectionRow>();
    byWeek.set(row.week, row);
    projectionsByPlayer.set(row.playerId, byWeek);
  }

  const remainingWeeks: number[] = [];
  for (let w = currentWeek; w <= lastRegularWeek; w += 1)
    remainingWeeks.push(w);

  // ---------- pass 1: project every player, build every lineup ----------

  const work: TeamWork[] = [];

  for (const roster of rosters) {
    const ineligible = new Set([
      ...roster.reserveSleeperIds,
      ...roster.taxiSleeperIds,
    ]);
    const rosterPlayers = roster.playerSleeperIds
      .filter((sid) => !ineligible.has(sid))
      .map((sid) => players.get(sid))
      .filter((p): p is PlayerRow => Boolean(p));

    const enriched = rosterPlayers.map((player) => {
      const accuracy = input.accuracy.get(player.playerId) ?? null;
      return {
        player,
        accuracy,
        reliability: reliabilityMultiplier(accuracy, settings),
      };
    });

    const byWeek = new Map<number, Map<string, PlayerWeek>>();
    let usedLeagueScoring = false;

    for (const week of remainingWeeks) {
      const weekMap = new Map<string, PlayerWeek>();
      for (const { player, accuracy, reliability } of enriched) {
        // A null projection means a bye week, a player Sleeper does not publish,
        // or a stat line we cannot score. All three are "no opinion", never zero.
        const projected = projectPlayerWeek({
          projection: projectionsByPlayer.get(player.playerId)?.get(week),
          subject: player,
          accuracy,
          reliability,
          scoringSettings: league.scoringSettings,
          defense: input.defense,
          defenseSeasons: input.defenseSeasons,
          week,
          currentWeek,
          settings,
        });
        if (!projected) continue;
        if (projected.usedLeagueScoring) usedLeagueScoring = true;

        weekMap.set(player.playerId, {
          week,
          points: projected.points,
          rawPoints: projected.rawPoints,
          sigma: projected.sigma,
          opponentMultiplier: projected.opponentMultiplier,
        });
      }
      byWeek.set(week, weekMap);
    }

    const candidatesFor = (week: number): LineupCandidate[] => {
      const weekMap = byWeek.get(week);
      if (!weekMap) return [];
      const out: LineupCandidate[] = [];
      for (const { player } of enriched) {
        const pw = weekMap.get(player.playerId);
        if (!pw) continue;
        out.push({
          playerId: player.playerId,
          position: player.position,
          points: pw.points,
          sigma: pw.sigma,
        });
      }
      return out;
    };

    const weekLineups: TeamWork["weekLineups"] = [];
    const positionTotals: Record<PulsePosition, number> = {
      QB: 0,
      RB: 0,
      WR: 0,
      TE: 0,
      K: 0,
      DEF: 0,
    };
    const nameById = new Map(
      enriched.map((e) => [e.player.playerId, e.player]),
    );

    // 1 unless an admin has turned the correction on AND this roster has enough
    // graded weeks behind it, so the default path is byte-identical to what
    // this model did before the setting existed.
    const realism = lineupRealismFactor(
      settings,
      input.lineupEfficiency?.get(roster.sleeperRosterId),
    );

    for (const week of remainingWeeks) {
      const candidates = candidatesFor(week);
      const lineup = buildOptimalLineup(slots, candidates);
      const unfilled = lineup.slots.filter((s) => s.playerId === null).length;
      weekLineups.push({
        week,
        // The MEAN is discounted; the spread is not. A manager who leaves
        // points on the bench scores fewer points, not more predictable ones,
        // and scaling sigma with it would quietly narrow their win
        // probabilities as well as lowering them.
        total: lineup.total * realism,
        sigma: lineupSigma(lineup.slots),
        unfilled,
      });
      for (const slot of lineup.slots) {
        if (!slot.playerId) continue;
        const player = nameById.get(slot.playerId);
        if (player) positionTotals[player.position] += slot.points;
      }
    }

    const weekCount = Math.max(1, weekLineups.length);
    for (const position of PULSE_POSITIONS) {
      // Scaled by the same factor as the weekly totals above, so the position
      // breakdown still sums to the expected points per week. Leaving it
      // unscaled would put a set of numbers on the page that add up to a
      // different total than the one printed beside them.
      positionTotals[position] = (positionTotals[position] * realism) / weekCount;
    }

    const meanPoints = mean(weekLineups.map((w) => w.total));
    const sigma = mean(weekLineups.map((w) => w.sigma));
    const unfilledSlotRate =
      slots.length > 0
        ? mean(weekLineups.map((w) => w.unfilled / slots.length))
        : 0;

    // ----- lineup efficiency, graded on the upcoming week -----
    const upcomingCandidates = candidatesFor(currentWeek);
    const upcomingLineup = buildOptimalLineup(slots, upcomingCandidates);

    const setSleeperIds =
      input.setLineups.get(`${currentWeek}|${roster.sleeperRosterId}`) ??
      roster.starterSleeperIds;
    const setPlayerIds = setSleeperIds
      .map((sid) => players.get(sid)?.playerId)
      .filter((id): id is string => Boolean(id));
    const setScore = scoreSetLineup(setPlayerIds, upcomingCandidates);

    let lineupEfficiency: number | null = null;
    let lineupPointsLost: number | null = null;
    if (setScore && upcomingLineup.total > 0) {
      lineupEfficiency = clamp(setScore.total / upcomingLineup.total, 0, 1);
      lineupPointsLost = Math.max(0, upcomingLineup.total - setScore.total);
    }

    // ----- reliability of the projected starters, weighted by their points -----
    let reliabilityWeighted = 0;
    let reliabilityWeight = 0;
    const starters: TeamWork["starters"] = [];
    for (const slot of upcomingLineup.slots) {
      if (!slot.playerId) continue;
      const entry = enriched.find((e) => e.player.playerId === slot.playerId);
      if (!entry) continue;
      reliabilityWeighted += entry.reliability * slot.points;
      reliabilityWeight += slot.points;
      starters.push({
        playerId: entry.player.playerId,
        name: entry.player.name,
        position: entry.player.position,
        points: round(slot.points, 2),
      });
    }
    const reliability =
      reliabilityWeight > 0 ? reliabilityWeighted / reliabilityWeight : 1;

    // ----- depth: what happens when the best starter at a position misses -----
    // Removing a player and refilling the lineup measures real replaceability,
    // which is what depth means. Averaged across the four skill positions so one
    // irreplaceable quarterback does not define the whole roster.
    const dropPcts: number[] = [];
    if (upcomingLineup.total > 0) {
      for (const position of ["QB", "RB", "WR", "TE"] as PulsePosition[]) {
        const best = upcomingCandidates
          .filter((c) => c.position === position)
          .sort((a, b) => b.points - a.points)[0];
        if (!best) continue;
        const without = upcomingCandidates.filter(
          (c) => c.playerId !== best.playerId,
        );
        const reduced = buildOptimalLineup(slots, without);
        dropPcts.push(
          (upcomingLineup.total - reduced.total) / upcomingLineup.total,
        );
      }
    }
    const depthDropoffPct = dropPcts.length > 0 ? mean(dropPcts) : 0;

    // ----- form: recent actual results against what we would have expected -----
    const completed = input.results.get(roster.sleeperRosterId) ?? [];
    let formRatio: number | null = null;
    if (completed.length > 0 && meanPoints > 0) {
      const recent = completed.slice(-3).map((r) => r.points);
      formRatio = mean(recent) / meanPoints;
    }

    work.push({
      roster,
      players: enriched,
      byWeek,
      weekLineups,
      meanPoints,
      sigma,
      lineupEfficiency,
      lineupPointsLost,
      reliability,
      depthDropoffPct,
      unfilledSlotRate,
      formRatio,
      positionPoints: positionTotals,
      starters,
      usedLeagueScoring,
    });
  }

  // ---------- pass 2: schedule, simulation ----------

  const meanByRoster = new Map<number, number>();
  const sigmaByRoster = new Map<number, number>();
  const weeklyByRoster = new Map<
    number,
    Map<number, { mean: number; sigma: number }>
  >();
  for (const team of work) {
    meanByRoster.set(team.roster.sleeperRosterId, team.meanPoints);
    sigmaByRoster.set(team.roster.sleeperRosterId, team.sigma);
    const weekMap = new Map<number, { mean: number; sigma: number }>();
    for (const w of team.weekLineups)
      weekMap.set(w.week, { mean: w.total, sigma: w.sigma });
    weeklyByRoster.set(team.roster.sleeperRosterId, weekMap);
  }

  const teamNameByRoster = new Map(
    work.map((t) => [t.roster.sleeperRosterId, t.roster.teamName]),
  );

  // Only unplayed regular season weeks feed the simulation.
  const upcomingSchedule = input.schedule.filter(
    (w) =>
      !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  );

  const simTeams: SimTeam[] = work.map((team) => ({
    sleeperRosterId: team.roster.sleeperRosterId,
    wins: team.roster.wins,
    losses: team.roster.losses,
    ties: team.roster.ties,
    pointsFor: team.roster.pointsFor,
    weeks: weeklyByRoster.get(team.roster.sleeperRosterId) ?? new Map(),
    mean: team.meanPoints,
    sigma: team.sigma,
  }));

  const simResults = simulateSeason(simTeams, upcomingSchedule, {
    runs: settings.simulation.runs,
    seed: settings.simulation.seed,
    playoffTeams: league.playoffTeams,
    playoffWeekStart: league.playoffWeekStart,
    playoffRoundType: league.playoffRoundType,
  });

  // Strength of schedule and the per-week preview.
  const sosByRoster = new Map<number, number>();
  const weeklyDetail = new Map<number, PowerPulseTeamResult["weekly"]>();

  for (const team of work) {
    const rosterId = team.roster.sleeperRosterId;
    const detail: PowerPulseTeamResult["weekly"] = [];
    const opponentMeans: number[] = [];

    for (const week of upcomingSchedule) {
      const opponentId = week.opponents.get(rosterId) ?? null;
      const mine = weeklyByRoster.get(rosterId)?.get(week.week);
      const theirs =
        opponentId !== null
          ? weeklyByRoster.get(opponentId)?.get(week.week)
          : undefined;

      let winProb: number | null = null;
      if (mine && theirs) {
        const combined = Math.sqrt(
          mine.sigma * mine.sigma + theirs.sigma * theirs.sigma,
        );
        winProb =
          combined > 0
            ? // Same normal approximation the simulation samples from.
              0.5 *
              (1 + erf((mine.mean - theirs.mean) / (combined * Math.SQRT2)))
            : mine.mean > theirs.mean
              ? 1
              : 0.5;
      }
      if (theirs) opponentMeans.push(theirs.mean);

      detail.push({
        week: week.week,
        opponentRosterId: opponentId,
        opponentName:
          opponentId !== null
            ? (teamNameByRoster.get(opponentId) ?? null)
            : null,
        mean: round(mine?.mean ?? 0, 2),
        sigma: round(mine?.sigma ?? 0, 2),
        winProb: winProb === null ? null : round(winProb, 4),
      });
    }

    sosByRoster.set(
      rosterId,
      opponentMeans.length > 0 ? mean(opponentMeans) : 0,
    );
    weeklyDetail.set(rosterId, detail);
  }

  // ---------- pass 3: normalize into the four components ----------

  // Rosters the simulation can actually resolve. A league that shrank keeps the
  // wider schedule it was created with, so `league_matchups` can still pair a
  // team against a roster that has since left. The simulation skips those games
  // because there is nobody to score against, and counting them as games played
  // anyway turned the missing opponent into a loss: every team's projected wins
  // and losses stopped adding up to its own schedule. Count only the games that
  // get played.
  const scoredRosterIds = new Set(work.map((t) => t.roster.sleeperRosterId));

  const gamesTotal = (team: TeamWork): number => {
    const played = team.roster.wins + team.roster.losses + team.roster.ties;
    const remaining = upcomingSchedule.filter((w) => {
      const opponent = w.opponents.get(team.roster.sleeperRosterId);
      return opponent !== undefined && scoredRosterIds.has(opponent);
    }).length;
    return Math.max(1, played + remaining);
  };

  const rawPoints = work.map((t) => t.meanPoints);
  const rawSchedule = work.map((t) => {
    const sim = simResults.get(t.roster.sleeperRosterId);
    return sim ? sim.expectedWins / gamesTotal(t) : 0;
  });
  // Depth is a penalty, so a smaller dropoff and fewer unfilled slots score higher.
  const rawDepth = work.map((t) => -(t.depthDropoffPct + t.unfilledSlotRate));
  const hasForm = work.some((t) => t.formRatio !== null);
  const rawForm = work.map((t) => t.formRatio ?? 1);

  const zPoints = zScores(rawPoints);
  const zSchedule = zScores(rawSchedule);
  const zDepth = zScores(rawDepth);
  const zForm = hasForm ? zScores(rawForm) : work.map(() => 0);

  // Redistribute the form weight proportionally when no games have been played.
  const w = settings.weights;
  const activeWeights = hasForm
    ? w
    : (() => {
        const remaining = w.points + w.schedule + w.depth;
        if (remaining <= 0) return { ...w, form: 0 };
        const scale = (w.points + w.schedule + w.depth + w.form) / remaining;
        return {
          points: w.points * scale,
          schedule: w.schedule * scale,
          depth: w.depth * scale,
          form: 0,
        };
      })();

  const composite = work.map(
    (_, i) =>
      activeWeights.points * zPoints[i] +
      activeWeights.schedule * zSchedule[i] +
      activeWeights.depth * zDepth[i] +
      activeWeights.form * zForm[i],
  );
  const zComposite = zScores(composite);

  const pulseValues = zComposite.map((z) => zToDisplay(z, settings.display));
  // Ranked on the composite, not on the rounded display value. zToDisplay
  // collapses the score onto 99 integers, so two teams the model separates
  // clearly can land on the same number and tie, which left the table showing
  // two thirds and no fourth and put the order between them at the mercy of
  // whatever order the rows came back in. The visible number still rounds; the
  // ordering behind it does not.
  const pulseRanks = rankDescending(zComposite);
  const pointsRanks = rankDescending(rawPoints);
  const scheduleRanks = rankDescending(rawSchedule);
  const depthRanks = rankDescending(rawDepth);
  const formRanks = hasForm
    ? rankDescending(work.map((t) => t.formRatio))
    : work.map(() => null);
  // Rank 1 = hardest remaining schedule.
  const sosRanks = rankDescending(
    work.map((t) => sosByRoster.get(t.roster.sleeperRosterId) ?? 0),
  );
  const efficiencyRanks = rankDescending(work.map((t) => t.lineupEfficiency));
  const reliabilityRanks = rankDescending(work.map((t) => t.reliability));

  // Only rank positions this league actually starts. A league with no kicker
  // slot leaves every team on 0.0 K points, and ranking that produces a
  // twelve-way tie for first that means nothing.
  const startablePositions = new Set<PulsePosition>();
  for (const slot of slots) {
    for (const position of PULSE_SLOT_ELIGIBILITY[slot] ?? [])
      startablePositions.add(position);
  }

  const positionRankLookup: Record<string, (number | null)[]> = {};
  for (const position of PULSE_POSITIONS) {
    positionRankLookup[position] = startablePositions.has(position)
      ? rankDescending(
          work.map((t) =>
            t.positionPoints[position] > 0 ? t.positionPoints[position] : null,
          ),
        )
      : work.map(() => null);
  }

  // ---------- assemble ----------

  return work.map((team, i) => {
    const rosterId = team.roster.sleeperRosterId;
    const sim = simResults.get(rosterId);
    const games = gamesTotal(team);
    const expectedWins = sim?.expectedWins ?? 0;

    const positionRanks: Record<string, number | null> = {};
    const positionPoints: Record<string, number> = {};
    for (const position of PULSE_POSITIONS) {
      if (!startablePositions.has(position)) continue;
      positionRanks[position] = positionRankLookup[position][i];
      positionPoints[position] = round(team.positionPoints[position], 2);
    }

    const result: PowerPulseTeamResult = {
      rosterRowId: team.roster.id,
      sleeperRosterId: rosterId,
      teamName: team.roster.teamName,
      powerPulse: pulseValues[i],
      pulseRank: pulseRanks[i],
      scorePoints: zToDisplay(zPoints[i], settings.display),
      scorePointsRank: pointsRanks[i],
      scoreSchedule: zToDisplay(zSchedule[i], settings.display),
      scoreScheduleRank: scheduleRanks[i],
      scoreDepth: zToDisplay(zDepth[i], settings.display),
      scoreDepthRank: depthRanks[i],
      scoreForm: hasForm ? zToDisplay(zForm[i], settings.display) : null,
      scoreFormRank: formRanks[i],
      expectedPointsPerWeek: round(team.meanPoints, 2),
      expectedPointsStdev: round(team.sigma, 2),
      expectedWins: round(expectedWins, 2),
      projectedWins: round(expectedWins, 1),
      projectedLosses: round(Math.max(0, games - expectedWins), 1),
      projectedTies: 0,
      playoffOdds: round(sim?.playoffOdds ?? 0, 4),
      byeOdds: round(sim?.byeOdds ?? 0, 4),
      titleOdds: round(sim?.titleOdds ?? 0, 4),
      lastPlaceOdds: round(sim?.lastPlaceOdds ?? 0, 4),
      sosPoints: round(sosByRoster.get(rosterId) ?? 0, 2),
      sosRank: sosRanks[i],
      lineupEfficiency:
        team.lineupEfficiency === null ? null : round(team.lineupEfficiency, 4),
      lineupEfficiencyRank: efficiencyRanks[i],
      lineupPointsLost:
        team.lineupPointsLost === null ? null : round(team.lineupPointsLost, 2),
      reliabilityScore: round(team.reliability, 4),
      reliabilityRank: reliabilityRanks[i],
      weekly: weeklyDetail.get(rosterId) ?? [],
      drivers: [],
      components: {
        positionPoints,
        positionRanks,
        starters: team.starters,
        depthDropoffPct: round(team.depthDropoffPct, 4),
        unfilledSlotRate: round(team.unfilledSlotRate, 4),
        formRatio: team.formRatio === null ? null : round(team.formRatio, 4),
        usedLeagueScoring: team.usedLeagueScoring,
        weeksProjected: team.weekLineups.length,
      },
    };

    result.drivers = buildDrivers(result, work.length);
    return result;
  });
}

/** Error function, for the win probability shown in the weekly preview. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * The plain-language reasons behind a score. This is what turns Power Pulse
 * from a number into an argument, and it is the part a screen reader can read
 * usefully. Ordered strongest first, capped at four.
 */
function buildDrivers(
  result: PowerPulseTeamResult,
  teamCount: number,
): PowerPulseDriver[] {
  const drivers: PowerPulseDriver[] = [];
  const top = Math.max(1, Math.ceil(teamCount / 4));
  const bottom = teamCount - top + 1;

  if (result.scorePointsRank !== null && result.scorePointsRank <= top) {
    drivers.push({
      label: "Scores more than almost anyone",
      detail: `${ordinal(result.scorePointsRank)} in projected points per week at ${result.expectedPointsPerWeek.toFixed(1)}.`,
      tone: "good",
    });
  } else if (
    result.scorePointsRank !== null &&
    result.scorePointsRank >= bottom
  ) {
    drivers.push({
      label: "Not enough weekly scoring",
      detail: `${ordinal(result.scorePointsRank)} of ${teamCount} at ${result.expectedPointsPerWeek.toFixed(1)} projected points per week.`,
      tone: "bad",
    });
  }

  if (result.sosRank !== null) {
    if (result.sosRank >= bottom) {
      drivers.push({
        label: "Easy remaining schedule",
        detail: `Opponents average ${result.sosPoints.toFixed(1)} points per week, ${ordinal(teamCount - result.sosRank + 1)} lightest in the league.`,
        tone: "good",
      });
    } else if (result.sosRank <= top) {
      drivers.push({
        label: "Brutal remaining schedule",
        detail: `Opponents average ${result.sosPoints.toFixed(1)} points per week, ${ordinal(result.sosRank)} toughest in the league.`,
        tone: "bad",
      });
    }
  }

  // Best position, but only when the team actually produces there. A position
  // the league does not start scores zero for everyone and means nothing.
  const bestPosition = Object.entries(result.components.positionRanks)
    .filter(
      ([position, rank]) =>
        rank !== null &&
        rank <= Math.max(1, Math.ceil(teamCount / 6)) &&
        (result.components.positionPoints[position] ?? 0) > 0,
    )
    .sort((a, b) => (a[1] as number) - (b[1] as number))[0];
  if (bestPosition) {
    drivers.push({
      label: `${bestPosition[0]} room carries this team`,
      detail: `${ordinal(bestPosition[1] as number)} in weekly ${bestPosition[0]} output at ${(result.components.positionPoints[bestPosition[0]] ?? 0).toFixed(1)} points per week.`,
      tone: "good",
    });
  }

  if (result.components.depthDropoffPct > 0.16) {
    drivers.push({
      label: "Top heavy",
      detail: `Loses ${(result.components.depthDropoffPct * 100).toFixed(0)}% of weekly output when a position's best starter misses time.`,
      tone: "bad",
    });
  } else if (result.scoreDepthRank !== null && result.scoreDepthRank <= top) {
    drivers.push({
      label: "Deep enough to absorb injuries",
      detail: `Only loses ${(result.components.depthDropoffPct * 100).toFixed(0)}% of weekly output when a position's best starter misses time.`,
      tone: "good",
    });
  }

  if (
    result.lineupEfficiency !== null &&
    result.lineupEfficiency < 0.97 &&
    result.lineupPointsLost !== null &&
    result.lineupPointsLost > 0.5
  ) {
    drivers.push({
      label: "Points sitting on the bench",
      detail: `The current lineup captures ${(result.lineupEfficiency * 100).toFixed(0)}% of its best possible score, giving up ${result.lineupPointsLost.toFixed(1)} points.`,
      tone: "bad",
    });
  }

  if (
    result.components.formRatio !== null &&
    result.components.formRatio > 1.08
  ) {
    drivers.push({
      label: "Running hot",
      detail: `Scoring ${((result.components.formRatio - 1) * 100).toFixed(0)}% above projection over the last three weeks.`,
      tone: "good",
    });
  } else if (
    result.components.formRatio !== null &&
    result.components.formRatio < 0.92
  ) {
    drivers.push({
      label: "Running cold",
      detail: `Scoring ${((1 - result.components.formRatio) * 100).toFixed(0)}% below projection over the last three weeks.`,
      tone: "bad",
    });
  }

  if (drivers.length === 0) {
    drivers.push({
      label: "Middle of the pack",
      detail: `Projects for ${result.expectedPointsPerWeek.toFixed(1)} points per week with no standout strength or weakness.`,
      tone: "neutral",
    });
  }

  return drivers.slice(0, 4);
}

export { stdev };
