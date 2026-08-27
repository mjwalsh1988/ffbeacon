"use client";

/**
 * Positional WAR chart: six curves, one per position, showing wins over
 * replacement by position rank in the league being viewed.
 *
 * Built entirely on top of buildChartGeometry from
 * lib/positional-war/chart-geometry.ts. This component does not own the path
 * maths: the same geometry function draws the OG social card
 * (app/api/og/war/[league_id]/route.tsx), so the two can never disagree about
 * the same league.
 *
 * Accessibility contract, per CLAUDE.md and docs/league-pulse-positional-war-
 * plan.md section 11.4:
 *   - The <svg> is aria-hidden="true". Every fact it carries also lives in the
 *     legend text, the readout, or the data table the panel renders alongside
 *     this component.
 *   - The legend is a row of real aria-pressed toggle buttons (chart-kit-
 *     legend.tsx SeriesToggleLegend), each carrying its own ranking as text.
 *   - Hover AND focus reveal the nearest point across the currently visible
 *     series, and that readout is pushed into an aria-live="polite" region so
 *     it reaches a screen reader whether the interaction was a pointer or a
 *     keyboard.
 *   - Hiding a series through the legend removes it from the <svg> only. The
 *     data table lives in the panel, is not a prop of this component, and is
 *     unaffected by legend state, so it always stays complete.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { markerPath, POSITION_SERIES } from "@/components/chart-kit";
import { SeriesToggleLegend, type SeriesToggleItem } from "@/components/chart-kit-legend";
import { buildChartGeometry, type WarAxisMode } from "@/lib/positional-war/chart-geometry";
import { fitAxisLabels, pickChartBox, quantizeChartWidth } from "@/lib/positional-war/chart-layout";
import type { PlottableCurve, WarCurvePoint } from "@/lib/positional-war/types";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { matchCurveOwnership } from "./overlay";
import { buildLegendHeadline } from "./summary";

/** Ink color (tailwind ink.DEFAULT, #F4F4F8), for the viewer-overlay ring marker. */
const RING_COLOR = "#F4F4F8";
const RING_COLLISION_STEP = 1;
const RING_COLLISION_CAP = 4;
const RING_COLLISION_PX = 6;

/** Minimum clear space between two x-axis labels, in viewBox units. */
const LABEL_GAP = 4;
/**
 * How long the pointer has to settle before the live region speaks. Long
 * enough that a sweep across the chart announces once, short enough that it
 * never feels like a lag when somebody stops on a player.
 */
const READOUT_SPEAK_DELAY_MS = 200;

function readoutText(
  point: WarCurvePoint,
  position: PulsePosition,
  isYours: boolean,
  ordinal?: { index: number; total: number },
): string {
  const parts = [
    `${point.name}, ${position}${point.positionRank}`,
    `${point.war.toFixed(2)} wins over replacement`,
    `${point.projectedPointsPerWeek.toFixed(1)} points a week against ${point.replacementPointsPerWeek.toFixed(1)}`,
  ];
  // The injury designation, verbatim, the same one every other surface in the
  // product shows. The overlay deliberately marks a player on IR or the taxi
  // squad rather than filtering him out, because the model is
  // player-independent and he still holds a real rank. Naming him without his
  // designation would tell a reader who owns an injured RB1 the opposite of
  // what the rest of the product tells them about the same player.
  if (point.injuryStatus) parts.push(point.injuryStatus);
  if (isYours) parts.push("on your roster");
  // Where the reader is in the sequence, so somebody stepping through forty
  // points by keyboard has a sense of position rather than an unbounded walk.
  if (ordinal) parts.push(`${ordinal.index} of ${ordinal.total}`);
  // Four clauses at most, and each one is a thing a reader could not work out
  // from the others. This used to name the metric and spell out both
  // points-per-week figures in full, which is a long sentence to hear once and
  // an exhausting one to hear forty times while arrowing along a curve.
  return parts.join(", ") + ".";
}

