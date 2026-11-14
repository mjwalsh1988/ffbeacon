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
 *
 * SEEDING AND THE BRACKET FOLLOW THE LEAGUE'S OWN SETTINGS. Confirmed against
 * stored Sleeper brackets in production on 2026-11-13:
 *   - Division winners take the top seeds, ordered by record, and the rest of
 *     the field follows by record (a 32 team, 8 division league seeded a 7 win
 *     division winner over a 10 win runner-up).
 *   - playoff_seed_type 0 is a fixed bracket: seed 1 meets the winner of 4 v 5
 *     and seed 2 the winner of 3 v 6, whoever wins. Its later rounds carry
 *     t1_from / t2_from links in the stored bracket.
 *   - playoff_seed_type 1 reseeds every round: the top seed left meets the
 *     lowest seed left. Its later rounds carry no links at all.
 *   - playoff_type only shapes the losers bracket (0 is a toilet bowl where the
 *     worst teams get the byes, 1 a consolation bracket where the best
 *     non-playoff teams do). It never changes who can win the title, so it is
 *     read for the final order only (see lib/power-pulse/playoffs.ts).
 */

import { createRng, normalDraw } from "./math";
import type { ScheduleWeek, SimulationResult } from "./types";

export type SimTeam = {
  sleeperRosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /**
   * Projected mean and spread for each remaining week, playoff weeks included.
   * A playoff round reads the weeks it is played in, so a roster built for
   * weeks 15 to 17 is judged on weeks 15 to 17.
   */
  weeks: Map<number, { mean: number; sigma: number }>;
  /** Season-long mean and spread, the fallback for a week with no projection. */
  mean: number;
  sigma: number;
  /** Sleeper's settings.division for this roster. Absent or null: none. */
  division?: number | null;
};

export type SimOptions = {
  runs: number;
  seed: number;
  /** How many teams make the postseason. From Sleeper settings.playoff_teams. */
  playoffTeams: number;
  /** First playoff week. From Sleeper settings.playoff_week_start. */
  playoffWeekStart: number;
  /**
   * Sleeper's playoff_round_type. 0 is one week per round, 1 is two weeks for
   * every round, 2 is two weeks for the championship round only. Absent is
   * treated as 0, which is what this simulated before it read the setting.
   */
  playoffRoundType?: number;
  /**
   * Sleeper's league_average_match. When true, every team also plays the
   * league median each remaining week: above the median is a second win,
   * below it a second loss, level with it half of each. The seeded record
   * already counts the played weeks' median results, so a league with the
   * setting on and a simulation that ignores it has a record growing by one a
   * week that started out growing by two. Absent is treated as off.
   */
  medianMatch?: boolean;
  /**
   * Sleeper's playoff_seed_type: 0 is a fixed bracket, 1 reseeds every round.
   * Absent reseeds, which is what this simulated before it read the setting;
   * loadLeague always fills it.
   */
  playoffSeedType?: number;
  /**
   * Sleeper's settings.divisions. Above zero, and with every team carrying a
   * division, the division winners take the top seeds.
   */
  divisions?: number;
  /**
   * Title games already played, keyed by pairKey of the two roster ids, to the
   * winner. A pairing the bracket has already settled is never redrawn.
   */
  playedPlayoffGames?: ReadonlyMap<string, number>;
  /** Rosters that have lost a title game. They cannot win another one. */
  eliminatedFromTitle?: ReadonlySet<number>;
  /**
   * The roster ids the stored bracket puts in the field. Used only when it
   * names exactly the field size, so a bracket caught half-filled falls back
   * to seeding the standings.
   */
  playoffField?: readonly number[] | null;
};

/** The median of the scores drawn this week. Even counts average the middle two. */
export function weekMedian(scores: readonly number[]): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Order-free key for one pairing of two rosters. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Sleeper's three playoff round shapes. */
const ROUND_ONE_WEEK = 0;
const ROUND_TWO_WEEKS = 1;
const ROUND_TWO_WEEK_FINAL = 2;

/** Sleeper's playoff_seed_type values. */
export const SEED_FIXED = 0;
export const SEED_RESEED = 1;

/** Next power of two at or above n. Drives how many first-round byes exist. */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** How many weeks a bracket of `fieldSize` teams runs under a round type. */
export function playoffWeekCount(fieldSize: number, roundType: number | undefined): number {
  if (fieldSize < 2) return 0;
  const rounds = Math.round(Math.log2(nextPowerOfTwo(fieldSize)));
  if (roundType === ROUND_TWO_WEEKS) return rounds * 2;
  if (roundType === ROUND_TWO_WEEK_FINAL) return rounds + 1;
  return rounds;
}

