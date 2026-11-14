/**
 * The one win chance League Pulse quotes for a head-to-head week.
 *
 * YOUR SET LINEUP AGAINST THEIR SET LINEUP, CONDITIONED ON WHAT IS ALREADY
 * SCORED. The Schedule board, the matchup page and the Lineups what-if all call
 * this, so the same game cannot carry three different percentages on three
 * tabs. Pure and client-safe: no Supabase, no clock of its own.
 *
 * Each starter is in one of three states:
 *
 *   NOT STARTED   his whole projection is still to come, with its spread.
 *   PLAYING       his points so far are banked, and what is left of his
 *                 projection (never below zero) is still to come, with the
 *                 spread scaled down to the share of the projection that is left.
 *   FINISHED      his points are banked and nothing more is coming.
 *
 * Banked points carry no spread. So as games finish, the spread shrinks and the
 * chance moves toward 0 or 1, which is the "it moves as games finish" rule.
 *
 * A starter with no projection who has not played adds nothing, the same rule
 * every lineup total on the site follows: an unknown is not a zero, and it is
 * not a guess either.
 */

import { winProbability } from "@/lib/power-pulse/math";

/** How long after kickoff a game is treated as over, when nothing says so. */
export const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;

export type StarterState = {
  projected: number | null;
  sigma: number | null;
  /** Points scored so far. Null or 0 before he plays. */
  actual: number | null;
  /** His game has kicked off. */
  started: boolean;
  /** His game is over. Implies started. */
  finished: boolean;
};

export type SideState = {
  /** Points already on the board from starters whose games have started. */
  banked: number;
  /** Projected points still to come. */
  remainingMean: number;
  /** Spread of the points still to come. */
  remainingSigma: number;
  /** True when at least one starter could be scored or projected at all. */
  known: boolean;
};

/** Where a game stands, from its kickoff and the clock the caller holds. */
export function gameClock(
  kickoffAt: string | null | undefined,
  nowMs: number | null,
  actual: number | null,
): { started: boolean; finished: boolean } {
  const kickoff = kickoffAt ? Date.parse(kickoffAt) : Number.NaN;
  if (nowMs !== null && Number.isFinite(kickoff)) {
    const started = kickoff <= nowMs;
    return { started, finished: started && nowMs >= kickoff + GAME_LENGTH_MS };
  }
  // No kickoff on record: the only evidence of a game is points on the board.
  const scored = actual !== null && Number.isFinite(actual) && actual !== 0;
  return { started: scored, finished: false };
}

/** Sum a side's starters into banked points and what is still to come. */
export function sideState(starters: StarterState[]): SideState {
  let banked = 0;
  let mean = 0;
  let variance = 0;
  let known = false;
  for (const s of starters) {
    const actual = s.actual !== null && Number.isFinite(s.actual) ? s.actual : 0;
    const projected = s.projected !== null && Number.isFinite(s.projected) ? s.projected : null;
    const sigma = s.sigma !== null && Number.isFinite(s.sigma) ? Math.max(0, s.sigma) : 0;
    if (s.finished) {
      banked += actual;
      known = true;
      continue;
    }
    if (s.started) {
      banked += actual;
      known = true;
      if (projected !== null && projected > 0) {
        const left = Math.max(0, projected - actual);
        const share = Math.min(1, left / projected);
        mean += left;
        variance += sigma * sigma * share;
      }
      continue;
    }
    if (projected === null) continue;
    known = true;
    mean += projected;
    variance += sigma * sigma;
  }
  return { banked, remainingMean: mean, remainingSigma: Math.sqrt(variance), known };
}

/**
 * Chance side A finishes ahead of side B, 0 to 1. Null when either side has
 * nothing we can score or project.
 */
export function liveWinChance(a: SideState, b: SideState): number | null {
  if (!a.known || !b.known) return null;
  return winProbability(
    a.banked + a.remainingMean,
    a.remainingSigma,
    b.banked + b.remainingMean,
    b.remainingSigma,
  );
}

/** A side's expected final total: banked plus what is still to come. */
export function expectedTotal(side: SideState): number | null {
  return side.known ? side.banked + side.remainingMean : null;
}
