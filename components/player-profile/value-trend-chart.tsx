"use client";

/**
 * Value trend chart. A hand-rolled, dependency-free SVG line/area chart of a
 * player's market value over the last ~30 days (or whatever history exists for
 * the resolved source + format). The line uses the beacon purple to cyan
 * gradient; hovering or moving a pointer reveals the nearest day's value. The
 * chart is exposed to assistive tech as role="img" with a summary plus a
 * visually hidden data table, so no information is vision-only.
 */

import { useId, useRef, useState } from "react";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import type { ValuePoint } from "@/lib/player-profile";

const W = 320;
const H = 128;
const PAD = { t: 12, r: 12, b: 20, l: 12 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: SITE_TIME_ZONE,
  }).format(d);
}

export function ValueTrendChart({
  points,
  sourceDisplay,
  formatDisplay,
  windowed,
}: {
  points: ValuePoint[];
  sourceDisplay: string | null;
  formatDisplay: string;
  windowed: boolean;
}) {
  const gid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [active, setActive] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
        Not enough value history yet to chart. Check back as more daily values are captured for{" "}
        {formatDisplay}.
      </p>
    );
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    // Flat series: pad so the line sits mid-height instead of on an edge.
    min -= 1;
    max += 1;
  }
  const n = points.length;
  const x = (i: number) => PAD.l + (i / (n - 1)) * INNER_W;
  const y = (v: number) => PAD.t + INNER_H - ((v - min) / (max - min)) * INNER_H;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(n - 1).toFixed(1)} ${(PAD.t + INNER_H).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD.t + INNER_H).toFixed(1)} Z`;

  const first = points[0];
  const last = points[n - 1];
  const net = last.value - first.value;
  const netPct = first.value !== 0 ? (net / first.value) * 100 : 0;
  const rangeLabel = `${shortDate(first.t)} to ${shortDate(last.t)}`;

  const summary = `Market value trend, ${formatDisplay}${
    sourceDisplay ? `, ${sourceDisplay}` : ""
  }: ${rangeLabel}. From ${Math.round(first.value).toLocaleString()} to ${Math.round(
    last.value,
  ).toLocaleString()}, a net change of ${net >= 0 ? "+" : ""}${Math.round(net).toLocaleString()} (${
    netPct >= 0 ? "+" : ""
  }${netPct.toFixed(1)}%).`;

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const frac = (clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, idx)));
  };

  const activePoint = active != null ? points[active] : null;
  const activeLeftPct = active != null ? (x(active) / W) * 100 : 0;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={summary}
          preserveAspectRatio="none"
          onPointerMove={(e) => handleMove(e.clientX)}
          onPointerDown={(e) => handleMove(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id={`stroke-${gid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#22D3EE" />
            </linearGradient>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Baseline + mid gridline for reference. */}
          <line
            x1={PAD.l}
            y1={PAD.t + INNER_H}
            x2={W - PAD.r}
            y2={PAD.t + INNER_H}
            stroke="#1F1F33"
            strokeWidth="1"
          />
          <line
            x1={PAD.l}
            y1={PAD.t + INNER_H / 2}
            x2={W - PAD.r}
            y2={PAD.t + INNER_H / 2}
            stroke="#1F1F33"
            strokeWidth="1"
            strokeDasharray="3 4"
          />

          <path d={areaPath} fill={`url(#fill-${gid})`} />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#stroke-${gid})`}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Latest-point marker. */}
          <circle cx={x(n - 1)} cy={y(last.value)} r="3.5" fill="#22D3EE" />

          {/* Hover guide + dot. */}
          {activePoint && active != null && (
            <g>
              <line
                x1={x(active)}
                y1={PAD.t}
                x2={x(active)}
                y2={PAD.t + INNER_H}
                stroke="#A855F7"
                strokeWidth="1"
                strokeOpacity="0.6"
              />
              <circle cx={x(active)} cy={y(activePoint.value)} r="4" fill="#A855F7" stroke="#07070D" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {activePoint && (
          <div
            className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-card border border-line bg-surface-elevated/95 px-2 py-1 text-center shadow-xl backdrop-blur"
            style={{ left: `${Math.max(14, Math.min(86, activeLeftPct))}%` }}
          >
            <p className="font-mono text-sm font-bold tabular-nums text-ink">
              {Math.round(activePoint.value).toLocaleString()}
            </p>
            <p className="text-[10px] text-ink-subtle">{shortDate(activePoint.t)}</p>
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span>{rangeLabel}</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            net > 0 ? "text-signal-success" : net < 0 ? "text-signal-warning" : "text-ink-muted"
          }`}
        >
          {net >= 0 ? "+" : ""}
          {Math.round(net).toLocaleString()} ({netPct >= 0 ? "+" : ""}
          {netPct.toFixed(1)}%)
        </span>
      </figcaption>
      {!windowed && (
        <p className="mt-1 text-[11px] text-ink-subtle">
          Showing all available history (under 30 days captured).
        </p>
      )}

      {/* Screen-reader data table: the same series, non-visually. */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.t}>
              <td>{shortDate(p.t)}</td>
              <td>{Math.round(p.value).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