/**
 * The standard bracket order for `size` slots (a power of two): seed 1 and
 * seed 2 can only meet in the final, and the top seed meets the lowest one
 * first. [1, 8, 4, 5, 2, 7, 3, 6] for eight, which is the shape Sleeper's
 * fixed brackets have in production.
 */
export function standardSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const width = order.length * 2;
    order = order.flatMap((s) => [s, width + 1 - s]);
  }
  return order;
}

/**
 * Indices in seed order. By record (wins then points for, index last so the
 * order never depends on sort stability), with the division winners lifted to
 * the top seeds when the league plays divisions.
 */
export function seedIndices(
  n: number,
  wins: ArrayLike<number>,
  points: ArrayLike<number>,
  divisionOf: ReadonlyArray<number | null> | null,
  playoffTeams: number,
): number[] {
  const byRecord = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => wins[b] - wins[a] || points[b] - points[a] || a - b,
  );
  if (!divisionOf) return byRecord;
  const winners: number[] = [];
  const seen = new Set<number>();
  for (const i of byRecord) {
    const division = divisionOf[i];
    if (division === null || division === undefined || seen.has(division)) continue;
    seen.add(division);
    winners.push(i);
  }
  const lifted = winners.slice(0, Math.max(0, playoffTeams));
  const liftedSet = new Set(lifted);
  return [...lifted, ...byRecord.filter((i) => !liftedSet.has(i))];
}

/** The division of every team, or null when the league does not seed by division. */
export function divisionsFor(
  teams: ReadonlyArray<{ division?: number | null }>,
  divisions: number | undefined,
): Array<number | null> | null {
  if (!divisions || divisions <= 0) return null;
  const out = teams.map((t) =>
    typeof t.division === "number" && Number.isFinite(t.division) && t.division > 0 ? t.division : null,
  );
  return out.every((d) => d !== null) ? out : null;
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
  const byeCount =
    playoffTeams > 0 ? nextPowerOfTwo(playoffTeams) - playoffTeams : 0;
  const reseed = (options.playoffSeedType ?? SEED_RESEED) !== SEED_FIXED;
  const divisionOf = divisionsFor(teams, options.divisions);

  // The stored bracket's field, when it names exactly the field size.
  const fieldOverride =
    options.playoffField &&
    options.playoffField.length === playoffTeams &&
    options.playoffField.every((id) => index.has(id))
      ? new Set(options.playoffField.map((id) => index.get(id) as number))
      : null;

  // Only regular season weeks drive seeding.
  const regularSeason = schedule.filter(
    (w) => w.week < options.playoffWeekStart,
  );

  const roundType = options.playoffRoundType ?? ROUND_ONE_WEEK;
  /** How many weeks one round runs, given whether it is the championship. */
  const weeksForRound = (isFinal: boolean): number => {
    if (roundType === ROUND_TWO_WEEKS) return 2;
    if (roundType === ROUND_TWO_WEEK_FINAL && isFinal) return 2;
    return 1;
  };
  /** The weeks round `k` (0 based) is played in. */
  const roundWeeks = (k: number, isFinal: boolean): number[] => {
    const first =
      roundType === ROUND_TWO_WEEKS
        ? options.playoffWeekStart + 2 * k
        : options.playoffWeekStart + k;
    return Array.from({ length: weeksForRound(isFinal) }, (_, j) => first + j);
  };

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

  /**
   * One team's score for a round, summed over the weeks that round runs.
   *
   * A two-week round is not cosmetic. Summing two independent draws leaves the
   * mean doubled but the spread only sqrt(2) times wider, so the noise falls
   * by about 30 percent relative to the gap between two teams and the better
   * roster wins more often. Each week reads that week's own projected lineup,
   * so a roster whose stars are hurt in week 15 and back in week 16 is judged
   * on exactly that.
   */
  const roundScore = (team: number, weeks: number[]): number => {
    let total = 0;
    for (const w of weeks) {
      const projection = teams[team].weeks.get(w);
      total += projection
        ? normalDraw(rng, projection.mean, projection.sigma)
        : normalDraw(rng, teams[team].mean, teams[team].sigma);
    }
    return total;
  };

  /** One playoff game: a settled result if the bracket has one, else a draw. */
  const decide = (a: number, b: number, k: number, isFinal: boolean): number => {
    const ra = teams[a].sleeperRosterId;
    const rb = teams[b].sleeperRosterId;
    const known = options.playedPlayoffGames?.get(pairKey(ra, rb));
    if (known === ra) return a;
    if (known === rb) return b;
    const outA = options.eliminatedFromTitle?.has(ra) === true;
    const outB = options.eliminatedFromTitle?.has(rb) === true;
    if (outA && !outB) return b;
    if (outB && !outA) return a;
    const weeks = roundWeeks(k, isFinal);
    const scoreA = roundScore(a, weeks);
    const scoreB = roundScore(b, weeks);
    return scoreA >= scoreB ? a : b;
  };

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
      // The median game, for leagues that play one. Every team that has a
      // head-to-head game this week is measured against the median of the
      // week's scores, which is how Sleeper does it: a team on a bye week in
      // the league's own schedule is not in the pool and gets no result.
      if (options.medianMatch) {
        const playing: number[] = [];
        for (const [rosterId] of week.opponents) {
          const i = index.get(rosterId);
          if (i !== undefined) playing.push(i);
        }
        if (playing.length > 0) {
          const median = weekMedian(playing.map((i) => weekScores[i]));
          for (const i of playing) {
            if (weekScores[i] > median) wins[i] += 1;
            else if (weekScores[i] === median) wins[i] += 0.5;
          }
        }
      }
    }

    for (let i = 0; i < n; i += 1) totalWins[i] += wins[i];

    // Last place is the bottom of the plain standings; division titles do not
    // lift anyone off it.
    const byRecord = seedIndices(n, wins, points, null, playoffTeams);
    finishedLast[byRecord[n - 1]] += 1;

    if (playoffTeams < 2) continue;

    const order = divisionOf
      ? seedIndices(n, wins, points, divisionOf, playoffTeams)
      : byRecord;
    const field = fieldOverride
      ? order.filter((i) => fieldOverride.has(i))
      : order.slice(0, playoffTeams);
    for (const i of field) madePlayoffs[i] += 1;
    for (let i = 0; i < byeCount && i < field.length; i += 1)
      gotBye[field[i]] += 1;

    const champion = reseed
      ? reseedBracket(field, byeCount, decide)
      : fixedBracket(field, decide);
    if (champion !== null) wonTitle[champion] += 1;
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

