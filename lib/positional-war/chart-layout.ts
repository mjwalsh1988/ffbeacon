/**
 * How big the Positional WAR chart's coordinate space should be, and which
 * axis labels fit inside it.
 *
 * PURE. No React, no DOM. Same reason lib/positional-war/chart-geometry.ts is
 * pure: this decides what a reader sees, so it is worth testing directly
 * rather than through a rendered component.
 *
 * THE PROBLEM THIS SOLVES. The chart drew into a fixed 640 by 360 viewBox and
 * let the browser scale it to whatever width the container had. Stroke widths
 * survive that (`vector-effect="non-scaling-stroke"`); TEXT does not. A label
 * set at 9 units renders at 9 times the scale factor, and the scale factor is
 * containerWidth / 640.
 *
 * The container is not the viewport. On a 320px phone the chart gets the
 * viewport less the page gutter (px-4, 32), the Panel body (px-4, 32) and the
 * ChartFigure (p-4, 32): 224 CSS px, a scale factor of 0.35, and every axis
 * label on both axes rendering at about 3 CSS pixels. At that size the labels
 * are not legible at all.
 *
 * Six curves overlapping was the readability risk the plan named. Measured,
 * the type was the worse one, and it is the one a desktop screenshot cannot
 * show you.
 *
 * THE FIX, which is the one docs/league-pulse-positional-war-plan.md
 * prescribes: a taller aspect ratio below the breakpoint, never fewer series.
 * Below 640 CSS px the coordinate space is sized to the container itself, so
 * the scale factor is never below 1 and a 10-unit label never renders under 10
 * CSS px. The aspect ratio grows as the container narrows, which is what gives
 * six curves vertical room to separate on a phone. Every series is still
 * drawn, and the data table beneath the chart is untouched at every width.
 */

export type ChartBox = {
  width: number;
  height: number;
  padding: { t: number; r: number; b: number; l: number };
  /** Axis label size, in viewBox units. */
  fontSize: number;
  /** Plotted point radius, in viewBox units. */
  pointRadius: number;
  /** The active point's radius, in viewBox units. */
  activePointRadius: number;
  /** The replacement marker's radius, in viewBox units. */
  markerRadius: number;
  /** The viewer-overlay ring's base radius, in viewBox units. */
  ringRadius: number;
};

/**
 * The wide box. Unchanged from what the chart has always drawn, so a desktop
 * viewport renders byte-identically to before this module existed.
 */
export const DESKTOP_BOX: ChartBox = {
  width: 640,
  height: 360,
  padding: { t: 16, r: 16, b: 34, l: 42 },
  fontSize: 9,
  // Small. The line is the reading; a dot per player at every rank turned a
  // 36-point series into a bead chain and buried the shape it was meant to
  // show. Kept above zero rather than removed, because the dots are what makes
  // a single-point series (a shallow pool) visible at all, and because the
  // active point grows to mark where the readout is pointing.
  pointRadius: 1.6,
  activePointRadius: 4,
  markerRadius: 5.5,
  ringRadius: 7,
};

/**
 * At and above this container width the wide box's 9-unit type already renders
 * at 9 CSS px or more, so nothing needs to change. It is the wide box's own
 * width for exactly that reason, not a round number picked to look like a
 * breakpoint.
 */
export const NARROW_BREAKPOINT_PX = DESKTOP_BOX.width;

/** The narrow box's fixed parts. Width and height come from the container. */
const NARROW_BASE = {
  // Tighter than the wide box, because the plot area matters more when there
  // is less of it. A 10-unit "0.50" measures about 22 units, so 32 on the left
  // leaves room to spare.
  padding: { t: 12, r: 12, b: 30, l: 32 },
  fontSize: 10,
  pointRadius: 1.5,
  activePointRadius: 4,
  markerRadius: 5,
  ringRadius: 6.5,
} as const;

/**
 * The narrowest coordinate space the narrow box will adopt, set from the real
 * chain of padding rather than a round number: a 320px viewport leaves the
 * chart 224 CSS px (see the module header). A floor above that would make the
 * coordinate space wider than the container it is drawn into and shrink the
 * type again, which is the bug this module exists to fix. 200 leaves headroom
 * below the narrowest viewport the site targets.
 */
const NARROW_MIN_WIDTH = 200;

/**
 * Height as a multiple of width, at the two ends of the narrow range. The
 * narrower the container, the taller the chart, because six curves crammed
 * into a 16:9 box on a phone is the overlap problem the plan warned about. At
 * the top of the range it meets the wide box's own ratio, so crossing the
 * breakpoint does not jump.
 */
const ASPECT_AT_MIN = 1.25;
const ASPECT_AT_BREAKPOINT = DESKTOP_BOX.height / DESKTOP_BOX.width;

/**
 * Quantization step for the measured width, in CSS pixels.
 *
 * The coordinate space tracks the container, so without this every pixel of a
 * resize drag would mint a new box and rebuild every path string. 20px makes a
 * drag across a phone's whole width cost a handful of rebuilds instead of
 * hundreds, and the rounding is downward (see `quantizeChartWidth`) so it can
 * only ever make the type slightly larger than nominal.
 */
