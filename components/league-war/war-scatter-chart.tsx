"use client";

/**
 * Trade value against Positional WAR: one dot per player.
 *
 * The line chart says which positions are scarce. This one says whether the
 * market in the reader's league has noticed. High and to the left is a player
 * who wins games and costs little; low and to the right is a player who costs
 * a lot for what he adds to a lineup.
 *
 * THE TWO AXES COME FROM DIFFERENT PLACES ON PURPOSE, and the footnote says
 * so. WAR is computed from this league's own scoring and starting lineup and
 * does not vary by value source (CLAUDE.md). Trade value is whatever the
 * reader's chosen source publishes, at the format derived from the league.
 *
 * Every coordinate comes from lib/positional-war/scatter-geometry.ts, which is
 * pure and tested on its own. This component draws and narrates.
 *
 * NON-COLOR DISTINCTION. Each position keeps the marker SHAPE it has on the
 * line chart (POSITION_SERIES: circle, square, diamond, triangle, cross,
 * star), so the two charts agree and so position is never carried by hue
 * alone.
 *
 * Accessibility: the <svg> is aria-hidden, the plot area is a labelled,
 * focusable group, arrow keys walk the dots in x order, and the readout is
 * mirrored into a polite live region. Pointer travel is debounced so a sweep
 * announces once; a click, an arrow key and Enter are deliberate and announce
 * at once. The complete numbers live in the player table below, which is a real
 * table and is unaffected by anything this component does.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { markerPath, POSITION_SERIES } from "@/components/chart-kit";
import { buildScatterGeometry } from "@/lib/positional-war/scatter-geometry";
import { pickChartBox, quantizeChartWidth } from "@/lib/positional-war/chart-layout";
import type { WarTableRow } from "@/lib/positional-war/table";
import { ownerLabel } from "@/lib/positional-war/table";
import { WAR_TIER_LABEL } from "@/lib/positional-war/tiers";

const READOUT_SPEAK_DELAY_MS = 200;
const DOT_RADIUS = 3;
const ACTIVE_DOT_RADIUS = 5.5;
/** Ink color, matching the line chart's owned-player ring. */
const RING_COLOR = "#F4F4F8";

function readoutText(row: WarTableRow, ordinal: { index: number; total: number }): string {
  const parts = [
    `${row.name}, ${row.position}${row.positionRank}`,
    `trade value ${Math.round(row.tradeValue ?? 0)}`,
    `${row.war.toFixed(2)} matchups over replacement`,
    WAR_TIER_LABEL[row.tier].toLowerCase(),
    `${row.projectedPointsPerWeek.toFixed(1)} points a week`,
    row.isYours ? "on your roster" : ownerLabel(row.owner).toLowerCase(),
    `${ordinal.index} of ${ordinal.total}`,
  ];
  return parts.join(", ") + ".";
}

