/**
 * Geometry for the trade value against Positional WAR scatterplot.
 *
 * PURE, for the same reason lib/positional-war/chart-geometry.ts is: it owns
 * maths a component should not, and it can be tested without rendering.
 *
 * WHAT THE CHART ASKS. The line chart answers "which positions are scarce
 * here". This one answers "is the market in my league pricing that scarcity".
 * A player high and to the left wins games and costs little to acquire; one
 * low and to the right is expensive for what he adds to a lineup. Neither
 * axis is an opinion about the other: WAR comes from this league's own
 * scoring and starting lineup and never varies by value source, while trade
 * value is whatever the reader's chosen source says, at the format derived
 * from the league. That the two disagree is the entire point of putting them
 * on the same axes.
 *
 * A PLAYER WITH NO VALUE IS NOT A PLAYER WORTH ZERO. Every source covers a
 * different slice of the player pool; kickers and defenses are usually absent
 * outright. Those players are excluded from the plot and counted in a stated
 * line under it, never pinned to x = 0, where they would form a false column
 * against the y-axis and drag any trend line with them.
 *
 * THE TREND LINE IS ORDINARY LEAST SQUARES, and it is only drawn when it can
 * be explained. Below MIN_TREND_POINTS plotted players there is not enough to
 * fit, and the geometry returns null rather than a line through a handful of
 * dots. When it is drawn, r squared travels with it so the caller can say how
 * much of the spread it actually accounts for. It describes the plotted
 * players and nothing else: it is not a prediction, and the caller's copy says
 * so.
 */

import { makeScale } from "@/components/chart-kit";
import type { PulsePosition } from "@/lib/power-pulse/types";
import type { WarTableRow } from "./table";

/** Fewer plotted players than this and no trend line is drawn. */
export const MIN_TREND_POINTS = 20;

export type ScatterPoint = {
  playerId: string;
  position: PulsePosition;
  /** Plot coordinates. */
  x: number;
  y: number;
  /** The values behind them, so a readout never has to invert the scale. */
  tradeValue: number;
  war: number;
};

export type ScatterTrend = {
  /** The SVG path for the fitted line, clipped to the plot rectangle. */
  d: string;
  /** Wins of WAR per point of trade value. */
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0 to 1. */
  r2: number;
  /** How many plotted players the fit used. */
  n: number;
};

export type ScatterGeometry = {
  points: ScatterPoint[];
  xTicks: Array<{ x: number; label: string }>;
  yTicks: Array<{ y: number; label: string }>;
  zeroY: number | null;
  trend: ScatterTrend | null;
  /** Rows that carried no trade value and are therefore not plotted. */
  omittedCount: number;
  plot: { left: number; top: number; right: number; bottom: number };
};

/**
 * "Nice" round numbers for axis ticks (Heckbert's algorithm): 1, 2, or 5 times
 * a power of ten. Same helper the line chart's y-axis uses, restated here
 * rather than exported across modules because the two axes round for different
 * reasons and neither should constrain the other.
 */
function niceNum(range: number, round: boolean): number {
  if (!(range > 0)) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/** A domain from `0` (or the data's own minimum, when negative) to a nice max. */
function niceDomain(values: number[], divisions: number): { min: number; max: number; ticks: number[] } {
  const rawMax = values.length > 0 ? Math.max(0, ...values) : 1;
  const rawMin = values.length > 0 ? Math.min(0, ...values) : 0;
  const span = rawMax - rawMin > 0 ? rawMax - rawMin : 1;
  const step = niceNum(span / Math.max(1, divisions), true);
  const min = rawMin < 0 ? Math.floor(rawMin / step) * step : 0;
  let max = Math.ceil(rawMax / step) * step;
  if (max <= rawMax) max += step;
  if (max <= min) max = min + step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min, max, ticks };
}

/** Trade values run into the thousands, so an axis label says 4k rather than 4000. */
function formatValueTick(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return String(Math.round(value));
}

