"use client";

/**
 * Positional WAR chart: one line per position, showing wins over replacement
 * by position rank in the league being viewed.
 *
 * Built entirely on top of buildChartGeometry from
 * lib/positional-war/chart-geometry.ts. This component does not own the path
 * maths: the same geometry function draws the OG social card
 * (app/api/og/war/[league_id]/route.tsx), so the two can never disagree about
 * the same league.
 *
 * CONTROLLED OR NOT. The dashboard drives one position filter across this
 * chart, the scatterplot and the player table, so it passes `visible` and
 * `onToggleSeries` and renders the legend itself. The Overview preview has no
 * siblings to stay in step with, so it passes neither and this component keeps
 * its own state and draws its own legend. One component, because the two
 * surfaces must draw the identical chart.
 *
 * Accessibility contract, per CLAUDE.md and docs/league-pulse-positional-war-
 * plan.md section 11.4:
 *   - The <svg> is aria-hidden="true". Every fact it carries also lives in the
 *     legend text, the readout, or the data table rendered alongside it.
 *   - The legend is a row of real aria-pressed toggle buttons (chart-kit-
 *     legend.tsx SeriesToggleLegend), each carrying its own ranking as text.
 *   - Hover, click AND keyboard reveal a point, and that readout is pushed
 *     into an aria-live="polite" region so it reaches a screen reader whether
 *     the interaction was a pointer or a keyboard. Pointer TRAVEL is debounced;
 *     a click, an arrow key and Enter announce at once, because those are a
 *     reader choosing a point rather than passing over one.
 *   - The pointer match is two-dimensional. It used to be x only, and since
 *     every series carries a point at every rank, that made all but the first
 *     visible line unreachable with a mouse: the tie at each x always resolved
 *     to the same series, and switching the others off in the legend was the
 *     only way to read them.
 *   - Left and right arrows move ALONG one position's line; up and down move
 *     ACROSS positions at the same rank. One flat x-sorted list meant following
 *     a single position took four presses per player.
 *   - Hiding a series through the legend removes it from the <svg> only. The
 *     data table is not a prop of this component and is unaffected by legend
 *     state, so it always stays complete.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { markerPath, POSITION_SERIES } from "@/components/chart-kit";
import { SeriesToggleLegend, type SeriesToggleItem } from "@/components/chart-kit-legend";
import {
  buildChartGeometry,
  defaultVisiblePositions,
  WAR_CHART_MAX_RANK,
  type WarAxisMode,
} from "@/lib/positional-war/chart-geometry";
import { fitAxisLabels, pickChartBox, quantizeChartWidth } from "@/lib/positional-war/chart-layout";
import type { WarDashboardPosition, WarTableRow } from "@/lib/positional-war/table";
import { ownerLabel } from "@/lib/positional-war/table";
import { WAR_TIER_LABEL } from "@/lib/positional-war/tiers";
import type { PulsePosition } from "@/lib/power-pulse/types";
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

/**
 * Everything the chart knows about the player under the pointer, as one
 * sentence.
 *
 * The brief asks for complete player information on hover and on keyboard
 * focus, and the row already carries it, so this says who owns him, what tier
 * he lands in and what he currently trades for as well as the two figures the
 * chart plots. Kept to one clause each: this is read aloud, potentially thirty
 * times in a row while somebody arrows along a curve, and every clause is
 * something a reader could not work out from the others.
 */
function readoutText(
  row: WarTableRow,
  ordinal?: { index: number; total: number; series: number; seriesTotal: number },
): string {
  const parts = [
    `${row.name}, ${row.position}${row.positionRank}`,
    WAR_TIER_LABEL[row.tier].toLowerCase(),
    `${row.war.toFixed(2)} matchups over replacement`,
    `${row.pointsAboveReplacement.toFixed(1)} points above replacement`,
    `${row.projectedPointsPerWeek.toFixed(1)} projected points a week against ${row.replacementPointsPerWeek.toFixed(1)}`,
    `projected in ${row.weeksProjected} ${row.weeksProjected === 1 ? "week" : "weeks"}`,
  ];
  // Sleeper's injury designation, verbatim, the same one every other surface
  // shows. The overlay marks a player on IR or the taxi squad rather than
  // filtering him out, because the model is player-independent and he still
  // holds a real rank. Naming him without his designation would tell a reader
  // who owns an injured RB1 the opposite of what the rest of the product says.
  if (row.injuryStatus) parts.push(row.injuryStatus);
  parts.push(row.isYours ? "on your roster" : ownerLabel(row.owner).toLowerCase());
  // A null value is never spoken as a zero: the source publishes none for him.
  parts.push(
    row.tradeValue !== null ? `trade value ${Math.round(row.tradeValue)}` : "no published trade value",
  );
  // Where the reader is, in BOTH directions. A cursor on this chart moves
  // along one position's line and across positions, so "point 4 of 36 on line
  // 2 of 4" is what tells somebody stepping through by keyboard where the
  // arrows will take them next.
  if (ordinal) {
    parts.push(
      `point ${ordinal.index} of ${ordinal.total} on line ${ordinal.series} of ${ordinal.seriesTotal}`,
    );
  }
  return parts.join(", ") + ".";
}

