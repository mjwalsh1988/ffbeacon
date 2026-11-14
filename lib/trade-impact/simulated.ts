/**
 * The season figures a suggestion card takes from the full evaluation once it
 * has run.
 *
 * The card opens on an estimate (a derivative of the Power Pulse season, cheap
 * enough to score hundreds of candidate deals). The evaluation under it runs the
 * real simulation for the one deal on screen. Showing both would put two
 * projected-wins figures for one deal on one screen, so once the evaluation
 * lands the card reads these instead. Both start from the same Power Pulse
 * "before"; only the change differs between estimate and simulation.
 *
 * Pure, and plain JSON, so it can live in client state.
 */

import type { TradeImpact } from "./types";

export type SimulatedFigures = {
  winsBefore: number | null;
  winsAfter: number | null;
  /** Chopped only: this week's survival odds, before and after. */
  survivalBefore: number | null;
  survivalAfter: number | null;
  /** The shared lineup change, points per week. */
  lineupDelta: number | null;
};

export function simulatedFrom(impact: TradeImpact): SimulatedFigures {
  const mine = impact.mine;
  return {
    winsBefore: impact.gaps.simulation ? null : mine.projectedWinsBefore,
    winsAfter: impact.gaps.simulation ? null : mine.projectedWinsAfter,
    survivalBefore: mine.survivalBefore ?? null,
    survivalAfter: mine.survivalAfter ?? null,
    lineupDelta: impact.gaps.lineup ? null : mine.lineupDelta,
  };
}
