/**
 * Three summary tiles that sit under a projected-vs-actual chart, styled like the
 * season projection hero cards (near-black tiles, big mono numbers). The first
 * two are shared: how often the player beat projection, and the average per-week
 * differential. The third depends on `mode`:
 *   - "projection": a pace-based full-season total (this year's per-game average
 *     extended across the projected slate) versus the projected season total, or
 *     "--" when no games have been played yet.
 *   - "historical": the actual season total versus the projected season total.
 * Pure and presentational, so it renders inside the client chart wrappers without
 * any server dependency.
 */

import type { ReactNode } from "react";
import type { AccuracyPoint } from "@/components/player-profile/stat-shaping";

/** Near-black tile so the bright numbers stand out (matches the hero cards). */
const TILE = "#0A0A12";

function signed(v: number, digits = 0): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function diffClass(v: number): string {
  return v >= 0 ? "text-signal-success" : "text-signal-danger";
}

export function AccuracyStatCards({
  points,
  mode,
}: {
  points: AccuracyPoint[];
  mode: "projection" | "historical";
}) {
  const comparable = points.filter((p) => p.projected != null && p.actual != null);
  const beats = comparable.filter((p) => (p.actual as number) >= (p.projected as number)).length;
  const beatPct = comparable.length ? Math.round((beats / comparable.length) * 100) : null;
  const avgDiff = comparable.length
    ? comparable.reduce((s, p) => s + ((p.actual as number) - (p.projected as number)), 0) /
      comparable.length
    : null;

  const projectedSeasonTotal = points
    .filter((p) => p.projected != null)
    .reduce((s, p) => s + (p.projected as number), 0);

  // Third tile.
  let thirdLabel: string;
  let thirdValue: string;
  let thirdValueClass = "text-brand-purple";
  let thirdSub: ReactNode;

  if (mode === "projection") {
    thirdLabel = "Pace total";
    const completed = points.filter((p) => p.actual != null);
    if (completed.length === 0) {
      thirdValue = "--";
      thirdValueClass = "text-ink-subtle";
      thirdSub = "no games played yet";
    } else {
      const avgActual =
        completed.reduce((s, p) => s + (p.actual as number), 0) / completed.length;
      const games = points.filter((p) => p.projected != null).length || completed.length;
      const paceTotal = avgActual * games;
      const diff = paceTotal - projectedSeasonTotal;
      const pct = projectedSeasonTotal ? (diff / projectedSeasonTotal) * 100 : 0;
      thirdValue = paceTotal.toFixed(0);
      thirdSub = (
        <>
          <span className={diffClass(diff)}>
            {signed(diff)} ({signed(pct)}%)
          </span>{" "}
          vs {projectedSeasonTotal.toFixed(0)} proj
        </>
      );
    }
  } else {
    thirdLabel = "Season total";
    const actualTotal = points
      .filter((p) => p.actual != null)
      .reduce((s, p) => s + (p.actual as number), 0);
    const diff = actualTotal - projectedSeasonTotal;
    const pct = projectedSeasonTotal ? (diff / projectedSeasonTotal) * 100 : 0;
    thirdValue = actualTotal.toFixed(0);
    thirdSub = (
      <>
        <span className={diffClass(diff)}>
          {signed(diff)} ({signed(pct)}%)
        </span>{" "}
        vs {projectedSeasonTotal.toFixed(0)} proj
      </>
    );
  }

  return (
    <dl className="mt-3 grid grid-cols-3 gap-2">
      <div className="rounded-card border border-line px-3 py-2.5" style={{ backgroundColor: TILE }}>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Beat rate
        </dt>
        <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-brand-cyan">
          {beatPct != null ? `${beatPct}%` : "--"}
        </dd>
        <p className="mt-0.5 text-[10px] leading-tight text-ink-subtle">
          {comparable.length ? `${beats} of ${comparable.length} weeks over` : "no results yet"}
        </p>
      </div>

      <div className="rounded-card border border-line px-3 py-2.5" style={{ backgroundColor: TILE }}>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Avg vs proj
        </dt>
        <dd
          className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${
            avgDiff == null ? "text-ink-subtle" : diffClass(avgDiff)
          }`}
        >
          {avgDiff != null ? signed(avgDiff, 1) : "--"}
        </dd>
        <p className="mt-0.5 text-[10px] leading-tight text-ink-subtle">points per week</p>
      </div>

      <div className="rounded-card border border-line px-3 py-2.5" style={{ backgroundColor: TILE }}>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          {thirdLabel}
        </dt>
        <dd className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${thirdValueClass}`}>
          {thirdValue}
        </dd>
        <p className="mt-0.5 text-[10px] leading-tight text-ink-subtle">{thirdSub}</p>
      </div>
    </dl>
  );
}
