/**
 * Monte Carlo survival simulation for chopped (guillotine) leagues.
 *
 * A chopped league has no bracket, so there is no playoff odds number to
 * compute and no head to head slate to resolve. What a manager wants to know
 * is narrower and harsher: what are the odds I am the lowest score in the
 * whole league this week, and if I am not, how far does this roster carry me.
 * Neither question has a closed form, because being chopped in week 9 depends
 * on which eleven teams are still in the league by then, which depends on
 * every week before it. So we play the rest of the season out thousands of
 * times and count.
 *
 * The generator is seeded and the same seed is used for the before and the
 * after simulation of a waiver claim, so the difference between the two is the
 * player and not the dice. Without that, a claim worth nothing would show a
 * survival swing of a point or two in either direction and the ladder would
 * price noise.
 *
 * Cost is small at league scale. Thirty two teams, sixteen weeks and a few
 * thousand runs is a few million draws, and the hot loop allocates nothing:
 * every per run buffer is allocated once and rewritten.
 */

import { createRng, normalDraw } from "../power-pulse/math";

export type SurvivalTeam = {
  rosterId: number;
  /** Points already banked this season. Drives the tiebreak, and the finish. */
  seasonPoints: number;
  /** Projected mean and spread for each remaining week. */
  weeks: Map<number, { mean: number; sigma: number }>;
};

export type SurvivalResult = {
  rosterId: number;
  /** Chance of being chopped in the FIRST week of the simulated list. */
  pChoppedThisWeek: number;
  /** Week number to the chance of still being alive once that week resolved. */
  pAliveAfter: Map<number, number>;
  /** Weeks survived out of the simulated list, averaged over runs. */
  expectedWeeksAlive: number;
  /** Chance of being the last team standing. */
  pWin: number;
};

export type SurvivalOptions = {
  runs: number;
  seed: number;
  /** Rosters chopped per week. Sleeper chops one; presets may chop more. */
  choppedPerWeek?: number;
};

/**
 * Play the rest of a chopped season `runs` times.
 *
 * `teams` must hold only the rosters that are still alive: an eliminated team
 * cannot be chopped again and its points cannot win anything, so leaving one
 * in would both dilute everybody's chop odds and hand the field a corpse to
 * finish below.
 */
