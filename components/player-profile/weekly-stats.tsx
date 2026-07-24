"use client";

/**
 * Weekly game log with a season picker. A labeled select switches the season;
 * the chosen season renders a projected-vs-actual accuracy chart (when we hold
 * projections for it) above a week-by-week table. The table shows each week's
 * actual fantasy points in the active scoring alongside that week's projection
 * and the beat/miss delta, and (when "Vs projection" is on) a small colored
 * differential under each individual stat so a reader can see, per stat, whether
 * the player beat or missed that week's projected targets, yards, TDs, and so on.
 * A per-stat season accuracy breakdown summarizes how often each stat hit its
 * mark. Weeks run earliest to latest. All shaping helpers come from the
 * server/client-safe stat-shaping module, so this client component pulls in no
 * server-only code; actual and projected points/lines are precomputed on the
 * server (TE premium already applied) and passed down on each GameRow.
 */

import { useState } from "react";
import {
  statColumns,
  StatScroll,
  lineFromGame,
  fmtStatDelta,
  deltaTone,
  type StatLine,
  type StatCol,
  type WeeklyGameRow,
  type AccuracyPoint,
  type BeatRate,
  type StatAccuracy,
} from "@/components/player-profile/stat-shaping";
import { ProjectionActualChart } from "@/components/player-profile/projection-actual-chart";
import { AccuracyStatCards } from "@/components/player-profile/accuracy-stat-cards";
import { StatAccuracyBreakdown } from "@/components/player-profile/stat-accuracy-breakdown";

/** Green for a good outcome, red for a bad one, muted when the delta rounds to
 *  zero (on projection) so a displayed "0" is never colored as a beat or miss. */
const TONE_CLASS = {
  good: "text-signal-success",
  bad: "text-signal-danger",
  neutral: "text-ink-subtle",
} as const;

/** Per-column beat/miss deltas rendered as a small colored sub-line under a
 *  stat's actual value. A column can map to more than one stat (QB Cmp/Att), so
 *  the deltas are shown side by side, separated by a slash. Only stats that
 *  carried a real projection that week (projected > 0) appear. */
function DeltaLine({
  col,
  actual,
  proj,
}: {
  col: StatCol;
  actual: StatLine;
  proj: StatLine | null;
}) {
  if (!proj || !col.deltas) return null;
  const parts = col.deltas.flatMap((m) => {
    const pv = proj[m.key];
    if (!(pv > 0)) return [];
    return [{ m, delta: actual[m.key] - pv }];
  });
  if (parts.length === 0) return null;
  // For a single-stat column the column header already names the stat, so the
  // aria-label stays terse; multi-stat columns (QB Cmp/Att) name each one.
  const multi = parts.length > 1;
  return (
    <span className="mt-0.5 flex items-center justify-end gap-1 font-mono text-[10px] tabular-nums">
      {parts.map(({ m, delta }, i) => {
        const tone = deltaTone(delta, m.digits, m.lowerIsBetter);
        return (
          <span key={m.key} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-ink-subtle">
                /
              </span>
            )}
            <span
              className={TONE_CLASS[tone]}
              aria-label={`${multi ? `${m.label} ` : ""}${fmtStatDelta(delta, m.digits)} versus projection`}
            >
              {fmtStatDelta(delta, m.digits)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function WeeklyStats({
  position,
  rowsBySeason,
  seasons,
  scoringLabel,
  beatRateBySeason,
  statAccuracyBySeason,
}: {
  position: string;
  rowsBySeason: Record<number, WeeklyGameRow[]>;
  seasons: number[];
  scoringLabel: string;
  /** Season-wide beat rate per season (missed weeks count as misses). */
  beatRateBySeason?: Record<number, BeatRate>;
  /** Per-stat season accuracy per season (targets, yards, TDs, ...). */
  statAccuracyBySeason?: Record<number, StatAccuracy[]>;
}) {
  const [season, setSeason] = useState<number>(seasons[0]);
  // Per-stat differentials are on by default so the feature is visible; a reader
  // who wants the plain stat line can collapse them without losing any column.
  const [compare, setCompare] = useState<boolean>(true);
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
  const statForSeason = statAccuracyBySeason?.[season] ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label
            htmlFor="weekly-season"
            className="text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            Season
          </label>
          <select
            id="weekly-season"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="min-h-[44px] rounded-card border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => setCompare((v) => !v)}
          aria-pressed={compare}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-card border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            compare
              ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
              : "border-line bg-surface text-ink-muted hover:text-ink"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${compare ? "bg-brand-cyan" : "bg-ink-subtle"}`}
          />
          Vs projection
        </button>
      </div>

      {compare && (
        <p className="mb-4 text-[11px] leading-relaxed text-ink-subtle">
          The small number under each stat is that week&apos;s result versus its projection:{" "}
          <span className="font-semibold text-signal-success">green</span> beat it,{" "}
          <span className="font-semibold text-signal-danger">red</span> came up short.
        </p>
      )}

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
          <AccuracyStatCards
            points={accuracyPoints}
            mode="historical"
            beatRate={beatRateBySeason?.[season] ?? null}
          />
          <StatAccuracyBreakdown
            stats={statForSeason}
            heading="Per-stat accuracy"
            caption={`How often each stat hit its weekly projection in ${season}, and the average gap.`}
          />
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
                <tr key={`${r.season}-${r.week}`} className="align-top hover:bg-surface">
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                  >
                    {r.week}
                  </th>
                  <td className="px-3 py-2 text-ink-muted">{r.opponent ?? "-"}</td>
                  {cols.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right">
                      <span className="block font-mono tabular-nums text-ink-muted">
                        {c.get(line)}
                      </span>
                      {compare && <DeltaLine col={c} actual={line} proj={r.proj_line} />}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                    {snap}
                  </td>
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