export function WarScatterChart({ rows }: { rows: WarTableRow[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [renderedWidth, setRenderedWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setRenderedWidth(quantizeChartWidth(node.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Same coordinate-space rule as the line chart: below the breakpoint the
  // viewBox tracks the container so axis type never renders under its nominal
  // size. See lib/positional-war/chart-layout.ts.
  const box = useMemo(() => pickChartBox(renderedWidth), [renderedWidth]);

  const geometry = useMemo(
    () =>
      buildScatterGeometry({
        rows,
        width: box.width,
        height: box.height,
        // A wider left gutter than the line chart: this y-axis carries the
        // same two-decimal WAR labels, and the x-axis carries "12k" style
        // values that need room at the right edge.
        padding: { t: 14, r: 18, b: box.padding.b, l: box.padding.l },
      }),
    [rows, box],
  );

  const rowById = useMemo(() => new Map(rows.map((r) => [r.playerId, r])), [rows]);

  const ordered = useMemo(
    () => [...geometry.points].sort((a, b) => a.x - b.x || a.y - b.y),
    [geometry.points],
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  /**
   * Whether the next announcement should skip the debounce. A pointer sweep
   * settles before it speaks; a click and a key press are deliberate and speak
   * at once. Matches components/league-war/positional-war-chart.tsx.
   */
  const speakAtOnce = useRef(false);
  const [announceNonce, setAnnounceNonce] = useState(0);

  /**
   * Nearest dot to a pointer position, by real two-dimensional distance.
   *
   * Two players can share a trade value and sit a full win apart, so matching
   * on x alone would hand the reader whichever of them the sort happened to
   * reach first. The line chart matched on x alone and had exactly that defect
   * in a worse form (every series has a point at every rank, so three of four
   * lines were unreachable by pointer); it uses this same two-dimensional match
   * now.
   */
  const nearest = (svgX: number, svgY: number): string | null => {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const p of geometry.points) {
      const dx = p.x - svgX;
      const dy = p.y - svgY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = p.playerId;
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
    const next = nearest(svgX, svgY);
    if (immediate) speakAtOnce.current = true;
    setActiveId(next);
    // Clicking the dot already announced re-announces it. The readout text
    // does not change, so the effect below will not run, which is also why the
    // flag is cleared here rather than left to survive into the next hover.
    if (immediate && next !== null && next === activeId) {
      speakAtOnce.current = false;
      setAnnounceNonce((n) => n + 1);
    }
  };

  const moveActiveByStep = (step: number) => {
    if (ordered.length === 0) return;
    speakAtOnce.current = true;
    const currentIndex = ordered.findIndex((p) => p.playerId === activeId);
    const nextIndex =
      currentIndex === -1
        ? step > 0
          ? 0
          : ordered.length - 1
        : Math.max(0, Math.min(ordered.length - 1, currentIndex + step));
    setActiveId(ordered[nextIndex]?.playerId ?? null);
  };

  const active = activeId ? (rowById.get(activeId) ?? null) : null;
  const activeIndex = activeId ? ordered.findIndex((p) => p.playerId === activeId) : -1;
  const readout =
    active && activeIndex >= 0
      ? readoutText(active, { index: activeIndex + 1, total: ordered.length })
      : "";

  const [spokenReadout, setSpokenReadout] = useState("");
  useEffect(() => {
    if (readout === "") {
      setSpokenReadout("");
      return;
    }
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

  if (geometry.points.length === 0) {
    return (
      <p className="rounded-card border border-line bg-base/40 p-4 text-sm text-ink-muted">
        No current trade values for the players on this chart, so there is nothing to plot against
        wins. Try a different value source.
      </p>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label="Trade value against wins over replacement. Click or tap a dot to hear it. Arrow keys move through players from cheapest to most expensive, Home and End jump to the ends, Escape clears the readout."
        className="touch-none rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        // A move only tracks; a press announces.
        onPointerMove={(e) => handlePointer(e.clientX, e.clientY, false)}
        onPointerDown={(e) => handlePointer(e.clientX, e.clientY, true)}
        onPointerLeave={() => setActiveId(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            moveActiveByStep(1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            moveActiveByStep(-1);
          } else if (e.key === "Home") {
            e.preventDefault();
            setActiveId(ordered[0]?.playerId ?? null);
          } else if (e.key === "End") {
            e.preventDefault();
            setActiveId(ordered[ordered.length - 1]?.playerId ?? null);
          } else if (e.key === "Enter" || e.key === " ") {
            // Repeat the current point without moving.
            e.preventDefault();
            if (activeId) setAnnounceNonce((n) => n + 1);
          } else if (e.key === "Escape") {
            setActiveId(null);
          }
        }}
        onBlur={() => setActiveId(null)}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${box.width} ${box.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="pointer-events-none h-auto w-full"
        >
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
          {geometry.xTicks.map((tick) => (
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

          {geometry.trend && (
            <path
              d={geometry.trend.d}
              fill="none"
              stroke="#8A8A9C"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          )}

          {geometry.points.map((point) => {
            const style = POSITION_SERIES[point.position];
            const isActive = point.playerId === activeId;
            const row = rowById.get(point.playerId);
            return (
              <g key={point.playerId}>
                <path
                  d={markerPath(
                    style.marker,
                    point.x,
                    point.y,
                    isActive ? ACTIVE_DOT_RADIUS : DOT_RADIUS,
                  )}
                  fill={style.color}
                  fillOpacity={isActive ? 1 : 0.85}
                />
                {row?.isYours && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={DOT_RADIUS + 3}
                    fill="none"
                    stroke={RING_COLOR}
                    strokeWidth="1.5"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-2 min-h-[2.25rem] text-xs leading-relaxed text-ink-muted" aria-hidden="true">
        {active
          ? `${active.name}, ${active.position}${active.positionRank}: value ${Math.round(active.tradeValue ?? 0)}, ${active.war.toFixed(2)} matchups, ${active.projectedPointsPerWeek.toFixed(1)} pts/wk. ${active.isYours ? "Yours" : ownerLabel(active.owner)}.`
          : "Click a dot, or focus the chart and use the arrow keys, to read a player's numbers."}
      </p>
      {/* Keyed on a counter so clicking the same dot twice, or pressing Enter
          to hear the current one again, is honoured: a live region announces on
          a change, and the text is identical. See the same note in
          components/league-war/positional-war-chart.tsx. */}
      <div aria-live="polite" className="sr-only">
        <p key={announceNonce}>{spokenReadout}</p>
      </div>
    </div>
  );
}
