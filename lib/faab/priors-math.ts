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

import { SITE_TIME_ZONE } from "@/lib/datetime";
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
  /** The NFL season this cell's auctions were filed in. */
  season: number;
  /**
   * True when this season's cell was too thin and last season's stands in
   * for it. Set only by `mergeSeasonCells`; every page that shows a price
   * from such a cell says so in words.
   */
  fromPriorSeason: boolean;
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
    season: num(row.season),
    fromPriorSeason: false,
  };
}

/** The calendar year in New York, which is the year an NFL season is filed under. */
function easternYear(nowMs: number): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, year: "numeric" }).format(
      new Date(nowMs),
    ),
  );
}

/**
 * Which season is "this season" for prices: the newest season any league is
 * filed under, never later than the current Eastern calendar year. The cron
 * and every read use this one rule, so the two can never disagree about which
 * year a cell belongs to. The cap keeps one oddly dated league from moving the
 * whole market a year ahead.
 */
export function currentPriorSeason(maxLeagueSeason: number | null, nowMs: number): number | null {
  if (maxLeagueSeason === null || !Number.isFinite(maxLeagueSeason)) return null;
  return Math.min(maxLeagueSeason, easternYear(nowMs));
}

/**
 * One cell per key: this season's, or last season's while this one is thin.
 *
 * The owner's rule, per cell rather than with one global switch, read
 * literally: this season's cell is used the moment it has minCellSamples
 * auctions, and until then last season's cell for the same situation is used
 * instead. Nothing older than last season is ever stored, so nothing older
 * can be used. This season's thin cell appears only when last season has no
 * cell for that key at all.
 *
 * "This season" is PASSED IN (currentPriorSeason), never inferred from which
 * cells exist. In January a dynasty league renews under the new year before
 * that year has a single claim; inferring the season from the cells would then
 * call last season's cells this season's and drop every "last season" label
 * for eight months. Null only when no league exists at all, in which case the
 * newest stored season stands in.
 *
 * The swap happens BEFORE pickCell walks its ladder, on purpose. A reader
 * whose exact situation is thin this year gets the same situation from last
 * year rather than a broader slice of this year, which is the comparison that
 * actually prices their claim.
 */
export function mergeSeasonCells(
  cells: PriorCell[],
  minCellSamples: number,
  currentSeason: number | null,
): PriorCell[] {
  if (cells.length === 0) return [];
  let current = currentSeason ?? -Infinity;
  if (currentSeason === null) for (const c of cells) if (c.season > current) current = c.season;
  const previous = current - 1;

  const now = new Map<string, PriorCell>();
  const before = new Map<string, PriorCell>();
  for (const c of cells) {
    if (c.season === current) now.set(c.cellKey, c);
    else if (c.season === previous) before.set(c.cellKey, c);
  }

  const out: PriorCell[] = [];
  const keys = new Set<string>([...now.keys(), ...before.keys()]);
  for (const key of keys) {
    const cur = now.get(key);
    const prev = before.get(key);
    if (cur && cur.sampleSize >= minCellSamples) {
      out.push({ ...cur, fromPriorSeason: false });
    } else if (prev) {
      out.push({ ...prev, fromPriorSeason: true });
    } else if (cur) {
      out.push({ ...cur, fromPriorSeason: false });
    }
  }
  out.sort((a, b) => a.cellKey.localeCompare(b.cellKey));
  return out;
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
      label: "every auction this season",
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
      return { cell, fellBackTo: describeFallback(rung.label === "" ? null : rung.label, cell) };
    }
  }

  // Nothing cleared the bar. The widest cell we found is still the best answer
  // available, and its sample size travels with it so the page can hedge.
  return last ? { cell: last, fellBackTo: describeFallback("every auction this season", last) } : null;
}

/**
 * The fallback sentence fragment, naming last season when its cell is the one
 * used: "every position", "2025 claims until this season has enough", or
 * "every position, from 2025 claims until this season has enough". Pages
 * print it after "widens to".
 */
function describeFallback(widened: string | null, cell: PriorCell): string | null {
  if (!cell.fromPriorSeason) return widened;
  const borrowed = `${cell.season} claims until this season has enough`;
  if (widened === "every auction this season") return `every ${cell.season} auction until this season has enough`;
  return widened ? `${widened}, from ${borrowed}` : borrowed;
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