type Decide = (a: number, b: number, round: number, isFinal: boolean) => number;

/**
 * A fixed bracket. Seeds sit in the standard bracket order and winners move
 * along it, so seed 1 meets the winner of 4 v 5 however that game goes.
 * Empty slots are first-round byes.
 */
function fixedBracket(field: number[], decide: Decide): number | null {
  if (field.length === 0) return null;
  const size = nextPowerOfTwo(field.length);
  let slots: Array<number | null> = standardSeedOrder(size).map((s) =>
    s <= field.length ? field[s - 1] : null,
  );
  let round = 0;
  while (slots.length > 1) {
    const isFinal = slots.length === 2;
    const next: Array<number | null> = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      if (a === null) next.push(b);
      else if (b === null) next.push(a);
      else next.push(decide(a, b, round, isFinal));
    }
    slots = next;
    round += 1;
  }
  return slots[0] ?? null;
}

/**
 * A reseeded bracket. Teams holding a first-round bye sit out round one; after
 * that the field is reseeded every round so the top remaining seed always
 * draws the bottom remaining seed.
 */
function reseedBracket(field: number[], byeCount: number, decide: Decide): number | null {
  if (field.length === 0) return null;
  const seedOf = new Map<number, number>();
  field.forEach((teamIndex, seed) => seedOf.set(teamIndex, seed));
  const bySeed = (a: number, b: number) => (seedOf.get(a) ?? 0) - (seedOf.get(b) ?? 0);

  /** Pair best against worst; an odd team out advances unopposed. */
  const playRound = (entrants: number[], round: number, isFinal: boolean): number[] => {
    const winners: number[] = [];
    let lo = 0;
    let hi = entrants.length - 1;
    while (lo < hi) {
      winners.push(decide(entrants[lo], entrants[hi], round, isFinal));
      lo += 1;
      hi -= 1;
    }
    if (lo === hi) winners.push(entrants[lo]);
    return winners.sort(bySeed);
  };

  let round = 0;
  let remaining = field.slice();
  if (byeCount > 0 && remaining.length > byeCount) {
    const onBye = remaining.slice(0, byeCount);
    const playIn = playRound(remaining.slice(byeCount), round, false);
    remaining = [...onBye, ...playIn].sort(bySeed);
    round += 1;
  }
  // Each pass at least halves the field (rounded up), so this terminates.
  while (remaining.length > 1) {
    // The final is the round that leaves exactly one team standing, which is
    // the one with two entrants. Round type 2 lengthens only that one.
    remaining = playRound(remaining, round, remaining.length <= 2);
    round += 1;
  }
  return remaining[0] ?? null;
}
