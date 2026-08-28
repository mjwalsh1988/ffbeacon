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
 *   rank (the default): x = positionRank, raw, on one shared domain. "The
 *   twelfth best running back" is a thing a reader already knows how to think
 *   about, and QB stopping short while WR runs on IS the answer to "how many
 *   quarterbacks are worth anything at all". A shorter series simply ends; it
 *   is never padded with a zero-fill tail, because a plotted zero would read
 *   as "worth nothing" rather than "not drawn".
 *
 *   depth (the secondary mode): x = positionRank / structuralDemand. Every
 *   position's replacement boundary lands at x = 1.0, which is what makes six
 *   positions with six different starting counts comparable on one chart. Kept
 *   because that comparison is genuinely useful, moved off the default because
 *   a normalized axis is one more thing to learn before the first reading.
 *
 * The replacement marker moves with the mode: at the league's raw
 * structuralDemand rank in rank mode, where it fans out left to right across
 * the six series and that fan is itself the scarcity reading, and fixed at
 * x = 1.0 in depth mode, where that fixed position is the normalization.
 *
 * EVERY MODE STOPS AT THE SAME RANK. `maxRank` caps both, so the chart, its
 * axis labels, the spoken summary, the data table under it and the shared
 * social card all describe the same set of players. A cap that applied to one
 * mode and not the other would make the toggle silently change the population
 * as well as the axis.
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
  /**
   * Where zero wins sits, or null when the y-domain does not include it.
   *
   * Exposed rather than left for the caller to work out, because the caller
   * has no scale: the whole point of this module is that it owns the maths.
   * The chart draws a marked line here, and "this is the line where a player
   * is worth exactly what a replacement is worth" is the single most useful
   * thing on the y-axis.
   */
  zeroY: number | null;
  plot: { left: number; top: number; right: number; bottom: number };
};

/**
 * How deep the dedicated Positional WAR page plots and tabulates.
 *
 * 36 is three full rounds' worth of any position in a twelve-team league, so
 * every series reaches past its own replacement line with room to show the
 * flattening after it, and no series runs on into the seventy-odd ranks of
 * players nobody in any league starts. Past this the lines are flat at zero
 * and add pixels rather than information.
 */
export const WAR_CHART_MAX_RANK = 36;

/**
 * How deep the League Overview's preview plots.
 *
 * Shorter than the dedicated page on purpose: the overview is making one
 * point (which positions are scarce here) and then handing the reader on. The
 * preview says so out loud and links to the full chart.
 */
export const WAR_PREVIEW_MAX_RANK = 25;

/**
 * The positions a chart shows before the reader touches anything.
 *
 * Kickers and team defenses are drawn only on request. Both are genuinely
 * scarce in the model (a 12-team league starts twelve of each, and the pool is
 * 32 deep), but their curves sit an order of magnitude below the skill
 * positions, so on a shared y-axis they flatten against the zero line and add
 * two more lines to read past. A league that starts them still gets them; it
 * gets them from the legend, one press away, and the legend says so.
 */
export const DEFAULT_VISIBLE_POSITIONS: readonly PulsePosition[] = ["QB", "RB", "WR", "TE"];

/**
 * The default visible set for one league: the four skill positions it
 * actually plots. Falls back to everything plottable when a league starts none
 * of them, so a chart is never empty on first paint.
 */
export function defaultVisiblePositions(
  curves: readonly { position: PulsePosition; curve: readonly unknown[] }[],
): Set<PulsePosition> {
  const available = curves.filter((c) => c.curve.length > 0).map((c) => c.position);
  const preferred = available.filter((p) => DEFAULT_VISIBLE_POSITIONS.includes(p));
  return new Set(preferred.length > 0 ? preferred : available);
}

/**
 * Depth mode's domain floor. A short curve (a 6-team league's QB series, say)
 * would otherwise stretch to fill the plot and exaggerate how far it runs.
 */
const DEPTH_AXIS_MIN_UPPER = 2.5;

/**
 * Reads the `?war=` URL param. Anything other than the literal string "depth",
 * including undefined, an array (Next hands back an array when a param
 * repeats), and garbage text, falls back to "rank" silently. An unknown axis
 * parameter is not an error; it is just not an opt-in to the other mode.
 *
 * The default flipped from depth to rank when this page became a dashboard.
 * An older shared link carrying `?war=rank` still resolves to rank, so nothing
 * anyone shared broke; a link with no parameter now lands on rank too.
 */