/**
 * Ordinary least squares through the plotted points.
 *
 * Returns null below MIN_TREND_POINTS, and null when every x is the same (a
 * vertical cloud has no slope to fit and the divisor is zero).
 */
function fitTrend(points: ScatterPoint[]): { slope: number; intercept: number; r2: number; n: number } | null {
  const n = points.length;
  if (n < MIN_TREND_POINTS) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.tradeValue;
    sumY += p.war;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.tradeValue - meanX;
    const dy = p.war - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx <= 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  // syy of zero means every WAR is identical, so the line explains nothing and
  // r squared is undefined rather than perfect. Report zero.
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, r2, n };
}

export function buildScatterGeometry(input: {
  rows: readonly WarTableRow[];
  width: number;
  height: number;
  padding: { t: number; r: number; b: number; l: number };
}): ScatterGeometry {
  const { rows, width, height, padding } = input;

  const plot = {
    left: padding.l,
    top: padding.t,
    right: width - padding.r,
    bottom: height - padding.b,
  };

  const plotted = rows.filter(
    (row): row is WarTableRow & { tradeValue: number } => typeof row.tradeValue === "number",
  );
  const omittedCount = rows.length - plotted.length;

  const xDomain = niceDomain(
    plotted.map((r) => r.tradeValue),
    5,
  );
  const yDomain = niceDomain(
    plotted.map((r) => r.war),
    4,
  );

  const xScale = makeScale(xDomain.min, xDomain.max, plot.left, plot.right);
  const yScale = makeScale(yDomain.min, yDomain.max, plot.bottom, plot.top);

  const points: ScatterPoint[] = plotted.map((row) => ({
    playerId: row.playerId,
    position: row.position,
    x: xScale(row.tradeValue),
    y: yScale(row.war),
    tradeValue: row.tradeValue,
    war: row.war,
  }));

  const fit = fitTrend(points);
  const trend: ScatterTrend | null = fit
    ? {
        // Drawn across the axis's own span rather than the data's, so the line
        // meets both edges of the plot and a reader can read its slope off the
        // axis rather than off wherever the extreme players happen to sit.
        d: `M${xScale(xDomain.min).toFixed(2)},${yScale(fit.slope * xDomain.min + fit.intercept).toFixed(2)} L${xScale(xDomain.max).toFixed(2)},${yScale(fit.slope * xDomain.max + fit.intercept).toFixed(2)}`,
        slope: fit.slope,
        intercept: fit.intercept,
        r2: fit.r2,
        n: fit.n,
      }
    : null;

  return {
    points,
    xTicks: xDomain.ticks.map((v) => ({ x: xScale(v), label: formatValueTick(v) })),
    yTicks: yDomain.ticks.map((v) => ({ y: yScale(v), label: v.toFixed(2) })),
    zeroY: yDomain.min <= 0 && yDomain.max >= 0 ? yScale(0) : null,
    trend,
    omittedCount,
    plot,
  };
}

/**
 * The sentence that goes with the trend line.
 *
 * Says what it is, what it covers, and how much of the spread it accounts for,
 * because a line drawn through a cloud implies more than it earns unless the
 * fit is stated. Never claims a direction the fit does not support: at an r
 * squared under a tenth the line is reported as showing no clear relationship
 * rather than a weak one, because "weak" still invites a reader to lean on it.
 */
export function describeTrend(trend: ScatterTrend | null): string | null {
  if (!trend) return null;
  const pct = Math.round(trend.r2 * 100);
  if (trend.r2 < 0.1) {
    return `A best-fit line through these ${trend.n} players explains only ${pct}% of the spread, so value and wins are not moving together here.`;
  }
  const direction = trend.slope >= 0 ? "rises with" : "falls as";
  return `A best-fit line through these ${trend.n} players: wins ${direction} trade value, and the line accounts for ${pct}% of the spread. It describes today's market in this league, not a forecast.`;
}
