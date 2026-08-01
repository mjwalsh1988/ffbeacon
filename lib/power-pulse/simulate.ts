/**
 * Monte Carlo season simulation.
 *
 * Expected wins from a per-week win probability is easy, but it cannot answer
 * "what are my playoff odds", because making the playoffs depends on how every
 * other team's season breaks at the same time. So we play the rest of the
 * season out thousands of times: draw each team's weekly score from its own
 * distribution, resolve the real head-to-head slate, seed the field by the
 * league's own rules, and run the bracket.
 *
 * The generator is seeded, so the same roster state produces the same odds on
 * every recompute. A user reloading the page must not watch their title odds
 * wander by a point because we reran the dice.
 *
 * Cost is trivial at league scale: 12 teams across 14 remaining weeks at 4,000
 * runs is well under a second.
 */

import { createRng, normalDraw } from "./math";
import type { ScheduleWeek, SimulationResult } from "./types";

export type SimTeam = {
  sleeperRosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Projected mean and spread for each remaining week. */
  weeks: Map<number, { mean: number; sigma: number }>;
  /** Season-long mean and spread, used for playoff rounds. */
  mean: number;
  sigma: number;
};

export type SimOptions = {
  runs: number;
  seed: number;
  /** How many teams make the postseason. From Sleeper settings.playoff_teams. */
  playoffTeams: number;
  /** First playoff week. From Sleeper settings.playoff_week_start. */
  playoffWeekStart: number;
};

/** Next power of two at or above n. Drives how many first-round byes exist. */
function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Simulate the remaining regular season and postseason.
 *
 * `schedule` should hold only unplayed weeks; completed weeks are already
 * reflected in each team's wins / losses / pointsFor.
 */
export function simulateSeason(
  teams: SimTeam[],
  schedule: ScheduleWeek[],
  options: SimOptions,
): Map<number, SimulationResult> {
  const out = new Map<number, SimulationResult>();
  if (teams.length === 0) return out;

  const n = teams.length;
  const index = new Map<number, number>();
  teams.forEach((t, i) => index.set(t.sleeperRosterId, i));

  const playoffTeams = Math.max(0, Math.min(options.playoffTeams, n));
  const byeCount = playoffTeams > 0 ? nextPowerOfTwo(playoffTeams) - playoffTeams : 0;

  // Only regular season weeks drive seeding.
  const regularSeason = schedule.filter((w) => w.week < options.playoffWeekStart);

  const rng = createRng(options.seed);

  const totalWins = new Array<number>(n).fill(0);
  const madePlayoffs = new Array<number>(n).fill(0);
  const gotBye = new Array<number>(n).fill(0);
  const wonTitle = new Array<number>(n).fill(0);
  const finishedLast = new Array<number>(n).fill(0);

  const wins = new Array<number>(n);
  const points = new Array<number>(n);
  const weekScores = new Array<number>(n);

  const runs = Math.max(1, options.runs);

  for (let run = 0; run < runs; run += 1) {
    for (let i = 0; i < n; i += 1) {
      wins[i] = teams[i].wins + teams[i].ties * 0.5;
      points[i] = teams[i].pointsFor;
    }

    for (const week of regularSeason) {
      for (let i = 0; i < n; i += 1) {
        const projection = teams[i].weeks.get(week.week);
        weekScores[i] = projection
          ? normalDraw(rng, projection.mean, projection.sigma)
          : normalDraw(rng, teams[i].mean, teams[i].sigma);
        points[i] += weekScores[i];
      }
      // Resolve each pairing once. The opponents map holds both directions, so
      // only act on the side with the lower roster id.
      for (const [rosterId, opponentId] of week.opponents) {
        if (rosterId > opponentId) continue;
        const a = index.get(rosterId);
        const b = index.get(opponentId);
        if (a === undefined || b === undefined) continue;
        if (weekScores[a] > weekScores[b]) wins[a] += 1;
        else if (weekScores[b] > weekScores[a]) wins[b] += 1;
        else {
          wins[a] += 0.5;
          wins[b] += 0.5;
        }
      }
    }

    for (let i = 0; i < n; i += 1) totalWins[i] += wins[i];

    // Seed by wins, then points for, which is Sleeper's default tiebreak.
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => wins[b] - wins[a] || points[b] - points[a],
    );
    finishedLast[order[n - 1]] += 1;

    if (playoffTeams < 2) continue;

    const field = order.slice(0, playoffTeams);
    for (const i of field) madePlayoffs[i] += 1;
    for (let i = 0; i < byeCount && i < field.length; i += 1) gotBye[field[i]] += 1;

    // Bracket. Teams holding a first-round bye sit out round one; after that
    // the field is reseeded every round so the top remaining seed always draws
    // the bottom remaining seed.
    const seedOf = new Map<number, number>();
    field.forEach((teamIndex, seed) => seedOf.set(teamIndex, seed));
    const bySeed = (a: number, b: number) => (seedOf.get(a) ?? 0) - (seedOf.get(b) ?? 0);

    /** Pair best against worst; an odd team out advances unopposed. */
    const playRound = (entrants: number[]): number[] => {
      const winners: number[] = [];
      let lo = 0;
      let hi = entrants.length - 1;
      while (lo < hi) {
        const a = entrants[lo];
        const b = entrants[hi];
        const scoreA = normalDraw(rng, teams[a].mean, teams[a].sigma);
        const scoreB = normalDraw(rng, teams[b].mean, teams[b].sigma);
        winners.push(scoreA >= scoreB ? a : b);
        lo += 1;
        hi -= 1;
      }
      if (lo === hi) winners.push(entrants[lo]);
      return winners.sort(bySeed);
    };

    let remaining = field.slice();
    if (byeCount > 0 && remaining.length > byeCount) {
      const onBye = remaining.slice(0, byeCount);
      const playIn = playRound(remaining.slice(byeCount));
      remaining = [...onBye, ...playIn].sort(bySeed);
    }
    // Each pass at least halves the field (rounded up), so this terminates.
    while (remaining.length > 1) {
      remaining = playRound(remaining);
    }
    if (remaining.length === 1) wonTitle[remaining[0]] += 1;
  }

  for (let i = 0; i < n; i += 1) {
    out.set(teams[i].sleeperRosterId, {
      expectedWins: totalWins[i] / runs,
      playoffOdds: madePlayoffs[i] / runs,
      byeOdds: gotBye[i] / runs,
      titleOdds: wonTitle[i] / runs,
      lastPlaceOdds: finishedLast[i] / runs,
    });
  }
  return out;
}
