/**
 * One chopped (guillotine) week, framed around the cut line.
 *
 * A chopped league has no opponent: the lowest score in the whole league goes
 * out, whoever it was drawn against. So the week is four figures, not a
 * scoreline: your score, the lowest score among everyone else still alive, the
 * margin between them, and your chance of staying above it.
 *
 * The chance is the same simulation lib/chopped/survival.ts plays for a whole
 * season, run for this one week, with each team's points already scored banked
 * and only what its starters still project left to draw. A settled week is not
 * simulated: the team either went out that week or it did not. Pure.
 */

import { simulateSurvival, type SurvivalTeam } from "./survival";

export type CutLineTeam = {
  rosterId: number;
  teamName: string;
  /** Points on the board this week: final, or so far. */
  score: number | null;
  /** Expected final total for the week: banked plus what is still to come. */
  expected: number | null;
  /** Spread of what is still to come. */
  sigma: number;
  /** Season points so far, which breaks a tie at the bottom. */
  seasonPoints: number;
  /** The week this roster was chopped, or null while alive. */
  eliminatedWeek: number | null;
};

export type CutLineWeek = {
  score: number | null;
  lowestOther: number | null;
  lowestTeamName: string | null;
  margin: number | null;
  survivalChance: number | null;
  aliveCount: number;
  alreadyOut: boolean;
};

/** Enough runs for a percent that holds still between renders. */
const RUNS = 4000;
const SEED = 20260913;

export function buildCutLineWeek(input: {
  rosterId: number;
  week: number;
  isFinal: boolean;
  teams: CutLineTeam[];
}): CutLineWeek {
  const { rosterId, week, isFinal } = input;
  // Alive going into this week: never chopped, or chopped this week or later.
  const alive = input.teams.filter((t) => t.eliminatedWeek === null || t.eliminatedWeek >= week);
  const me = input.teams.find((t) => t.rosterId === rosterId) ?? null;
  const alreadyOut = me !== null && me.eliminatedWeek !== null && me.eliminatedWeek < week;
  const others = alive.filter((t) => t.rosterId !== rosterId && t.score !== null);

  let lowest: CutLineTeam | null = null;
  for (const team of others) {
    if (team.score === null) continue;
    if (lowest === null || (lowest.score !== null && team.score < lowest.score)) lowest = team;
  }

  const anyScored = alive.some((t) => t.score !== null && t.score !== 0);
  const score = me && (anyScored || isFinal) ? me.score : null;
  const lowestOther = lowest && (anyScored || isFinal) ? lowest.score : null;
  const margin = score !== null && lowestOther !== null ? Math.round((score - lowestOther) * 100) / 100 : null;

  let survivalChance: number | null = null;
  if (alreadyOut || !me) {
    survivalChance = null;
  } else if (isFinal) {
    survivalChance = me.eliminatedWeek === week ? 0 : 1;
  } else {
    const field: SurvivalTeam[] = alive
      .filter((t) => t.expected !== null)
      .map((t) => ({
        rosterId: t.rosterId,
        seasonPoints: t.seasonPoints,
        weeks: new Map([[week, { mean: t.expected as number, sigma: t.sigma }]]),
      }));
    if (field.length > 1 && field.some((t) => t.rosterId === rosterId)) {
      const result = simulateSurvival(field, [week], { runs: RUNS, seed: SEED });
      const mine = result.get(rosterId);
      survivalChance = mine ? 1 - mine.pChoppedThisWeek : null;
    }
  }

  return {
    score,
    lowestOther,
    lowestTeamName: lowestOther !== null ? (lowest?.teamName ?? null) : null,
    margin,
    survivalChance,
    aliveCount: alive.length,
    alreadyOut,
  };
}