export function parseAxisMode(raw: string | string[] | null | undefined): WarAxisMode {
  return raw === "depth" ? "depth" : "rank";
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
  /**
   * The deepest position rank this chart plots. Applied in BOTH modes, before
   * anything else, so the y-domain, the axis ticks, the markers, the
   * truncation flags and every consumer's summary all describe one population.
   */
  maxRank?: number;
}): ChartGeometry {
  const { curves, mode, width, height, padding } = input;
  const maxRank = Math.max(1, Math.floor(input.maxRank ?? WAR_CHART_MAX_RANK));

  const plot = {
    left: padding.l,
    top: padding.t,
    right: width - padding.r,
    bottom: height - padding.b,
  };

  // The cap is applied HERE, once, to the curves themselves, rather than in
  // each branch below. Everything downstream (the y-domain, the depth-mode
  // upper bound, the marker's fallback point, the truncation flag) then reads
  // the capped series, so the two modes cannot disagree about who is plotted.
  const plottable = curves.filter(isPlottable).map((curve) => {
    const capped = curve.curve.filter((pt) => pt.positionRank <= maxRank);
    return { curve, capped, truncated: capped.length < curve.curve.length };
  });

  // The vertical scale is the same in both modes: the two axis toggles read
  // out the same WAR values, only the x placement changes (E2-1).
  const allWar = plottable.flatMap((entry) => entry.capped.map((pt) => pt.war));
  const { yMin, yMax, ticks: yTickValues } = computeYDomain(allWar);
  const yScale = makeScale(yMin, yMax, plot.bottom, plot.top);
  const yTicks = yTickValues.map((v) => ({ y: yScale(v), label: v.toFixed(2) }));
  const zeroY = yMin <= 0 && yMax >= 0 ? yScale(0) : null;

  let xScale: (v: number) => number;
  let xTicks: ChartGeometry["xTicks"];
  let rankCap = maxRank;

  if (mode === "rank") {
    const deepest =
      plottable.length > 0
        ? Math.max(...plottable.map((entry) => entry.capped.length))
        : maxRank;
    rankCap = Math.max(2, Math.min(maxRank, deepest));
    xScale = makeScale(1, rankCap, plot.left, plot.right);

    // Ticks every 5 on a short axis, every 10 on a long one, plus the two
    // ends. At the 36-rank default that reads 1, 10, 20, 30, 36.
    const step = rankCap <= 30 ? 5 : 10;
    const tickValues = new Set<number>([1, rankCap]);
    for (let t = step; t < rankCap; t += step) tickValues.add(t);
    xTicks = [...tickValues].sort((a, b) => a - b).map((t) => ({ x: xScale(t), label: String(t) }));
  } else {
    let maxRatio = 0;
    for (const entry of plottable) {
      for (const pt of entry.capped) {
        const ratio = pt.positionRank / entry.curve.structuralDemand;
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

  const series: ChartGeometry["series"] = plottable.map((entry) => {
    const curve = entry.curve;
    const demand = curve.structuralDemand;
    const lastRawPoint = entry.capped[entry.capped.length - 1] ?? curve.curve[curve.curve.length - 1];

    // Rank mode narrows once more when the deepest series is shorter than the
    // cap: the axis then ends at that series' length, so a longer one has to
    // stop there too rather than draw past the right edge.
    const plottedRaw: WarCurvePoint[] =
      mode === "rank" ? entry.capped.filter((pt) => pt.positionRank <= rankCap) : entry.capped;
    const seriesTruncated = entry.truncated || plottedRaw.length < entry.capped.length;

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

    // Clamped in BOTH modes now that both stop at maxRank. A league that
    // starts more of a position than the chart plots (a deep-flex league's
    // running backs, say) would otherwise get a marker drawn at a rank the
    // line never reaches: at x = 1.0 in depth mode with the series ending well
    // to its left, which reads as a boundary the data does not support.
    const markerClamped = demand > rankCap;
    const markerWarSource = markerClamped
      ? (plottedRaw[plottedRaw.length - 1] ?? markerSource)
      : markerSource;
    const markerRank = markerClamped ? markerWarSource.positionRank : demand;
    const markerXRaw = mode === "depth" ? markerRank / demand : markerRank;

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

  return { series, xTicks, yTicks, yMin, yMax, zeroY, plot };
}
