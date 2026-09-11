"use client";

import { useId, useMemo, useState } from "react";
import type { StatLine, GameRow } from "@/components/player-profile/stat-shaping";
import {
  COMPARE_STATS,
  WEEKLY_STATS,
  STAT_GROUPS,
  bestIndices,
  allEmpty,
  type CompareStat,
  type PlayerStatsPayload,
} from "./stats-data";

/**
 * The "Stats" tab body: a statistical comparison across two to eight players.
 * Two sections, each with its own season picker: season totals (every
 * comparable stat, one row per stat, one column per player, with a Best
 * badge on each row's top cell) and a weekly breakdown (pick a stat and see
 * it week by week for every player). All computation is client-side off the
 * precomputed per-season payloads.
 */
export function StatsCompare({ players }: { players: PlayerStatsPayload[] }) {
  const allSeasons = useMemo(() => {
    const set = new Set<number>();
    players.forEach((p) => p.seasons.forEach((s) => set.add(s)));
    return Array.from(set).sort((x, y) => y - x);
  }, [players]);

  if (allSeasons.length === 0) {
    return (
      <div className="rounded-modal border border-line bg-surface/40 p-6 text-sm text-ink-muted">
        We don&apos;t have any statistical history on file for {listNames(players)} yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SeasonTotals players={players} allSeasons={allSeasons} />
      <WeeklyBreakdown players={players} allSeasons={allSeasons} />
    </div>
  );
}

/** "Alvin Kamara, Bijan Robinson or Josh Jacobs" for the empty state. */
function listNames(players: PlayerStatsPayload[]): string {
  const names = players.map((p) => p.name);
  if (names.length === 0) return "these players";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Season totals                                                       */
/* ------------------------------------------------------------------ */

function SeasonTotals({
  players,
  allSeasons,
}: {
  players: PlayerStatsPayload[];
  allSeasons: number[];
}) {
  const selectId = useId();
  const [season, setSeason] = useState(allSeasons[0]);

  const aggs = players.map((p) => p.seasonAggs.find((s) => s.season === season));
  const hasAnyAgg = aggs.some((a) => a);

  const valueFor = (
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
            Regular-season totals, side by side. Best marks the top number in each row.
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

      {!hasAnyAgg ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          None of these players has stats on file for {season}.
        </p>
      ) : (
        <div className="space-y-4">
          {STAT_GROUPS.map((group) => {
            const groupStats = COMPARE_STATS.filter((s) => s.group === group).filter((s) => {
              const values = aggs.map((a) => valueFor(a, s));
              return !allEmpty(values);
            });
            if (groupStats.length === 0) return null;
            return (
              <div key={group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                  {group}
                </p>
                <StatsTable
                  players={players}
                  rowHeaderLabel="Stat"
                  ariaLabel={`${group} season totals for ${season}, scrollable`}
                  rows={groupStats.map((s) => ({
                    key: s.key,
                    label: s.label,
                    better: s.better,
                    fmt: s.fmt,
                    values: aggs.map((a) => valueFor(a, s)),
                  }))}
                />
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
  players,
  allSeasons,
}: {
  players: PlayerStatsPayload[];
  allSeasons: number[];
}) {
  const seasonId = useId();
  const statId = useId();
  const [season, setSeason] = useState(allSeasons[0]);
  const [statKey, setStatKey] = useState<string>("total_yd");

  const stat = WEEKLY_STATS.find((s) => s.key === statKey) ?? WEEKLY_STATS[0];

  const weeks = useMemo(() => {
    const byPlayer = players.map((p) => {
      const rows = p.weeklyBySeason[season] ?? [];
      return new Map<number, GameRow>(rows.map((r) => [r.week, r]));
    });
    const weekSet = new Set<number>();
    byPlayer.forEach((m) => m.forEach((_row, week) => weekSet.add(week)));
    return Array.from(weekSet)
      .sort((x, y) => x - y)
      .map((week) => ({ week, rows: byPlayer.map((m) => m.get(week) ?? null) }));
  }, [players, season]);

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
            One stat, week by week, for every player.
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

      {weeks.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          No weekly stats on file for {season}.
        </p>
      ) : (
        <StatsTable
          players={players}
          rowHeaderLabel="Week"
          ariaLabel={`Weekly ${stat.label.toLowerCase()} for ${season}, scrollable`}
          rows={weeks.map(({ week, rows }) => ({
            key: String(week),
            label: `Wk ${week}`,
            better: stat.better,
            fmt: stat.fmt,
            values: rows.map((r) => (r ? stat.compute(r, 1) : null)),
            sub: rows.map((r) => (r?.opponent ? `vs ${r.opponent}` : undefined)),
          }))}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared N-column table                                              */
/* ------------------------------------------------------------------ */

type StatsTableRow = {
  key: string;
  label: string;
  better: "high" | "low";
  fmt: (n: number) => string;
  values: Array<number | null>;
  sub?: Array<string | undefined>;
};

/**
 * A real <table>: the stat (or week) as the row header, one column per
 * player, and a text "Best" badge on the top cell of each row (every tied
 * cell badged, a missing value never badged). Wide past a handful of
 * players, so it sits in its own horizontal scroll region with tabIndex 0
 * and an accessible name, the same pattern components/league-war/
 * war-player-table.tsx uses: on a phone the table keeps its natural width
 * and the wrapper scrolls, so every column stays reachable instead of being
 * hidden or squeezed.
 */
function StatsTable({
  players,
  rows,
  ariaLabel,
  rowHeaderLabel,
}: {
  players: PlayerStatsPayload[];
  rows: StatsTableRow[];
  ariaLabel: string;
  rowHeaderLabel: string;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      className="overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <table className="w-max min-w-full border-collapse text-sm sm:w-full">
        <caption className="sr-only">{ariaLabel}</caption>
        <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              {rowHeaderLabel}
            </th>
            {players.map((p) => (
              <th
                key={p.name}
                scope="col"
                className="max-w-[10rem] truncate px-3 py-2 text-right font-semibold text-ink"
                title={p.name}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {rows.map((row) => {
            const best = bestIndices(row.values, row.better);
            return (
              <tr key={row.key}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                  {row.label}
                </th>
                {row.values.map((v, i) => (
                  <td key={players[i]?.name ?? i} className="px-3 py-2 text-right align-top">
                    <ValueCell
                      text={v == null ? "-" : row.fmt(v)}
                      sub={row.sub?.[i]}
                      isBest={best.has(i)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ValueCell({
  text,
  sub,
  isBest,
}: {
  text: string;
  sub?: string;
  isBest: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <p
        className={`font-mono text-[15px] font-semibold tabular-nums ${
          isBest ? "text-brand-cyan" : "text-ink"
        }`}
      >
        {text}
      </p>
      {isBest && (
        <span className="rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
          Best
        </span>
      )}
      {sub && <p className="text-[10px] text-ink-subtle">{sub}</p>}
    </div>
  );
}