export function PositionalWarChart({
  curves,
  axisMode,
  ownedSleeperIds,
}: {
  curves: PlottableCurve[];
  axisMode: WarAxisMode;
  /** From the resolved viewer roster (lib/league-positional-war-data.ts). Empty or omitted means no overlay. */
  ownedSleeperIds?: string[];
}) {
  const gid = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);

  /**
   * The chart's rendered CSS width, which decides the coordinate space it
   * draws into. See lib/positional-war/chart-layout.ts for why a fixed
   * 640-by-360 viewBox is unreadable on a phone: the SVG scales, and so does
   * every axis label with it.
   *
   * Null until measured, which is what the server renders and what the first
   * client paint renders, so hydration matches. A narrow container swaps to
   * the narrow box on the first observer callback.
   */
  const [renderedWidth, setRenderedWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Quantized before it reaches state, so a resize drag settles on a handful
    // of distinct widths instead of one per pixel, and React bails out of the
    // renders in between.
    const measure = () =>
      setRenderedWidth(quantizeChartWidth(node.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const box = useMemo(() => pickChartBox(renderedWidth), [renderedWidth]);

  const plottable = useMemo(() => curves.filter((c) => c.curve.length > 0), [curves]);

  const [visible, setVisible] = useState<Set<PulsePosition>>(
    () => new Set(plottable.map((c) => c.position)),
  );

  const hasOwnedIds = (ownedSleeperIds?.length ?? 0) > 0;
  const [overlayOn, setOverlayOn] = useState(hasOwnedIds);

  const ownedSet = useMemo(() => new Set(ownedSleeperIds ?? []), [ownedSleeperIds]);
  const ownership = useMemo(() => matchCurveOwnership(curves, ownedSet), [curves, ownedSet]);

  const geometry = useMemo(
    () =>
      buildChartGeometry({
        curves: plottable.filter((c) => visible.has(c.position)),
        mode: axisMode,
        width: box.width,
        height: box.height,
        padding: box.padding,
      }),
    [plottable, visible, axisMode, box],
  );

  /**
   * The x-axis labels that actually fit. "Replacement level" is the priority
   * label: it is the one sentence on the axis and it is far wider than the
   * decimals either side of it, so it claims its space first and its
   * neighbours give way. Nothing is hidden by this: every plotted value is in
   * the data table the panel renders under the chart.
   */
  const xLabels = useMemo(
    () =>
      fitAxisLabels(
        geometry.xTicks,
        box.fontSize,
        LABEL_GAP,
        (tick) => tick.label === "Replacement level",
      ),
    [geometry.xTicks, box.fontSize],
  );

  // Lookup back from a plotted point's playerId to its full WarCurvePoint (for
  // the readout's projected/replacement figures, which the geometry does not
  // carry) and to the position it belongs to.
  const pointDetail = useMemo(() => {
    const map = new Map<string, { point: WarCurvePoint; position: PulsePosition }>();
    for (const curve of plottable) {
      for (const point of curve.curve) map.set(point.playerId, { point, position: curve.position });
    }
    return map;
  }, [plottable]);

  // Flattened, x-sorted list of every visible plotted point, for keyboard
  // Arrow navigation and for nearest-point hover lookup.
  const flatPoints = useMemo(() => {
    const out: Array<{ x: number; y: number; playerId: string }> = [];
    for (const series of geometry.series) {
      for (const pt of series.points) out.push({ x: pt.x, y: pt.y, playerId: pt.playerId });
    }
    out.sort((a, b) => a.x - b.x);
    return out;
  }, [geometry]);

  const [activeId, setActiveId] = useState<string | null>(null);

  const nearestByX = (svgX: number): string | null => {
    if (flatPoints.length === 0) return null;
    let best = flatPoints[0];
    let bestDist = Math.abs(best.x - svgX);
    for (const p of flatPoints) {
      const dist = Math.abs(p.x - svgX);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    return best.playerId;
  };

  const handlePointerMove = (clientX: number) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * box.width;
    setActiveId(nearestByX(svgX));
  };

  const moveActiveByStep = (step: number) => {
    if (flatPoints.length === 0) return;
    const currentIndex = flatPoints.findIndex((p) => p.playerId === activeId);
    const nextIndex =
      currentIndex === -1
        ? step > 0
          ? 0
          : flatPoints.length - 1
        : Math.max(0, Math.min(flatPoints.length - 1, currentIndex + step));
    setActiveId(flatPoints[nextIndex]?.playerId ?? null);
  };

  const legendItems: SeriesToggleItem[] = plottable.map((curve) => ({
    id: curve.position,
    style: POSITION_SERIES[curve.position],
    label: curve.position,
    headline: buildLegendHeadline(curve),
    pressed: visible.has(curve.position),
  }));

  const toggleSeries = (id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      const pos = id as PulsePosition;
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  };

  const active = activeId ? pointDetail.get(activeId) : null;
  const activeIndex = activeId ? flatPoints.findIndex((p) => p.playerId === activeId) : -1;
  const activeX = activeIndex >= 0 ? (flatPoints[activeIndex]?.x ?? null) : null;
  const activeIsOwned = active ? ownedSet.has(active.point.sleeperId ?? "") : false;
  const readout = active
    ? readoutText(
        active.point,
        active.position,
        activeIsOwned,
        activeIndex >= 0 ? { index: activeIndex + 1, total: flatPoints.length } : undefined,
      )
    : "";

  // See the live region at the foot of this component for why this exists.
  const [spokenReadout, setSpokenReadout] = useState("");
  useEffect(() => {
    if (readout === "") {
      setSpokenReadout("");
      return;
    }
    const timer = setTimeout(() => setSpokenReadout(readout), READOUT_SPEAK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [readout]);

  // Ring markers: one per owned point currently visible, offset by rank
  // collision so two adjacent owned players do not draw one indistinguishable
  // blob. Computed in x-plot order across the currently visible series only.
  const ringMarkers = useMemo(() => {
    if (!overlayOn) return [];
    const rings: Array<{ x: number; y: number; r: number }> = [];
    for (const series of geometry.series) {
      const owned = ownership.matchedByPosition.get(series.position);
      if (!owned || owned.length === 0) continue;
      const ownedIds = new Set(owned.map((p) => p.playerId));
      const points = series.points.filter((p) => ownedIds.has(p.playerId)).sort((a, b) => a.x - b.x);
      let collisions = 0;
      let prevX: number | null = null;
      for (const pt of points) {
        if (prevX !== null && Math.abs(pt.x - prevX) < RING_COLLISION_PX) {
          collisions = Math.min(RING_COLLISION_CAP, collisions + 1);
        } else {
          collisions = 0;
        }
        rings.push({ x: pt.x, y: pt.y, r: box.ringRadius + collisions * RING_COLLISION_STEP });
        prevX = pt.x;
      }
    }
    return rings;
  }, [geometry, ownership, overlayOn, box.ringRadius]);

  if (plottable.length === 0) {
    return null;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeriesToggleLegend items={legendItems} onToggle={toggleSeries} />
        {hasOwnedIds && (
          <button
            type="button"
            aria-pressed={overlayOn}
            onClick={() => setOverlayOn((v) => !v)}
            className="flex min-h-11 min-w-11 items-center gap-2 rounded-card border border-line bg-base/40 px-3 py-2 text-left text-xs font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple aria-[pressed=false]:opacity-60"
          >
            {/* pointer-events-none so a hover lands on the BUTTON, not on a
                decorative graphic that is not in the accessibility tree. A
                screen reader tracking the mouse announces the object under the
                cursor, and an aria-hidden svg announces nothing. */}
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              className="pointer-events-none shrink-0"
            >
              <circle cx="8" cy="8" r="6" fill="none" stroke={RING_COLOR} strokeWidth="2" />
            </svg>
            <span>Your team</span>
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label="Positional WAR chart. Arrow keys move through players, Home and End jump to the ends, Escape clears the readout."
        // touch-none lives here rather than on the <svg> below, because the svg
        // is pointer-events-none and therefore no longer the touch target: a
        // drag across the chart now lands on this element, and without it the
        // browser pans the page instead of moving the readout.
        className="mt-3 touch-none rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        onPointerMove={(e) => handlePointerMove(e.clientX)}
        onPointerDown={(e) => handlePointerMove(e.clientX)}
        onPointerLeave={() => setActiveId(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            moveActiveByStep(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            moveActiveByStep(-1);
          } else if (e.key === "Home") {
            e.preventDefault();
            setActiveId(flatPoints[0]?.playerId ?? null);
          } else if (e.key === "End") {
            e.preventDefault();
            setActiveId(flatPoints[flatPoints.length - 1]?.playerId ?? null);
          } else if (e.key === "Escape") {
            setActiveId(null);
          }
        }}
        onBlur={() => setActiveId(null)}
      >
        {/* pointer-events-none, so hovering anywhere on the graphic hit-tests
            to the labelled group above rather than to an aria-hidden <svg> a
            screen reader cannot name. The pointer handlers all sit on that
            group and measure through getBoundingClientRect, so none of them
            needs the svg to receive events. */}
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${box.width} ${box.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none h-auto w-full"
        >
          {/* Gridlines at each y tick. */}
          {geometry.yTicks.map((tick) => (
            <line
              key={`y-${tick.y}`}
              x1={geometry.plot.left}
              y1={tick.y}
              x2={geometry.plot.right}
              y2={tick.y}
              stroke="#1F1F33"
              strokeWidth="1"
            />
          ))}
          {geometry.yTicks.map((tick) => (
            <text
              key={`yl-${tick.y}`}
              x={geometry.plot.left - 5}
              y={tick.y + box.fontSize / 3}
              textAnchor="end"
              fontSize={box.fontSize}
              fill="#8A8A9C"
            >
              {tick.label}
            </text>
          ))}
          {xLabels.map((tick) => (
            <text
              key={`xl-${tick.x}`}
              x={tick.x}
              y={geometry.plot.bottom + box.fontSize + 5}
              textAnchor="middle"
              fontSize={box.fontSize}
              fill="#8A8A9C"
            >
              {tick.label}
            </text>
          ))}

          {geometry.series.map((series) => {
            const style = POSITION_SERIES[series.position];
            return (
              <g key={series.position}>
                <path
                  d={series.d}
                  fill="none"
                  stroke={style.color}
                  strokeWidth="2"
                  strokeDasharray={style.dash ?? undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {series.points.map((pt) => (
                  <path
                    key={pt.playerId}
                    d={markerPath(
                      style.marker,
                      pt.x,
                      pt.y,
                      pt.playerId === activeId ? box.activePointRadius : box.pointRadius,
                    )}
                    fill={style.color}
                  />
                ))}
                {series.markerAt && (
                  <path
                    d={markerPath(style.marker, series.markerAt.x, series.markerAt.y, box.markerRadius)}
                    fill="none"
                    stroke={style.color}
                    strokeWidth="2"
                  />
                )}
              </g>
            );
          })}

          {ringMarkers.map((ring, i) => (
            <circle
              key={`ring-${gid}-${i}`}
              cx={ring.x}
              cy={ring.y}
              r={ring.r}
              fill="none"
              stroke={RING_COLOR}
              strokeWidth="2"
            />
          ))}

          {active && activeX !== null && (
            <line
              x1={activeX}
              y1={geometry.plot.top}
              x2={activeX}
              y2={geometry.plot.bottom}
              stroke="#A855F7"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
          )}
        </svg>
      </div>

      {/* Visible readout, mirrored into the aria-live region below for screen readers. */}
      <p className="mt-2 min-h-[1.5rem] text-xs text-ink-muted" aria-hidden="true">
        {active
          ? `${active.point.name}, ${active.position}${active.point.positionRank}: ${active.point.war.toFixed(2)} wins, ${active.point.projectedPointsPerWeek.toFixed(1)} pts/wk vs ${active.point.replacementPointsPerWeek.toFixed(1)} replacement.`
          : "Hover or focus the chart to read a player's numbers."}
      </p>
      {/*
        The spoken readout is DEBOUNCED, and the visible one above is not.

        The nearest point changes every five to fifteen CSS pixels of pointer
        travel on a dense series, so an ordinary mouse sweep or a touch drag
        across the chart would queue a dozen different sentences into a polite
        live region inside a second. Sighted readers want the visible line to
        track the pointer exactly; a screen reader wants the sentence for where
        the pointer came to REST. Keyboard stepping is one point per press and
        settles inside the delay either way, so it is unaffected.
      */}
      <p aria-live="polite" className="sr-only">
        {spokenReadout}
      </p>
    </div>
  );
}
