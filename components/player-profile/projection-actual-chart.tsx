"use client";

/**
 * Projected-vs-actual chart. A hand-rolled, dependency-free SVG that plots a
 * player's weekly projected points (dashed baseline) against what they actually
 * scored (solid line), with a colored connector at each played week so beats
 * (green) and misses (red) read at a glance. `actual` may be null for weeks not
 * yet played, so a current-season chart shows just the projection line until
 * games happen. The SVG is a short, fixed-height, full-width box (stretched, so
 * height stays constant across breakpoints); strokes are non-scaling and there
 * are no circle markers, so nothing distorts under the non-uniform scale. Points
 * come in the active scoring, computed on the server. Exposed to assistive tech
 * as role="img" with a summary plus a visually hidden data table.
 */

import { useRef, useState } from "react";
import type { AccuracyPoint } from "@/components/player-profile/stat-shaping";

const W = 360;
const H = 120;
const PAD = { t: 10, r: 10, b: 16, l: 10 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

const COLOR = {
  actual: "#22D3EE",
  projected: "#8B8BA0",
  prior: "#7E6FB0",
  beat: "#10B981",
  miss: "#EF4444",
  grid: "#22223A",
};

/** Build an SVG path over indices whose value is non-null, breaking the line at
 *  gaps so it never bridges a missing week. */
function gappedPath(
  points: AccuracyPoint[],
  pick: (p: AccuracyPoint) => number | null,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    const v = pick(p);
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? " L" : " M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    pen = true;
  });
  return d.trim();
}

