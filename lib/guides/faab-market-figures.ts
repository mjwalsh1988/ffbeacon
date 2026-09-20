/**
 * Reading the measured FAAB market cells for a guide page.
 *
 * Two guides publish figures out of `faab_market_priors`: the FAAB strategy
 * guide (what contested claims cost, and what each stretch of the season
 * costs) and the chopped league guide (what a claim costs as the field
 * shrinks). Both need the same three things, and neither should be writing
 * them out by hand:
 *
 *   1. Find one named cell and say whether it has enough samples to publish.
 *      The threshold is the calculator's own `priors.minCellSamples`, so an
 *      admin raising the bar quietly removes the figure from both guides
 *      rather than leaving one page confident and the other cautious.
 *   2. Format a share of the budget the way a reader thinks about it. Every
 *      stored figure is a percentage of the league's WHOLE budget, which is
 *      the only way a $100 league and a $1,000 league can be averaged
 *      together, and it is not how anybody bids. So a figure is published as
 *      dollars in a stated budget with the percentage beside it.
 *   3. Say what the number is made of: how many auctions, how many leagues,
 *      which seasons, and when the table was last built.
 *
 * Pure. No client, no clock, no I/O, so the guides can call it at render and
 * a test can call it with a handful of rows.
 */

import type { PriorCell } from "@/lib/faab/priors-math";

/** What a guide renders instead of a figure it cannot stand behind. */
export const NOT_ENOUGH = "Not enough data yet";

export type MarketRead = {
  cellKey: string;
  sampleSize: number;
  leaguesCount: number;
  seasons: number[];
  builtAt: string;
  /** Share of auctions that cleared for nothing, 0 to 1. */
  zeroShare: number;
  /** Winning bid as a share of the league's whole budget, 0 to 100. */
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  /** False when the cell is below the calculator's publishing threshold. */
  enough: boolean;
};

/**
 * One named cell, exactly as stored.
 *
 * Deliberately NOT `pickCell`: the fallback ladder is right for a reader
 * pricing a claim, who wants the best answer available, and wrong for a guide,
 * which is making a specific claim about a specific slice of the market. A
 * sentence about chopped leagues must not quietly be answered by every
 * auction we hold.
 */
export function readCell(
  cells: PriorCell[],
  cellKey: string,
  minCellSamples: number,
): MarketRead | null {
  const cell = cells.find((c) => c.cellKey === cellKey);
  if (!cell) return null;
  return {
    cellKey: cell.cellKey,
    sampleSize: cell.sampleSize,
    leaguesCount: cell.leaguesCount,
    seasons: cell.seasons,
    builtAt: cell.builtAt,
    zeroShare: cell.zeroShare,
    p50: cell.p50,
    p75: cell.p75,
    p90: cell.p90,
    p95: cell.p95,
    enough: cell.sampleSize >= minCellSamples,
  };
}

/** A share of the budget as a short number: "20", "10.5", "0.2". */
export function pctText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "under 0.1";
  return String(rounded);
}

/** Whole percent of a 0 to 1 share: "43". */
export function shareText(share: number): string {
  if (!Number.isFinite(share)) return "0";
  return String(Math.round(Math.max(0, Math.min(1, share)) * 100));
}

/** What a share of the budget is worth in a stated pot: "$32". */
export function moneyText(value: number, budget: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  const dollars = (value / 100) * budget;
  if (dollars < 0.5) return "under $1";
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** The published form of one quantile: "$32 (3.2%)". */
export function moneyPctText(value: number, budget: number): string {
  return `${moneyText(value, budget)} (${pctText(value)}%)`;
}

/** "2025", "2025 and 2026", "2023 to 2026". */
export function seasonsText(seasons: number[]): string {
  const list = [...seasons].sort((a, b) => a - b);
  if (list.length === 0) return "";
  if (list.length === 1) return String(list[0]);
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  const contiguous = list.every((s, i) => i === 0 || s === list[i - 1] + 1);
  if (contiguous) return `${list[0]} to ${list[list.length - 1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "324 claims, 16 leagues, 2025 and 2026". The provenance of every figure. */
export function sampleText(read: MarketRead): string {
  const claims = `${read.sampleSize.toLocaleString("en-US")} ${read.sampleSize === 1 ? "claim" : "claims"}`;
  const leagues = `${read.leaguesCount.toLocaleString("en-US")} ${read.leaguesCount === 1 ? "league" : "leagues"}`;
  const seasons = seasonsText(read.seasons);
  return seasons ? `${claims}, ${leagues}, ${seasons}` : `${claims}, ${leagues}`;
}

/**
 * The stored build timestamp as something `new Date` will always accept.
 *
 * Postgres renders a timestamptz with a space and a two-digit offset, and
 * whether that reaches us as "2026-09-19 22:29:29.406+00" or as proper ISO
 * depends on the driver. Both parse here.
 */
export function builtAtIso(raw: string): string {
  if (!raw) return "";
  let value = raw.includes("T") ? raw : raw.replace(" ", "T");
  if (/[+-]\d{2}$/.test(value)) value = `${value}:00`;
  return value;
}

/** The newest build stamp across the cells a page read, for "Updated". */
export function newestBuiltAt(reads: (MarketRead | null)[]): string | null {
  let best: string | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const read of reads) {
    if (!read?.builtAt) continue;
    const iso = builtAtIso(read.builtAt);
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) continue;
    if (time > bestTime) {
      bestTime = time;
      best = iso;
    }
  }
  return best;
}