export const WIDTH_QUANTUM_PX = 20;

/**
 * Round a measured container width DOWN to the step the box is chosen on.
 *
 * Down, not to nearest, and that direction is the whole invariant: the chosen
 * coordinate space is never wider than the container it will be drawn into, so
 * the scale factor is never below 1 and a label never renders smaller than its
 * nominal size. Rounding to nearest would let a 630px container round up to
 * 640, cross the breakpoint, and pick the wide box for a container too narrow
 * to carry it, which is the same defect in miniature.
 *
 * Null passes through: an unmeasured container has no width to round.
 */
export function quantizeChartWidth(renderedWidthPx: number | null): number | null {
  if (renderedWidthPx === null || !Number.isFinite(renderedWidthPx) || renderedWidthPx <= 0) {
    return null;
  }
  return Math.floor(renderedWidthPx / WIDTH_QUANTUM_PX) * WIDTH_QUANTUM_PX;
}

/** The narrow box for a given container width, in CSS pixels. */
export function narrowBoxFor(containerPx: number): ChartBox {
  const width = Math.min(NARROW_BREAKPOINT_PX, Math.max(NARROW_MIN_WIDTH, containerPx));
  const t = (width - NARROW_MIN_WIDTH) / (NARROW_BREAKPOINT_PX - NARROW_MIN_WIDTH);
  const aspect = ASPECT_AT_MIN + t * (ASPECT_AT_BREAKPOINT - ASPECT_AT_MIN);
  return { ...NARROW_BASE, width, height: Math.round(width * aspect) };
}

/**
 * Pick the coordinate space for a container of `renderedWidthPx` CSS pixels.
 *
 * A null width means "not measured yet", which is what the server renders and
 * what the first client paint renders. That resolves to the wide box, so the
 * server HTML and the first paint agree and hydration has nothing to
 * reconcile; a narrow viewport swaps on the first measurement.
 *
 * Pass a value from `quantizeChartWidth`. A raw measurement is correct but
 * returns a fresh object per pixel, which is what the quantum is there to
 * avoid.
 */
export function pickChartBox(renderedWidthPx: number | null): ChartBox {
  if (renderedWidthPx === null || renderedWidthPx >= NARROW_BREAKPOINT_PX) return DESKTOP_BOX;
  return narrowBoxFor(renderedWidthPx);
}

/**
 * Roughly how wide a label is, in the same units as the font size.
 *
 * A real measurement needs a laid-out DOM node per label, which is a lot of
 * work to decide whether to draw a number. 0.55 em per character is the usual
 * approximation for a proportional sans at these sizes and it errs slightly
 * wide, which is the safe direction: it drops a label that would have just
 * fitted rather than keeping one that would have collided.
 */
export function estimateLabelWidth(label: string, fontSize: number): number {
  return label.length * fontSize * 0.55;
}

export type AxisTick = { x: number; label: string };

/**
 * Drop x-axis labels that would overlap their neighbours.
 *
 * The x axis in depth mode carries "Replacement level" at x = 1.0, which is
 * the single most important thing on it and is also six times as wide as the
 * "0.5" and "1.5" that flank it. In the narrow box those three collide into an
 * unreadable smear.
 *
 * So the pass is priority-ordered rather than left-to-right: `priority` labels
 * are placed first and never dropped, then the rest are offered in order and
 * kept only if they clear everything already placed. The result is returned in
 * x order, so the caller renders it as a plain list.
 *
 * `gap` is the minimum clear space between two labels' estimated boxes.
 *
 * Ticks themselves are never removed from the geometry, and neither is any
 * series: this drops LABELS only, and every plotted value is in the data table
 * the panel renders beneath the chart, so nothing is hidden at any breakpoint.
 */
export function fitAxisLabels(
  ticks: AxisTick[],
  fontSize: number,
  gap: number,
  isPriority: (tick: AxisTick) => boolean,
): AxisTick[] {
  if (ticks.length === 0) return [];

  const placed: Array<{ from: number; to: number }> = [];
  const kept = new Set<AxisTick>();

  // Priority labels claim their space first, unconditionally: two priority
  // labels that overlap each other is a design the caller has to fix, not
  // something to silently resolve by dropping one of them.
  for (const tick of ticks) {
    if (!isPriority(tick)) continue;
    const half = estimateLabelWidth(tick.label, fontSize) / 2;
    placed.push({ from: tick.x - half, to: tick.x + half });
    kept.add(tick);
  }

  for (const tick of ticks) {
    if (isPriority(tick)) continue;
    const half = estimateLabelWidth(tick.label, fontSize) / 2;
    const from = tick.x - half;
    const to = tick.x + half;
    if (placed.some((box) => from < box.to + gap && box.from - gap < to)) continue;
    placed.push({ from, to });
    kept.add(tick);
  }

  return ticks.filter((t) => kept.has(t));
}
