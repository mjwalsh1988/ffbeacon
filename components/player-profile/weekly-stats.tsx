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
  type PendingWeekRow,
} from "@/components/player-profile/stat-shaping";
import { GameLogTable } from "@/components/player-profile/game-log-table";
import { ProjectionActualChart } from "@/components/player-profile/projection-actual-chart";
import { AccuracyStatCards } from "@/components/player-profile/accuracy-stat-cards";
import { StatAccuracyBreakdown } from "@/components/player-profile/stat-accuracy-breakdown";

export function WeeklyStats({
  position,
  rowsBySeason,
  pendingBySeason,
  nowIso,
  seasons,
  scoringLabel,
  beatRateBySeason,
  statAccuracyBySeason,
}: {
  position: string;
  rowsBySeason: Record<number, WeeklyGameRow[]>;
  /**
   * Weeks with no stat line yet, by season. In practice only the current one
   * has any: a finished season has a row for every game its team played, and a
   * week it does not have is a bye rather than a gap.
   */
  pendingBySeason?: Record<number, PendingWeekRow[]>;
  /** Server render time, so "is the game today" is not read off the client clock. */
  nowIso?: string;
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

  /**
   * The weeks still to come, merged in so the table is the whole season.
   *
   * THE CLOCK COMES FROM THE SERVER. `nowIso` is stamped during the render, not
   * read from `Date.now()` here. This is a client component inside a server
   * render, so reading the browser clock would make the first paint disagree
   * with the HTML and React would patch it: a reader on a machine whose clock
   * is a day out would see a spinner appear after hydration on a game that
   * finished yesterday. Falling back to the client clock is only for a caller
   * that passes nothing, and no caller does.
   */
  const now = nowIso ? new Date(nowIso) : new Date();
  const pending = (pendingBySeason?.[season] ?? [])
    .filter((p) => !rows.some((r) => r.week === p.week))
    .slice()
    .sort((a, b) => a.week - b.week);

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

      <GameLogTable
        position={position}
        season={season}
        rows={rows}
        pending={pending}
        scoringLabel={scoringLabel}
        compare={compare}
        nowIso={nowIso}
      />
    </div>
  );
}
