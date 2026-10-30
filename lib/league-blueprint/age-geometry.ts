/**
 * Age by position bars: one pair per position (this roster, the league),
 * horizontal, on one shared scale. Pure. The page chart and its data table
 * read the same rows; the bars only draw what the table says.
 */

import type { AgeRow } from "./types";

export type AgeBar = { x: number; y: number; width: number; height: number; value: number };

export type AgeChartRow = {
  position: string;
  mine: AgeBar | null;
  league: AgeBar | null;
  labelY: number;
};

export type AgeChart = {
  width: number;
  height: number;
  /** Plot area left edge, after the position labels. */
  plotX: number;
  rows: AgeChartRow[];
  ticks: Array<{ x: number; value: number }>;
  domain: [number, number];
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function ageChart(
  rows: readonly AgeRow[],
  opts: { width: number; labelWidth: number; barHeight: number; pairGap: number; rowGap: number },
): AgeChart {
  const values = rows.flatMap((r) => [r.mine, r.league]).filter((v): v is number => v !== null);
  const lo = values.length ? Math.floor(Math.min(...values) - 1) : 20;
  const hi = values.length ? Math.ceil(Math.max(...values) + 1) : 32;
  const domainLo = Math.min(lo, 21);
  const domainHi = Math.max(hi, domainLo + 6);
  const plotX = opts.labelWidth;
  const plotW = opts.width - plotX;
  const scale = (v: number) => ((v - domainLo) / (domainHi - domainLo)) * plotW;

  const rowH = opts.barHeight * 2 + opts.pairGap;
  const out: AgeChartRow[] = rows.map((r, i) => {
    const y = i * (rowH + opts.rowGap);
    const bar = (v: number | null, dy: number): AgeBar | null =>
      v === null ? null : { x: plotX, y: r2(y + dy), width: r2(Math.max(2, scale(v))), height: opts.barHeight, value: v };
    return {
      position: r.position,
      mine: bar(r.mine, 0),
      league: bar(r.league, opts.barHeight + opts.pairGap),
      labelY: r2(y + rowH / 2),
    };
  });
  const height = rows.length * rowH + Math.max(0, rows.length - 1) * opts.rowGap;
  const ticks: Array<{ x: number; value: number }> = [];
  const step = domainHi - domainLo > 10 ? 4 : 2;
  for (let v = Math.ceil(domainLo / step) * step; v <= domainHi; v += step) {
    ticks.push({ x: r2(plotX + scale(v)), value: v });
  }
  return { width: opts.width, height, plotX, rows: out, ticks, domain: [domainLo, domainHi] };
}
