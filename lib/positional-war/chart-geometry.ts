/**
 * Positional WAR chart geometry.
 *
 * PURE. No React, no DOM, no database, no clock: every input arrives as a
 * plain argument and every output is plain data (SVG path strings and
 * numbers). This exists because TWO callers draw the exact same chart: the
 * on-page client component at components/league-war/positional-war-chart.tsx,
 * and the server route at app/api/og/war/[league_id]/route.tsx that builds an
 * SVG string for the social card, through Satori. If the geometry lived
 * inside the component, the shared card and the page could disagree about
 * the same league. Both callers import this module and get one answer.
 *
 * Two axis modes, chosen so a reader can ask either question:
 *
 *   depth (default): x = positionRank / structuralDemand. Every position's
 *   replacement boundary lands at x = 1.0, which is what makes six positions
 *   with six different starting counts comparable on one chart.
 *
 *   rank: x = positionRank, raw, on one shared domain. QB stops around 30 and
 *   WR runs to the cap, and that difference in length IS the answer to "how
 *   many quarterbacks are worth anything at all". A shorter series simply
 *   ends; it is never padded with a zero-fill tail, because a plotted zero
 *   would read as "worth nothing" rather than "not drawn".
 *
 * The replacement marker moves with the mode: fixed at x = 1.0 in depth mode
 * (that fixed position is the normalization), and at the league's raw
 * structuralDemand rank in rank mode, where it fans out left to right across
 * the six series and that fan is itself the scarcity reading.
 */

import { linePath, makeScale } from "@/components/chart-kit";
import type { PlottableCurve, PulsePosition, WarCurvePoint } from "@/lib/positional-war/types";

export type WarAxisMode = "depth" | "rank";

export type ChartGeometry = {
  series: Array<{
    position: PulsePosition;
    /** The SVG path for this series' line. */
    d: string;
    points: Array<{ x: number; y: number; rank: number; war: number; playerId: string }>;
    /** The replacement marker. Renders even when warAtDemand is null. */
    markerAt: { x: number; y: number; label: string } | null;
    /** Rank mode only: the series or its marker ran past the cap. */
    truncated: boolean;
  }>;
  xTicks: Array<{ x: number; label: string }>;
  yTicks: Array<{ y: number; label: string }>;
  yMin: number;
  yMax: number;
  plot: { left: number; top: number; right: number; bottom: number };
};

/** Rank mode never plots past this, no matter how deep a league's pool runs. */
export const RANK_AXIS_CAP_MAX = 60;

/**
 * Depth mode's domain floor. A short curve (a 6-team league's QB series, say)
 * would otherwise stretch to fill the plot and exaggerate how far it runs.
 */
const DEPTH_AXIS_MIN_UPPER = 2.5;

/**
 * Reads the `?war=` URL param. Anything other than the literal string "rank",
 * including undefined, an array (Next hands back an array when a param
 * repeats), and garbage text, falls back to "depth" silently. An unknown axis
 * parameter is not an error; it is just not an opt-in to the other mode.
 */
export function parseAxisMode(raw: string | string[] | null | undefined): WarAxisMode {
  return raw === "rank" ? "rank" : "depth";
}

/** True when a position has anything to plot. Guards every division below. */
function isPlottable(curve: PlottableCurve): boolean {
  return curve.structuralDemand > 0 && curve.curve.length > 0;
}

/**
 * "Nice" round numbers for axis ticks (Heckbert's algorithm): 1, 2, or 5
 * times a power of ten. Keeps y-axis labels like 0.50 and 1.00 instead of
 * whatever an even division of the data range happens to produce.
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

/**
 * The y-domain, computed from the data rather than assumed. yMin is 0 in the
 * normal (clamped) case, but when the admin turns clampBelowReplacement off,
 * WAR can go negative and the axis has to include it (acceptance criterion
 * E7-4). Aims for four to six ticks so the labels do not collide.
 */