export function ProjectionActualChart({
  points,
  scoringLabel,
  season,
}: {
  points: AccuracyPoint[];
  scoringLabel: string;
  season: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const comparable = points.filter((p) => p.projected != null && p.actual != null);
  const drawable = points.filter(
    (p) => p.projected != null || p.actual != null || p.prior != null,
  );
  const hasActual = points.some((p) => p.actual != null);
  const hasPrior = points.some((p) => p.prior != null);
  const priorSeason = season - 1;

  if (drawable.length < 2) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-5 text-sm text-ink-muted">
        Not enough projection data yet to chart {season}.
      </p>
    );
  }

  const scaleVals = [0];
  for (const p of points) {
    if (p.projected != null) scaleVals.push(p.projected);
    if (p.actual != null) scaleVals.push(p.actual);
    if (p.prior != null) scaleVals.push(p.prior);
  }
  let min = Math.min(...scaleVals);
  let max = Math.max(...scaleVals);
  if (min === max) max = min + 1;

  const n = points.length;
  const x = (i: number) => PAD.l + (n === 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W);
  const y = (v: number) => PAD.t + INNER_H - ((v - min) / (max - min)) * INNER_H;

  const projPath = gappedPath(points, (p) => p.projected, x, y);
  const actualPath = gappedPath(points, (p) => p.actual, x, y);
  const priorPath = gappedPath(points, (p) => p.prior, x, y);

  const beats = comparable.filter((p) => (p.actual ?? 0) >= (p.projected ?? 0)).length;
  const beatPct = comparable.length > 0 ? Math.round((beats / comparable.length) * 100) : 0;
  const avgDiff =
    comparable.length > 0
      ? comparable.reduce((s, p) => s + ((p.actual ?? 0) - (p.projected ?? 0)), 0) / comparable.length
      : 0;

  const summary =
    comparable.length > 0
      ? `Projected versus actual ${scoringLabel} points for ${season}, week by week. Beat projection in ${beats} of ${comparable.length} games (${beatPct}%). Average result was ${
          avgDiff >= 0 ? "+" : ""
        }${avgDiff.toFixed(1)} points versus projection.`
      : `Projected ${scoringLabel} points by week for ${season}. Actual results appear here as games are played.`;

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const frac = (clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  };

  const activePoint = active != null ? points[active] : null;
  const activeLeftPct = active != null ? (x(active) / W) * 100 : 0;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-28 w-full touch-none sm:h-32"
          role="img"
          aria-label={summary}
          preserveAspectRatio="none"
          onPointerMove={(e) => handleMove(e.clientX)}
          onPointerDown={(e) => handleMove(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {/* Baseline + mid gridline. */}
          <line x1={PAD.l} y1={PAD.t + INNER_H} x2={W - PAD.r} y2={PAD.t + INNER_H} stroke={COLOR.grid} strokeWidth="1" />
          <line
            x1={PAD.l}
            y1={PAD.t + INNER_H / 2}
            x2={W - PAD.r}
            y2={PAD.t + INNER_H / 2}
            stroke={COLOR.grid}
            strokeWidth="1"
            strokeDasharray="3 4"
          />

          {/* Beat/miss connectors between projection and actual (played weeks). */}
          {points.map((p, i) =>
            p.projected == null || p.actual == null ? null : (
              <line
                key={`c-${p.week}`}
                x1={x(i)}
                y1={y(p.projected)}
                x2={x(i)}
                y2={y(p.actual)}
                stroke={p.actual >= p.projected ? COLOR.beat : COLOR.miss}
                strokeWidth="2.5"
                strokeOpacity="0.6"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

          {/* Prior season actual (subtle, drawn behind the current-season lines). */}
          {priorPath && (
            <path
              d={priorPath}
              fill="none"
              stroke={COLOR.prior}
              strokeWidth="1.75"
              strokeOpacity="0.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Projected (dashed baseline). */}
          {projPath && (
            <path
              d={projPath}
              fill="none"
              stroke={COLOR.projected}
              strokeWidth="1.75"
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Actual (solid). */}
          {actualPath && (
            <path
              d={actualPath}
              fill="none"
              stroke={COLOR.actual}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Hover guide. */}
          {activePoint && active != null && (
            <line
              x1={x(active)}
              y1={PAD.t}
              x2={x(active)}
              y2={PAD.t + INNER_H}
              stroke={COLOR.actual}
              strokeWidth="1"
              strokeOpacity="0.5"
            />
          )}
        </svg>

        {activePoint && (activePoint.projected != null || activePoint.actual != null) && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-card border border-line bg-surface-elevated/95 px-2 py-1 text-center shadow-xl backdrop-blur"
            style={{ left: `${Math.max(16, Math.min(84, activeLeftPct))}%` }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              Wk {activePoint.week}
              {activePoint.opponent ? ` vs ${activePoint.opponent}` : ""}
            </p>
            {activePoint.actual != null ? (
              <p className="font-mono text-sm font-bold tabular-nums text-brand-cyan">
                {activePoint.actual.toFixed(1)}
                <span className="ml-1 text-[11px] font-normal text-ink-muted">act</span>
              </p>
            ) : (
              <p className="font-mono text-sm font-bold tabular-nums text-ink-subtle">not played</p>
            )}
            {activePoint.projected != null && (
              <p className="font-mono text-[11px] tabular-nums text-ink-muted">
                {activePoint.projected.toFixed(1)} proj
                {activePoint.actual != null && (
                  <>
                    {" ("}
                    <span
                      className={
                        activePoint.actual >= activePoint.projected
                          ? "text-signal-success"
                          : "text-signal-danger"
                      }
                    >
                      {activePoint.actual - activePoint.projected >= 0 ? "+" : ""}
                      {(activePoint.actual - activePoint.projected).toFixed(1)}
                    </span>
                    {")"}
                  </>
                )}
              </p>
            )}
            {activePoint.prior != null && (
              <p className="font-mono text-[11px] tabular-nums" style={{ color: COLOR.prior }}>
                {activePoint.prior.toFixed(1)} in {priorSeason}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Legend + headline accuracy. */}
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="flex items-center gap-3">
          {hasActual && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: COLOR.actual }} />
              Actual
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: COLOR.projected }}
            />
            Projected
          </span>
          {hasPrior && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded opacity-70" style={{ backgroundColor: COLOR.prior }} />
              {priorSeason}
            </span>
          )}
        </span>
        {comparable.length > 0 ? (
          <span className="font-mono font-semibold tabular-nums text-ink">
            Beat <span className="text-signal-success">{beats}</span> of {comparable.length} ({beatPct}%)
          </span>
        ) : (
          <span className="text-ink-subtle">Awaiting results</span>
        )}
      </figcaption>

      {/* Screen-reader data table: the same series, non-visually. */}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Opponent</th>
            <th scope="col">Projected</th>
            <th scope="col">Actual</th>
            <th scope="col">Difference</th>
            <th scope="col">{priorSeason} actual</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{p.week}</td>
              <td>{p.opponent ?? "-"}</td>
              <td>{p.projected != null ? p.projected.toFixed(1) : "-"}</td>
              <td>{p.actual != null ? p.actual.toFixed(1) : "-"}</td>
              <td>
                {p.projected != null && p.actual != null
                  ? `${p.actual - p.projected >= 0 ? "+" : ""}${(p.actual - p.projected).toFixed(1)}`
                  : "-"}
              </td>
              <td>{p.prior != null ? p.prior.toFixed(1) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
