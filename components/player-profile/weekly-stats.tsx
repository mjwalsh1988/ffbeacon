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
import { weekRowState } from "@/lib/game-day";
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

/**
 * The marker on a row whose game is being played today.
 *
 * TWO PULSING DOTS AND A WORD, and the word is the part that matters. The dots
 * are `aria-hidden` decoration; "Today" is real text, so a reader who cannot
 * see the animation still learns why that row is empty. Colour is not carrying
 * it either.
 *
 * `motion-safe:` on the animation rather than `motion-reduce:animate-none`, so
 * the default for a reader who has asked for less motion is no animation at
 * all rather than an animation that is then switched off. The dot still
 * renders; it simply does not move.
 *
 * It says "Today" rather than "Live" on purpose. We do not poll a live feed:
 * what we actually know is that the game is on today's Eastern date and no
 * stat line has landed. "Live" would claim the ball is in the air, which this
 * page cannot see, and would still be on screen at midnight.
 */
function LiveMarker() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-cyan">
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-brand-cyan opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-cyan" />
      </span>
      Today
      <span className="sr-only">, this game is being played today and no stats have come in yet</span>
    </span>
  );
}

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

            {/* The rest of the season. A row per week with no stat line yet:
                the opponent, dashes for every figure, and a live marker when
                the game is being played today. A missing week is not a bye and
                should not read as one, which is what an absent row did. */}
            {pending.map((p) => {
              const state = weekRowState({
                hasStats: false,
                kickoffAt: p.kickoffAt,
                now,
              });
              const live = state === "in-progress";
              return (
                <tr
                  key={`pending-${season}-${p.week}`}
                  className={`align-top ${live ? "bg-brand-cyan/[0.04]" : ""}`}
                >
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink-subtle"
                  >
                    {p.week}
                  </th>
                  <td className="px-3 py-2 text-ink-subtle">
                    <span className="flex items-center gap-1.5">
                      {p.opponent ?? "-"}
                      {live && <LiveMarker />}
                      {!live && (
                        <span className="sr-only">, not played yet</span>
                      )}
                    </span>
                  </td>
                  {/* One dash per column. `colSpan` would be shorter and would
                      break the column alignment a reader navigating the table
                      by cell depends on. */}
                  {cols.map((c) => (
                    <td
                      key={c.label}
                      className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle"
                    >
                      -
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    -
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    -
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    -
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    -
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
