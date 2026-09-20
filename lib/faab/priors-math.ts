/**
 * Reading the market: which price cell applies, and what it says.
 *
 * Two jobs, both small, and both PURE so the browser can do them. Manual mode
 * has no league to simulate, so its win curve is this cell's own distribution,
 * computed client side as the reader drags the controls.
 *
 * `pickCell` walks a deliberate fallback ladder. The exact cell for a reader's
 * situation is often thin (a superflex dynasty tight end in weeks 11 to 13
 * with three bidders is not a common auction), and a quantile over four
 * samples is noise wearing a number's clothes. So we drop one dimension at a
 * time, in the order that costs the least accuracy, until the cell has enough
 * samples to mean something, and we report which rung we landed on so the page
 * can say so out loud.
 *
 * `priorCdf` turns a cell into a win curve: the chance a bid of b wins is the
 * chance the clearing price was at or below b, which is exactly what these
 * quantiles describe.
 */

import type { PriorBidders, PriorLeagueKind } from "./priors-build";

export type PriorCell = {
  cellKey: string;
  leagueKind: PriorLeagueKind | "any";
  superflex: "yes" | "no" | "any";
  position: string;
  phase: string;
  bidders: PriorBidders | "any";
  sampleSize: number;
  zeroShare: number;
  p05: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  runnerUpRatioP50: number | null;
  leaguesCount: number;
  seasons: number[];
  builtAt: string;
};

export type PriorWant = {
  leagueKind: PriorLeagueKind | "any";
  superflex: boolean | null;
  position: string | null;
  phase: string | null;
  bidders: PriorBidders | "any";
};

export type PickedCell = {
  cell: PriorCell;
  /**
   * Which dimensions were widened to find enough samples, in plain words.
   * Null when the exact cell was used.
   */
  fellBackTo: string | null;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** One stored row as the rest of the code wants it. */
export function toPriorCell(row: Record<string, unknown>): PriorCell {
  return {
    cellKey: String(row.cell_key),
    leagueKind: row.league_kind as PriorCell["leagueKind"],
    superflex: row.superflex as PriorCell["superflex"],
    position: String(row.position),
    phase: String(row.phase),
    bidders: row.bidders as PriorCell["bidders"],
    sampleSize: num(row.sample_size),
    zeroShare: num(row.zero_share),
    p05: num(row.p05),
    p10: num(row.p10),
    p25: num(row.p25),
    p50: num(row.p50),
    p75: num(row.p75),
    p90: num(row.p90),
    p95: num(row.p95),
    p99: num(row.p99),
    runnerUpRatioP50: row.runner_up_ratio_p50 === null ? null : num(row.runner_up_ratio_p50),
    leaguesCount: num(row.leagues_count),
    seasons: Array.isArray(row.seasons) ? row.seasons.map((s) => num(s)) : [],
    builtAt: String(row.built_at ?? ""),
  };
}

function keyFor(want: {
  leagueKind: string;
  superflex: string;
  position: string;
  phase: string;
  bidders: string;
}): string {
  return `${want.leagueKind}|${want.superflex}|${want.position}|${want.phase}|${want.bidders}`;
}

/**
 * The fallback ladder, in order, and why it runs this way.
 *
 * Position goes first because the bidder count and the time of year move a
 * price further than the position does: three teams chasing anybody is dearer
 * than one team chasing a running back. Superflex next, then the phase, and
 * the league kind last, because a dynasty room and a redraft room genuinely
 * pay differently and that distinction is the last one worth giving up.
 * Bidder count is never dropped on its own: it is the strongest signal we
 * have, so it only goes in the final everything-any rung.
 */
const LADDER: Array<{ label: string; widen: (want: PriorWant) => Partial<Record<string, string>> }> =
  [
    { label: "", widen: () => ({}) },
    { label: "every position", widen: () => ({ position: "any" }) },
    { label: "every position and lineup type", widen: () => ({ position: "any", superflex: "any" }) },
    {
      label: "every position, lineup type and time of season",
      widen: () => ({ position: "any", superflex: "any", phase: "any" }),
    },
    {
      label: "every league type",
      widen: () => ({ position: "any", superflex: "any", phase: "any", leagueKind: "any" }),
    },
    {
      label: "every auction we hold",
      widen: () => ({
        position: "any",
        superflex: "any",
        phase: "any",
        leagueKind: "any",
        bidders: "any",
      }),
    },
  ];

export function pickCell(
  cells: PriorCell[],
  want: PriorWant,
  minCellSamples: number,
): PickedCell | null {
  if (cells.length === 0) return null;
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));

  const base = {
    leagueKind: want.leagueKind,
    superflex: want.superflex === null ? "any" : want.superflex ? "yes" : "no",
    position: want.position ? want.position.toUpperCase() : "any",
    phase: want.phase ?? "any",
    bidders: want.bidders,
  };

  let last: PriorCell | null = null;
  for (const rung of LADDER) {
    const cell = byKey.get(keyFor({ ...base, ...rung.widen(want) }));
    if (!cell) continue;
    last = cell;
    if (cell.sampleSize >= minCellSamples) {
      return { cell, fellBackTo: rung.label === "" ? null : rung.label };
    }
  }

  // Nothing cleared the bar. The widest cell we found is still the best answer
  // available, and its sample size travels with it so the page can hedge.
  return last ? { cell: last, fellBackTo: "every auction we hold" } : null;
}

/**
 * The chance a bid at `pct` of the league's full budget is enough.
 *
 * Linear between the published quantiles, anchored at (0, the share of
 * auctions won for nothing) and (100, certainty). Monotone by construction,
 * because the quantiles are sorted and the interpolation is piecewise linear
 * between them.
 */
export function priorCdf(cell: PriorCell, pct: number): number {
  const points: Array<[number, number]> = [
    [0, Math.min(1, Math.max(0, cell.zeroShare))],
    [cell.p05, 0.05],
    [cell.p10, 0.1],
    [cell.p25, 0.25],
    [cell.p50, 0.5],
    [cell.p75, 0.75],
    [cell.p90, 0.9],
    [cell.p95, 0.95],
    [cell.p99, 0.99],
    [100, 1],
  ];

  // Quantiles can repeat (half our auctions clear at zero), and a flat step
  // must read as "this much of the market is already beaten", never as a
  // division by zero.
  let best = points[0][1];
  for (let i = 0; i < points.length; i += 1) {
    const [x, y] = points[i];
    if (pct >= x) {
      best = Math.max(best, y);
      continue;
    }
    const [prevX, prevY] = points[i - 1] ?? [0, points[0][1]];
    if (x <= prevX) return Math.min(1, Math.max(0, best));
    const t = (pct - prevX) / (x - prevX);
    return Math.min(1, Math.max(0, Math.max(best, prevY + (y - prevY) * t)));
  }
  return Math.min(1, Math.max(0, best));
}

/** The smallest whole-dollar bid whose win chance reaches `target`, or null. */
export function bidForTargetFromCell(
  cell: PriorCell,
  target: number,
  totalBudget: number,
  maxDollars: number,
  styleMultiplier = 1,
): number | null {
  if (totalBudget <= 0 || maxDollars <= 0) return null;
  for (let dollars = 0; dollars <= maxDollars; dollars += 1) {
    const pct = (dollars / totalBudget) * 100;
    if (priorCdf(cell, pct / Math.max(0.01, styleMultiplier)) >= target) return dollars;
  }
  return null;
}