export function simulateSurvival(
  teams: SurvivalTeam[],
  weeks: number[],
  options: SurvivalOptions,
): Map<number, SurvivalResult> {
  const out = new Map<number, SurvivalResult>();
  const n = teams.length;
  if (n === 0) return out;

  const weekCount = weeks.length;
  const runs = Math.max(1, Math.floor(options.runs) || 1);
  const perWeek = Math.max(1, Math.floor(options.choppedPerWeek ?? 1) || 1);

  // Flatten the weekly distributions into two dense arrays indexed by
  // (team * weekCount + weekIndex). The inner loop runs runs * weeks * teams
  // times, and a Map lookup there is the single most expensive thing in the
  // function for no benefit: the shape is fixed before the first draw.
  const meanAt = new Float64Array(n * weekCount);
  const sigmaAt = new Float64Array(n * weekCount);
  for (let i = 0; i < n; i += 1) {
    const team = teams[i];
    // A team with no projection for a week plays at its own average week
    // rather than at zero. Zero would chop it immediately and report a
    // certainty that is really a missing row. A team with no weeks at all
    // falls to zero, which is the honest reading of a roster we cannot score.
    let sumMean = 0;
    let sumSigma = 0;
    let known = 0;
    for (const entry of team.weeks.values()) {
      if (!Number.isFinite(entry.mean) || !Number.isFinite(entry.sigma))
        continue;
      sumMean += entry.mean;
      sumSigma += entry.sigma;
      known += 1;
    }
    const fallbackMean = known > 0 ? sumMean / known : 0;
    const fallbackSigma = known > 0 ? sumSigma / known : 0;
    for (let w = 0; w < weekCount; w += 1) {
      const entry = team.weeks.get(weeks[w]);
      const usable =
        entry && Number.isFinite(entry.mean) && Number.isFinite(entry.sigma);
      meanAt[i * weekCount + w] = usable ? entry.mean : fallbackMean;
      sigmaAt[i * weekCount + w] = usable
        ? Math.max(0, entry.sigma)
        : Math.max(0, fallbackSigma);
    }
  }

  const startPoints = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    startPoints[i] = Number.isFinite(teams[i].seasonPoints)
      ? teams[i].seasonPoints
      : 0;
  }

  const rng = createRng(options.seed);

  // Accumulators across runs.
  const choppedFirstWeek = new Float64Array(n);
  const aliveAfter = new Float64Array(n * weekCount);
  const weeksAlive = new Float64Array(n);
  const wins = new Float64Array(n);

  // Per run buffers, allocated once.
  const alive = new Uint8Array(n);
  const points = new Float64Array(n);
  const scores = new Float64Array(n);

  for (let run = 0; run < runs; run += 1) {
    for (let i = 0; i < n; i += 1) {
      alive[i] = 1;
      points[i] = startPoints[i];
      scores[i] = 0;
    }
    let aliveCount = n;

    for (let w = 0; w < weekCount; w += 1) {
      // A league already down to one team has nothing left to chop. The
      // remaining weeks still count as survived for that team, which is why
      // the alive tally below runs for every week rather than stopping here.
      if (aliveCount > 1) {
        for (let i = 0; i < n; i += 1) {
          if (alive[i] === 0) continue;
          const idx = i * weekCount + w;
          const score = normalDraw(rng, meanAt[idx], sigmaAt[idx]);
          scores[i] = score;
          points[i] += score;
        }

        // Chop the lowest scores of the week, one at a time, never below a
        // single survivor. Ties go to the lower season total, which is
        // Sleeper's rule. Sleeper's week one tiebreak is the reverse draft
        // slot, and it is deliberately ignored: we do not store draft order
        // here, an exact tie between two floating point score draws is
        // vanishingly rare outside a zero variance test, and the season total
        // is the right answer for every other week anyway.
        for (let k = 0; k < perWeek && aliveCount > 1; k += 1) {
          let worst = -1;
          for (let i = 0; i < n; i += 1) {
            if (alive[i] === 0) continue;
            if (worst === -1) {
              worst = i;
              continue;
            }
            if (scores[i] < scores[worst]) worst = i;
            else if (scores[i] === scores[worst] && points[i] < points[worst])
              worst = i;
          }
          if (worst === -1) break;
          alive[worst] = 0;
          aliveCount -= 1;
          if (w === 0) choppedFirstWeek[worst] += 1;
        }
      }

      for (let i = 0; i < n; i += 1) {
        if (alive[i] === 0) continue;
        aliveAfter[i * weekCount + w] += 1;
        weeksAlive[i] += 1;
      }
    }

    // The last team standing wins. If the week list ran out with several teams
    // still in, the most total points takes it, which is how a chopped league
    // settles a season that ends on the calendar rather than on a chop.
    let champion = -1;
    for (let i = 0; i < n; i += 1) {
      if (alive[i] === 0) continue;
      if (champion === -1 || points[i] > points[champion]) champion = i;
    }
    if (champion !== -1) wins[champion] += 1;
  }

  for (let i = 0; i < n; i += 1) {
    const pAliveAfter = new Map<number, number>();
    for (let w = 0; w < weekCount; w += 1) {
      pAliveAfter.set(weeks[w], aliveAfter[i * weekCount + w] / runs);
    }
    out.set(teams[i].rosterId, {
      rosterId: teams[i].rosterId,
      pChoppedThisWeek: weekCount > 0 ? choppedFirstWeek[i] / runs : 0,
      pAliveAfter,
      expectedWeeksAlive: weeksAlive[i] / runs,
      pWin: wins[i] / runs,
    });
  }
  return out;
}