function computeYDomain(values: number[]): { yMin: number; yMax: number; ticks: number[] } {
  const rawMax = values.length > 0 ? Math.max(0, ...values) : 0;
  const rawMin = values.length > 0 ? Math.min(0, ...values) : 0;
  const span = rawMax - rawMin > 0 ? rawMax - rawMin : 1;

  const buildAt = (targetDivisions: number) => {
    const step = niceNum(span / Math.max(1, targetDivisions), true);
    const yMin = rawMin < 0 ? Math.floor(rawMin / step) * step : 0;
    let yMax = Math.ceil(rawMax / step) * step;
    if (yMax <= rawMax) yMax += step;
    if (yMax <= yMin) yMax = yMin + step;
    const ticks: number[] = [];
    for (let v = yMin; v <= yMax + step / 2; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return { yMin, yMax, ticks };
  };

  // Try target division counts in the order most likely to land a 4-6 tick
  // axis on the first try; fall back to whatever the last attempt produced.
  let result = buildAt(4);
  for (const target of [4, 3, 5, 2, 6, 1, 7]) {
    const candidate = buildAt(target);
    result = candidate;
    if (candidate.ticks.length >= 4 && candidate.ticks.length <= 6) break;
  }
  return result;
}

export function buildChartGeometry(input: {
  curves: PlottableCurve[];
  mode: WarAxisMode;
  width: number;
  height: number;
  padding: { t: number; r: number; b: number; l: number };
}): ChartGeometry {
  const { curves, mode, width, height, padding } = input;

  const plot = {
    left: padding.l,
    top: padding.t,
    right: width - padding.r,
    bottom: height - padding.b,
  };

  const plottable = curves.filter(isPlottable);

  // The vertical scale is the same in both modes: the two axis toggles read
  // out the same WAR values, only the x placement changes (E2-1).
  const allWar = plottable.flatMap((curve) => curve.curve.map((pt) => pt.war));
  const { yMin, yMax, ticks: yTickValues } = computeYDomain(allWar);
  const yScale = makeScale(yMin, yMax, plot.bottom, plot.top);
  const yTicks = yTickValues.map((v) => ({ y: yScale(v), label: v.toFixed(2) }));

  let xScale: (v: number) => number;
  let xTicks: ChartGeometry["xTicks"];
  let rankCap = RANK_AXIS_CAP_MAX;

  if (mode === "rank") {
    const maxLen = plottable.length > 0 ? Math.max(...plottable.map((c) => c.curve.length)) : RANK_AXIS_CAP_MAX;
    rankCap = Math.min(RANK_AXIS_CAP_MAX, maxLen);
    xScale = makeScale(1, rankCap, plot.left, plot.right);

    const tickValues = new Set<number>([1, rankCap]);
    for (let t = 10; t < rankCap; t += 10) tickValues.add(t);
    xTicks = [...tickValues].sort((a, b) => a - b).map((t) => ({ x: xScale(t), label: String(t) }));
  } else {
    let maxRatio = 0;
    for (const curve of plottable) {
      for (const pt of curve.curve) {
        const ratio = pt.positionRank / curve.structuralDemand;
        if (ratio > maxRatio) maxRatio = ratio;
      }
    }
    const upperBound = Math.max(DEPTH_AXIS_MIN_UPPER, maxRatio);
    xScale = makeScale(0, upperBound, plot.left, plot.right);

    const ticks: ChartGeometry["xTicks"] = [];
    for (let t = 0.5; t <= upperBound + 1e-9; t += 0.5) {
      const rounded = Math.round(t * 10) / 10;
      ticks.push({
        x: xScale(rounded),
        // The six positions start six different counts, so there is no one
        // shared number to put on this tick. Each series' own count travels
        // in its marker label instead.
        label: rounded === 1 ? "Replacement level" : rounded.toFixed(1),
      });
    }
    xTicks = ticks;
  }

  const series: ChartGeometry["series"] = plottable.map((curve) => {
    const demand = curve.structuralDemand;
    const lastRawPoint = curve.curve[curve.curve.length - 1];

    let plottedRaw: WarCurvePoint[] = curve.curve;
    let seriesTruncated = false;
    if (mode === "rank") {
      plottedRaw = curve.curve.filter((pt) => pt.positionRank <= rankCap);
      seriesTruncated = plottedRaw.length < curve.curve.length;
    }

    const points = plottedRaw.map((pt) => {
      const xRaw = mode === "depth" ? pt.positionRank / demand : pt.positionRank;
      return {
        x: xScale(xRaw),
        y: yScale(pt.war),
        rank: pt.positionRank,
        war: pt.war,
        playerId: pt.playerId,
      };
    });

    const d = linePath(points);

    // Where the marker sits on the y-axis: the actual player at
    // positionRank === structuralDemand when the curve reaches that far, and
    // the last plotted point otherwise. A shallow pool (curve shorter than
    // demand) still gets a marker; it just borrows the nearest real value.
    const demandPoint = curve.curve.find((pt) => pt.positionRank === demand);
    const markerSource = demandPoint ?? lastRawPoint;

    const markerClamped = mode === "rank" && demand > rankCap;
    const markerWarSource = markerClamped
      ? (plottedRaw[plottedRaw.length - 1] ?? markerSource)
      : markerSource;
    const markerRank = markerClamped ? markerWarSource.positionRank : demand;
    const markerXRaw = mode === "depth" ? 1 : markerRank;

    const baseLabel =
      curve.warAtDemand != null
        ? `${curve.position}${demand}, ${curve.warAtDemand.toFixed(2)} wins`
        : `${curve.position}${demand}`;

    const markerAt = {
      x: xScale(markerXRaw),
      y: yScale(markerWarSource.war),
      label: markerClamped ? `${curve.position}${demand}+` : baseLabel,
    };

    return {
      position: curve.position,
      d,
      points,
      markerAt,
      truncated: seriesTruncated || markerClamped,
    };
  });

  return { series, xTicks, yTicks, yMin, yMax, plot };
}