export function PositionalWarChart({
  curves,
  axisMode,
  maxRank = WAR_CHART_MAX_RANK,
  visible: controlledVisible,
  onToggleSeries,
  legend = true,
}: {
  curves: WarDashboardPosition[];
  axisMode: WarAxisMode;
  /** The deepest rank to plot. Must match what the table beneath it lists. */
  maxRank?: number;
  /** Supplied by the dashboard, which shares one filter across three surfaces. */
  visible?: ReadonlySet<PulsePosition>;
  onToggleSeries?: (position: PulsePosition) => void;
  /** False when the parent renders the legend itself. */
  legend?: boolean;
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

  // The uncontrolled fallback. Always created (a hook cannot be conditional)
  // and only read when the parent supplies no `visible`.
  const [internalVisible, setInternalVisible] = useState<Set<PulsePosition>>(() =>
    defaultVisiblePositions(plottable),
  );
  const visible = controlledVisible ?? internalVisible;
  const toggleSeries = (position: PulsePosition) => {
    if (onToggleSeries) {
      onToggleSeries(position);
      return;
    }
    setInternalVisible((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  };

  const hasOwned = useMemo(
    () => plottable.some((c) => c.curve.some((p) => p.isYours)),
    [plottable],
  );
  const [overlayOn, setOverlayOn] = useState(true);

  const geometry = useMemo(
    () =>
      buildChartGeometry({
        curves: plottable.filter((c) => visible.has(c.position)),
        mode: axisMode,
        width: box.width,
        height: box.height,
        padding: box.padding,
        maxRank,
      }),
    [plottable, visible, axisMode, box, maxRank],
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

  // Lookup back from a plotted point's playerId to its full row, which carries
  // the manager, the tier and the value the geometry does not.
  const rowById = useMemo(() => {
    const map = new Map<string, WarTableRow>();
    for (const curve of plottable) {
      for (const row of curve.curve) map.set(row.playerId, row);
    }
    return map;
  }, [plottable]);

  /**
   * The visible series, each with its own plotted points, in canonical
   * position order.
   *
   * Kept AS SERIES rather than flattened, which is the fix for two separate
   * defects. See `nearestPoint` and the keyboard handler below.
   */
  const seriesPoints = useMemo(
    () =>
      geometry.series
        .map((s) => ({ position: s.position, points: s.points }))
        .filter((s) => s.points.length > 0),
    [geometry],
  );

  /** playerId to its place in the grid, so the cursor is O(1) to locate. */
  const pointIndex = useMemo(() => {
    const map = new Map<string, { series: number; point: number }>();
    seriesPoints.forEach((s, series) => {
      s.points.forEach((p, point) => map.set(p.playerId, { series, point }));
    });
    return map;
  }, [seriesPoints]);

  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Whether the next announcement should skip the debounce.
   *
   * A pointer SWEEP should settle before it speaks; a click and a key press
   * are deliberate and should speak at once. A ref rather than state, because
   * flipping it must not itself cause a render.
   */
  const speakAtOnce = useRef(false);

  /**
   * The point nearest the pointer, by real two-dimensional distance.
   *
   * THIS USED TO MATCH ON X ALONE, and that made most of the chart
   * unreachable. Every series has a point at every rank, so at any given x the
   * four candidates were exactly tied, and the tie always resolved to whichever
   * series came first in canonical order. Hovering anywhere on the plot
   * selected a quarterback, whatever line the cursor was actually over, and the
   * only way to read a running back was to switch every other position off in
   * the legend.
   *
   * Distance in viewBox units, which is what the reader is pointing at: the
   * scales are already applied, so this is the same "closest thing to my
   * cursor" the scatterplot does.
   */
  const nearestPoint = (svgX: number, svgY: number): string | null => {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const series of seriesPoints) {
      for (const p of series.points) {
        const dx = p.x - svgX;
        const dy = p.y - svgY;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = p.playerId;
        }
      }
    }
    return best;
  };

  const handlePointer = (clientX: number, clientY: number, immediate: boolean) => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const svgX = ((clientX - rect.left) / rect.width) * box.width;
    const svgY = ((clientY - rect.top) / rect.height) * box.height;
    const next = nearestPoint(svgX, svgY);
    if (immediate) speakAtOnce.current = true;
    setActiveId(next);
    // A click on the point already announced re-announces it. The live region
    // below is keyed on a counter for exactly this: a reader who taps a dot
    // twice asked to hear it twice. The readout text does not change, so the
    // effect will not run, which is also why the flag has to be cleared here:
    // otherwise it would survive to make the next ordinary hover speak early.
    if (immediate && next !== null && next === activeId) {
      speakAtOnce.current = false;
      setAnnounceNonce((n) => n + 1);
    }
  };

  /**
   * Move the cursor within the grid of (series, rank).
   *
   * ALONG a line with Left and Right, ACROSS lines with Up and Down. The old
   * handler walked one flat list sorted by x, so Right stepped QB1, RB1, WR1,
   * TE1, QB2, and following a single position meant pressing it four times
   * between every player. Rank is kept when crossing to another line, clamped
   * to that line's length, so a reader comparing the fourth best at each
   * position can hold the rank and change the position.
   */
  const moveCursor = (deltaSeries: number, deltaPoint: number, jumpTo?: "start" | "end") => {
    if (seriesPoints.length === 0) return;
    speakAtOnce.current = true;
    const current = activeId ? pointIndex.get(activeId) : undefined;
    if (!current) {
      setActiveId(seriesPoints[0].points[0]?.playerId ?? null);
      return;
    }
    const nextSeries = Math.max(
      0,
      Math.min(seriesPoints.length - 1, current.series + deltaSeries),
    );
    const points = seriesPoints[nextSeries].points;
    const target =
      jumpTo === "start"
        ? 0
        : jumpTo === "end"
          ? points.length - 1
          : Math.max(0, Math.min(points.length - 1, current.point + deltaPoint));
    setActiveId(points[target]?.playerId ?? null);
  };

  const legendItems: SeriesToggleItem[] = plottable.map((curve) => ({
    id: curve.position,
    style: POSITION_SERIES[curve.position],
    label: curve.position,
    headline: buildLegendHeadline(curve),
    pressed: visible.has(curve.position),
  }));

  const active = activeId ? (rowById.get(activeId) ?? null) : null;
  const cursor = activeId ? pointIndex.get(activeId) : undefined;
  const activeX = cursor ? (seriesPoints[cursor.series].points[cursor.point]?.x ?? null) : null;
  const readout = active
    ? readoutText(
        active,
        cursor
          ? {
              index: cursor.point + 1,
              total: seriesPoints[cursor.series].points.length,
              series: cursor.series + 1,
              seriesTotal: seriesPoints.length,
            }
          : undefined,
      )
    : "";

  // See the live region at the foot of this component for why this exists.
  const [spokenReadout, setSpokenReadout] = useState("");
  const [announceNonce, setAnnounceNonce] = useState(0);
  useEffect(() => {
    if (readout === "") {
      setSpokenReadout("");
      return;
    }
    // A click or a key press already declared itself deliberate, so it speaks
    // now. Only pointer travel waits for the reader to settle.
    if (speakAtOnce.current) {
      speakAtOnce.current = false;
      setSpokenReadout(readout);
      setAnnounceNonce((n) => n + 1);
      return;
    }
    const timer = setTimeout(() => {
      setSpokenReadout(readout);
      setAnnounceNonce((n) => n + 1);
    }, READOUT_SPEAK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [readout]);

  // Ring markers: one per owned point currently visible, offset by rank
  // collision so two adjacent owned players do not draw one indistinguishable
  // blob. Computed in x-plot order across the currently visible series only.
  const ringMarkers = useMemo(() => {
    if (!overlayOn) return [];
    const owned = new Set<string>();
    for (const curve of plottable) {
      for (const row of curve.curve) if (row.isYours) owned.add(row.playerId);
    }
    if (owned.size === 0) return [];
    const rings: Array<{ x: number; y: number; r: number }> = [];
    for (const series of geometry.series) {
      const points = series.points
        .filter((p) => owned.has(p.playerId))
        .sort((a, b) => a.x - b.x);
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
  }, [geometry, plottable, overlayOn, box.ringRadius]);

  if (plottable.length === 0) {
    return null;
  }

  return (
    <div>
      {(legend || hasOwned) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {legend ? <SeriesToggleLegend items={legendItems} onToggle={(id) => toggleSeries(id as PulsePosition)} /> : <span />}
          {hasOwned && (
            <button
              type="button"
              aria-pressed={overlayOn}
              onClick={() => setOverlayOn((v) => !v)}
              className="flex min-h-11 min-w-11 items-center gap-2 rounded-card border border-line bg-base/40 px-3 py-2 text-left text-xs font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple aria-[pressed=false]:opacity-60"
            >
              {/* pointer-events-none so a hover lands on the BUTTON, not on a
                  decorative graphic that is not in the accessibility tree. A
                  screen reader tracking the mouse announces the object under
                  the cursor, and an aria-hidden svg announces nothing. */}
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                className="pointer-events-none shrink-0"
              >
                <circle cx="8" cy="8" r="6" fill="none" stroke={RING_COLOR} strokeWidth="2" />
              </svg>
              <span>Ring my players</span>
            </button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label="Wins over replacement chart. Click or tap a point to hear it. Left and right arrows move along one position's line, up and down arrows switch position at the same rank, Home and End jump to the ends of the line, Escape clears the readout."
        // touch-none lives here rather than on the <svg> below, because the svg
        // is pointer-events-none and therefore no longer the touch target: a
        // drag across the chart now lands on this element, and without it the
        // browser pans the page instead of moving the readout.
        className="mt-3 touch-none rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        // A move only tracks; a press announces. That is the difference between
        // sweeping across the chart and choosing a player on it.
        onPointerMove={(e) => handlePointer(e.clientX, e.clientY, false)}
        onPointerDown={(e) => handlePointer(e.clientX, e.clientY, true)}
        onPointerLeave={() => setActiveId(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            moveCursor(0, 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            moveCursor(0, -1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            moveCursor(1, 0);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveCursor(-1, 0);
          } else if (e.key === "Home") {
            e.preventDefault();
            moveCursor(0, 0, "start");
          } else if (e.key === "End") {
            e.preventDefault();
            moveCursor(0, 0, "end");
          } else if (e.key === "Enter" || e.key === " ") {
            // Re-announce whatever the cursor is on, for a reader who wants it
            // repeated without moving.
            e.preventDefault();
            if (activeId) setAnnounceNonce((n) => n + 1);
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
          {/* The zero line, drawn brighter than the gridlines because it is the
              one horizontal on the chart that means something: at it, a player
              is worth exactly what a freely available one is worth.

              DELIBERATELY UNLABELLED IN THE SVG. A label here sits exactly
              where every series ends up, so it lands on top of the very points
              it is describing. The caption below the chart names it instead,
              as real text a screen reader reaches. */}
          {geometry.zeroY !== null && (
            <line
              x1={geometry.plot.left}
              y1={geometry.zeroY}
              x2={geometry.plot.right}
              y2={geometry.zeroY}
              stroke="#4A4A63"
              strokeWidth="1.5"
            />
          )}
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
                {/* The replacement boundary for this position: the rank of the
                    last player this league starts. Hollow, so it reads as a
                    boundary rather than as another player. */}
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

      {/* What the two kinds of marking on the chart mean, as text rather than
          as labels drawn into an aria-hidden graphic. The horizontal reading
          is the same for every position; the hollow markers differ per
          position, which is why the count travels with each one. */}
      <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
        The brighter horizontal line is replacement level: zero extra matchups. The hollow marker on
        each line is the last player at that position this league starts.
      </p>

      {/* Visible readout, mirrored into the aria-live region below for screen readers. */}
      <p className="mt-2 min-h-[2.25rem] text-xs leading-relaxed text-ink-muted" aria-hidden="true">
        {active
          ? `${active.name}, ${active.position}${active.positionRank}, ${WAR_TIER_LABEL[active.tier]}: ${active.war.toFixed(2)} matchups, ${active.projectedPointsPerWeek.toFixed(1)} pts/wk vs ${active.replacementPointsPerWeek.toFixed(1)} replacement. ${active.isYours ? "Yours" : ownerLabel(active.owner)}${active.tradeValue !== null ? `, value ${Math.round(active.tradeValue)}` : ""}.`
          : "Click a point, or focus the chart and use the arrow keys, to read a player's numbers."}
      </p>
      {/*
        POINTER TRAVEL IS DEBOUNCED. A CLICK AND A KEY PRESS ARE NOT.

        The nearest point changes every few pixels of pointer travel on a dense
        series, so an ordinary mouse sweep or a touch drag would queue a dozen
        sentences into a polite live region inside a second. That is worth
        waiting out. A click and an arrow key are not travel: the reader has
        chosen a point and is asking for it, so those speak at once (see
        speakAtOnce).

        THE INNER <p> IS KEYED ON A COUNTER. A live region announces when its
        contents CHANGE, so clicking the same dot twice, or pressing Enter to
        hear the current one again, would be silent: the text is identical.
        Bumping the key remounts the paragraph inside the region, which is a
        mutation, so the request is honoured.
      */}
      <div aria-live="polite" className="sr-only">
        <p key={announceNonce}>{spokenReadout}</p>
      </div>
    </div>
  );
}
