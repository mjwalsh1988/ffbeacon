"use client";

/**
 * Weekly game log with a season picker. A labeled select switches the season;
 * the chosen season renders a projected-vs-actual accuracy chart (when we hold
 * projections for it) above a week-by-week table. The table shows each week's
 * actual fantasy points in the active scoring alongside that week's projection
 * and the beat/miss delta. Weeks run earliest to latest. All shaping helpers come
 * from the server/client-safe stat-shaping module, so this client component pulls
 * in no server-only code; actual and projected points are precomputed on the
 * server (TE premium already applied) and passed down on each GameRow.
 */

import { useState } from "react";
import {
  statColumns,
  StatScroll,
  lineFromGame,
  type WeeklyGameRow,
  type AccuracyPoint,
} from "@/components/player-profile/stat-shaping";
import { ProjectionActualChart } from "@/components/player-profile/projection-actual-chart";
import { AccuracyStatCards } from "@/components/player-profile/accuracy-stat-cards";

export function WeeklyStats({
  position,
  rowsBySeason,
  seasons,
  scoringLabel,
}: {
  position: string;
  rowsBySeason: Record<number, WeeklyGameRow[]>;
  seasons: number[];
  scoringLabel: string;
}) {
  const [season, setSeason] = useState<number>(seasons[0]);
  const cols = statColumns(position);
  const rows = (rowsBySeason[season] ?? []).slice().sort((a, b) => a.week - b.week);

  // Prior season's actual output keyed by week, for the subtle comparison line.
  const priorByWeek = new Map<number, number>();
  for (const r of rowsBySeason[season - 1] ?? []) {
    if ((r.gp ?? 0) > 0) priorByWeek.set(r.week, r.pts_active);
  }

  // Accuracy series for this season: played weeks, projection where we have it,
  // plus the prior season's same-week actual.
  const accuracyPoints: AccuracyPoint[] = rows
    .filter((r) => (r.gp ?? 0) > 0)
    .map((r) => ({
      week: r.week,
      opponent: r.opponent,
      projected: r.proj_active,
      actual: r.pts_active,
      prior: priorByWeek.get(r.week) ?? null,
    }));
  const hasAccuracy = accuracyPoints.some((p) => p.projected != null);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="weekly-season" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Season
        </label>
        <select
          id="weekly-season"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="rounded-card border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {hasAccuracy && (
        <div className="mb-5 rounded-card border border-line bg-base/30 p-3 sm:p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {season} actual vs projection
          </p>
          <ProjectionActualChart
            points={accuracyPoints}
            scoringLabel={scoringLabel}
            season={season}
          />
          <AccuracyStatCards points={accuracyPoints} mode="historical" />
        </div>
      )}

      <StatScroll caption={`${season} weekly stat lines`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-semibold">
                Wk
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Opp
              </th>
              {cols.map((c) => (
                <th key={c.label} scope="col" className="px-3 py-2 text-right font-semibold">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Snap%
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {scoringLabel}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Proj
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                +/-
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const line = lineFromGame(r);
              const snap = r.snap_pct != null ? `${Math.round(r.snap_pct * 100)}%` : "-";
              const delta = r.proj_active != null ? r.pts_active - r.proj_active : null;
              return (
                <tr key={`${r.season}-${r.week}`} className="hover:bg-surface">
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                  >
                    {r.week}
                  </th>
                  <td className="px-3 py-2 text-ink-muted">{r.opponent ?? "-"}</td>
                  {cols.map((c) => (
                    <td
                      key={c.label}
                      className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted"
                    >
                      {c.get(line)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{snap}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                    {r.pts_active.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    {r.proj_active != null ? r.proj_active.toFixed(1) : "-"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                      delta == null
                        ? "text-ink-subtle"
                        : delta >= 0
                          ? "text-signal-success"
                          : "text-signal-danger"
                    }`}
                  >
                    {delta == null ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StatScroll>
    </div>
  );
}
