"use client";

import { useId, useMemo, useState } from "react";
import type { StatLine, GameRow } from "@/components/player-profile/stat-shaping";
import {
  COMPARE_STATS,
  WEEKLY_STATS,
  STAT_GROUPS,
  statEdge,
  bothEmpty,
  type CompareStat,
  type PlayerStatsPayload,
} from "./stats-data";

/**
 * The "Stats" tab body: a head-to-head statistical comparison of the two
 * players. Two sections, each with its own season picker: season totals (every
 * comparable stat, A vs B, with an edge on each row) and a weekly breakdown
 * (pick a stat and see it week by week for both players). All computation is
 * client-side off the precomputed per-season payloads.
 */
export function StatsCompare({
  a,
  b,
}: {
  a: PlayerStatsPayload;
  b: PlayerStatsPayload;
}) {
  const allSeasons = useMemo(() => {
    const set = new Set<number>([...a.seasons, ...b.seasons]);
    return Array.from(set).sort((x, y) => y - x);
  }, [a.seasons, b.seasons]);

  if (allSeasons.length === 0) {
    return (
      <div className="rounded-modal border border-line bg-surface/40 p-6 text-sm text-ink-muted">
        We don&apos;t have any statistical history on file for {a.name} or {b.name} yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SeasonTotals a={a} b={b} allSeasons={allSeasons} />
      <WeeklyBreakdown a={a} b={b} allSeasons={allSeasons} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Season totals                                                       */
/* ------------------------------------------------------------------ */

function SeasonTotals({
  a,
  b,
  allSeasons,
}: {
  a: PlayerStatsPayload;
  b: PlayerStatsPayload;
  allSeasons: number[];
}) {
  const selectId = useId();
  const [season, setSeason] = useState(allSeasons[0]);

  const aggA = a.seasonAggs.find((s) => s.season === season);
  const aggB = b.seasonAggs.find((s) => s.season === season);

  const value = (
    agg: { line: StatLine; games: number } | undefined,
    stat: CompareStat,
  ): number | null => (agg ? stat.compute(agg.line, agg.games) : null);

  return (
    <section
      aria-labelledby="season-totals-heading"
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            id="season-totals-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Season totals
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            Regular-season totals, head to head. Edge marks the better number.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <span id={selectId}>Season</span>
          <select
            aria-labelledby={selectId}
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="rounded-card border border-line bg-base px-3 py-1.5 text-sm font-medium text-ink focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
          >
            {allSeasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ColumnHeader aName={a.name} bName={b.name} />

      {!aggA && !aggB ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          Neither player has stats on file for {season}.
        </p>
      ) : (
        <div className="mt-1 space-y-4">
          {STAT_GROUPS.map((group) => {
            const rows = COMPARE_STATS.filter((s) => s.group === group).filter((s) => {
              const av = value(aggA, s);
              const bv = value(aggB, s);
              return !bothEmpty(av, bv);
            });
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                  {group}
                </p>
                <div className="divide-y divide-line/50">
                  {rows.map((s) => {
                    const av = value(aggA, s);
                    const bv = value(aggB, s);
                    return (
                      <StatRow
                        key={s.key}
                        label={s.label}
                        aText={av == null ? "-" : s.fmt(av)}
                        bText={bv == null ? "-" : s.fmt(bv)}
                        winner={statEdge(av, bv, s.better)}
                        aName={a.name}
                        bName={b.name}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Weekly breakdown                                                    */
/* ------------------------------------------------------------------ */

function WeeklyBreakdown({
  a,
  b,
  allSeasons,
}: {
  a: PlayerStatsPayload;
  b: PlayerStatsPayload;
  allSeasons: number[];
}) {
  const seasonId = useId();
  const statId = useId();
  const [season, setSeason] = useState(allSeasons[0]);
  const [statKey, setStatKey] = useState<string>("total_yd");

  const stat = WEEKLY_STATS.find((s) => s.key === statKey) ?? WEEKLY_STATS[0];

  const weeks = useMemo(() => {
    const rowsA = a.weeklyBySeason[season] ?? [];
    const rowsB = b.weeklyBySeason[season] ?? [];
    const mapA = new Map<number, GameRow>(rowsA.map((r) => [r.week, r]));
    const mapB = new Map<number, GameRow>(rowsB.map((r) => [r.week, r]));
    const weekSet = new Set<number>([...mapA.keys(), ...mapB.keys()]);
    return Array.from(weekSet)
      .sort((x, y) => x - y)
      .map((week) => ({ week, ra: mapA.get(week) ?? null, rb: mapB.get(week) ?? null }));
  }, [a.weeklyBySeason, b.weeklyBySeason, season]);

  return (
    <section
      aria-labelledby="weekly-heading"
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="weekly-heading" className="text-lg font-semibold tracking-tight text-ink">
            Weekly breakdown
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            One stat, week by week, for both players.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span id={statId}>Stat</span>
            <select
              aria-labelledby={statId}
              value={statKey}
              onChange={(e) => setStatKey(e.target.value)}
              className="rounded-card border border-line bg-base px-3 py-1.5 text-sm font-medium text-ink focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
            >
              {WEEKLY_STATS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span id={seasonId}>Season</span>
            <select
              aria-labelledby={seasonId}
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="rounded-card border border-line bg-base px-3 py-1.5 text-sm font-medium text-ink focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
            >
              {allSeasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <ColumnHeader aName={a.name} bName={b.name} centerLabel="Week" />

      {weeks.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          No weekly stats on file for {season}.
        </p>
      ) : (
        <div className="mt-1 divide-y divide-line/50">
          {weeks.map(({ week, ra, rb }) => {
            const av = ra ? stat.compute(ra, 1) : null;
            const bv = rb ? stat.compute(rb, 1) : null;
            return (
              <StatRow
                key={week}
                label={`Wk ${week}`}
                aText={av == null ? "-" : stat.fmt(av)}
                bText={bv == null ? "-" : stat.fmt(bv)}
                aSub={ra?.opponent ? `vs ${ra.opponent}` : undefined}
                bSub={rb?.opponent ? `vs ${rb.opponent}` : undefined}
                winner={statEdge(av, bv, stat.better)}
                aName={a.name}
                bName={b.name}
                monoLabel
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared row + header                                                 */
/* ------------------------------------------------------------------ */

function ColumnHeader({
  aName,
  bName,
  centerLabel = "Stat",
}: {
  aName: string;
  bName: string;
  centerLabel?: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line pb-2 sm:gap-3">
      <p className="truncate text-right text-sm font-semibold text-brand-purple">{aName}</p>
      <p className="min-w-[5rem] text-center text-[11px] font-semibold uppercase tracking-wide text-ink-subtle sm:min-w-[8rem]">
        {centerLabel}
      </p>
      <p className="truncate text-left text-sm font-semibold text-brand-cyan">{bName}</p>
    </div>
  );
}

function StatRow({
  label,
  aText,
  bText,
  aSub,
  bSub,
  winner,
  aName,
  bName,
  monoLabel = false,
}: {
  label: string;
  aText: string;
  bText: string;
  aSub?: string;
  bSub?: string;
  winner: "a" | "b" | "even" | "na";
  aName: string;
  bName: string;
  monoLabel?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 sm:gap-3">
      <ValueCell
        side="a"
        text={aText}
        sub={aSub}
        isWinner={winner === "a"}
        playerName={aName}
      />
      <p
        className={`min-w-[5rem] text-center text-xs text-ink-muted sm:min-w-[8rem] ${
          monoLabel ? "font-mono tabular-nums" : ""
        }`}
      >
        {label}
      </p>
      <ValueCell
        side="b"
        text={bText}
        sub={bSub}
        isWinner={winner === "b"}
        playerName={bName}
      />
    </div>
  );
}

function ValueCell({
  side,
  text,
  sub,
  isWinner,
  playerName,
}: {
  side: "a" | "b";
  text: string;
  sub?: string;
  isWinner: boolean;
  playerName: string;
}) {
  const align = side === "a" ? "text-right" : "text-left";
  const winnerClass = isWinner
    ? side === "a"
      ? "text-brand-purple"
      : "text-brand-cyan"
    : "text-ink";
  return (
    <div className={align}>
      <p className={`font-mono text-[15px] font-semibold tabular-nums ${winnerClass}`}>
        {isWinner && (
          <>
            <span aria-hidden="true">◆ </span>
            <span className="sr-only">Edge to {playerName}, </span>
          </>
        )}
        {text}
      </p>
      {sub && <p className="text-[10px] text-ink-subtle">{sub}</p>}
    </div>
  );
}
