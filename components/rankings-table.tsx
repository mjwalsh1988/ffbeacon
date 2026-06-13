"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BottomSheet } from "@/components/bottom-sheet";

export type RankingsRow = {
  overall_rank: number;
  position_rank: number;
  tier: number | null;
  slug: string;
  /** Sleeper player id from players.external_ids.sleeper. Drives the
   * small headshot circle next to the player name. */
  sleeper_id: string | null;
  name: string;
  position: string;
  team: string | null;
  status: string;
  value: number | null;
  change_7d: number | null;
  change_7d_pct: number | null;
  trend_7d: string | null;
  rank_change_7d: number | null;
  rank_7d_ago: number | null;
  /** Per-window bookend gate from player_value_trends. True when the source has
   *  a data point near both ends of the 7-day window. Replaces the old
   *  data_points_30d >= 7 count gate. */
  show_trend_7d: boolean;
  /** Resolved source cadence (same for every row in one table). Drives the
   *  "updated weekly" note so a weekly trend is not misread as daily-fresh. */
  cadence?: "daily" | "weekly";
};

type SortKey =
  | "overall_rank"
  | "position_rank"
  | "name"
  | "position"
  | "team"
  | "tier"
  | "value"
  | "change_7d"
  | "rank_change_7d";
type SortDir = "asc" | "desc";

// The 7-day trend display is gated by row.show_trend_7d (computed in
// calculate-trends.ts via the cadence-aware bookend rule): show movement only
// when the source has a data point near both ends of the 7-day window.

// Desktop columns. Mobile renders a different layout (Rank, Player, dynamic
// metric column driven by the active sort chip) so it does not consume this
// list — see MOBILE_SORT_OPTIONS below.
const COLUMNS: Array<{
  key: SortKey;
  label: string;
  numeric: boolean;
}> = [
  { key: "overall_rank", label: "Rank", numeric: true },
  { key: "name", label: "Player", numeric: false },
  { key: "team", label: "Team", numeric: false },
  { key: "position", label: "Pos", numeric: false },
  { key: "position_rank", label: "Pos rank", numeric: true },
  { key: "tier", label: "Tier", numeric: true },
  { key: "value", label: "Value", numeric: true },
  { key: "rank_change_7d", label: "Rank 7d", numeric: true },
  { key: "change_7d", label: "Value 7d", numeric: true },
];

// Mobile sort chip row. Each chip both selects the sort key AND determines
// which metric the dynamic third column on mobile renders. Tap the active
// chip again to flip the sort direction; tap an inactive chip to switch
// metrics (resets direction to the chip's natural default — Rank low→high,
// values/trends high→low).
const MOBILE_SORT_OPTIONS: Array<{
  key: SortKey;
  label: string;
  short: string;
  defaultDir: SortDir;
}> = [
  { key: "overall_rank", label: "Rank", short: "Rank", defaultDir: "asc" },
  { key: "value", label: "Value", short: "Value", defaultDir: "desc" },
  { key: "tier", label: "Tier", short: "Tier", defaultDir: "asc" },
  { key: "position_rank", label: "Pos rank", short: "Pos #", defaultDir: "asc" },
  { key: "rank_change_7d", label: "Rank 7d", short: "Rank 7d", defaultDir: "desc" },
  { key: "change_7d", label: "Value 7d", short: "Val 7d", defaultDir: "desc" },
];

export function RankingsTable({ rows }: { rows: RankingsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("overall_rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openRow, setOpenRow] = useState<RankingsRow | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Mobile chip-row sort handler. Tapping the active chip flips direction;
  // tapping an inactive chip switches the active metric and resets to that
  // chip's natural default direction (Rank ascending, values/trends
  // descending — the "best first" intent for each metric).
  const handleMobileSort = (key: SortKey, defaultDir: SortDir) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  return (
    <>
      {/* Mobile-only sort chip row. Each chip flips both the sort AND the
          dynamic third column on the table below, so users always see the
          metric they're sorting by. */}
      <div className="mb-3 rounded-card border border-line bg-surface p-3 md:hidden">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
          Sort by
        </p>
        <div
          role="radiogroup"
          aria-label="Sort rankings by"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {MOBILE_SORT_OPTIONS.map((opt) => {
            const isActive = opt.key === sortKey;
            return (
              <button
                key={`${opt.key}-${opt.label}`}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handleMobileSort(opt.key, opt.defaultDir)}
                className={`inline-flex min-h-11 flex-shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-brand-purple bg-brand-purple/15 text-ink"
                    : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
                aria-label={
                  isActive
                    ? `Sort by ${opt.label}, currently ${sortDir === "asc" ? "ascending" : "descending"}. Tap to flip direction.`
                    : `Sort by ${opt.label}. Tap to activate.`
                }
              >
                <span>{opt.short}</span>
                {isActive && (
                  <span aria-hidden="true">
                    {sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Player rankings. Sortable by rank, name, team, position, tier, value, 7-day rank
            movement, and 7-day value change. On mobile, tap a player row for full
            details.
          </caption>
          {/* Desktop header. Hidden on mobile because the chip row above and the
              compact 3-column body handle sort + columns differently. */}
          <thead className="hidden bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle md:table-header-group">
            <tr>
              {COLUMNS.map((col, idx) => {
                const isActive = col.key === sortKey;
                const isFirst = idx === 0;
                const isLast = idx === COLUMNS.length - 1;
                const sortAttr: "ascending" | "descending" | "none" = isActive
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
                // Player is the only column that anchors left; everything
                // numeric reads better centered now that the rank column
                // owns the leftmost slot.
                const align = col.numeric
                  ? "text-center"
                  : col.key === "name"
                    ? "text-left"
                    : "text-center";
                const sidePad = isFirst ? "pl-4" : isLast ? "pr-4" : "";
                const widthHint = col.key === "overall_rank" ? "w-16" : "";
                return (
                  <th
                    key={`${col.key}-${idx}`}
                    scope="col"
                    aria-sort={sortAttr}
                    className={`px-3 py-3 ${align} ${sidePad} ${widthHint}`.trim()}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={`inline-flex min-h-[44px] items-center gap-1 hover:text-ink ${
                        col.numeric ? "justify-center" : ""
                      }`}
                    >
                      <span>{col.label}</span>
                      {isActive ? (
                        <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                      ) : (
                        <span aria-hidden="true" className="text-ink-subtle">
                          ⇅
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Mobile header (Rank, Player, dynamic metric). Renders only at
              <md and reflects the active mobile sort chip in the third cell. */}
          <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle md:hidden">
            <tr>
              <th scope="col" className="w-14 py-3 pl-4 pr-2 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Player
              </th>
              <th scope="col" className="py-3 pl-2 pr-4 text-center">
                {mobileMetricLabel(sortKey)}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.slug} className="hover:bg-surface">
                <td className="w-14 py-3 pl-4 pr-2 text-center font-mono tabular-nums text-ink-muted md:w-16 md:px-3">
                  {row.overall_rank}
                </td>
                <td className="px-3 py-3 text-left">
                  {/* Mobile: tap-to-open sheet. Desktop: link to full player profile. */}
                  <button
                    type="button"
                    onClick={() => setOpenRow(row)}
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${row.name}`}
                    className="flex w-full items-center gap-2.5 text-left md:hidden"
                  >
                    <PlayerHeadshot
                      sleeperId={row.sleeper_id}
                      position={row.position}
                      name={row.name}
                      size={32}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {row.name}
                      </span>
                      {row.status !== "active" && (
                        <span
                          className="mt-0.5 inline-flex rounded bg-signal-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-signal-warning"
                          aria-label={`Injury status: ${row.status}`}
                        >
                          {row.status}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="hidden items-center gap-2.5 md:flex">
                    <PlayerHeadshot
                      sleeperId={row.sleeper_id}
                      position={row.position}
                      name={row.name}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/players/${row.slug}`}
                        className="font-medium text-ink hover:text-brand-purple"
                      >
                        {row.name}
                      </Link>
                      {row.status !== "active" && (
                        <span
                          className="ml-2 rounded bg-signal-warning/15 px-1.5 py-0.5 text-xs uppercase text-signal-warning"
                          aria-label={`Injury status: ${row.status}`}
                        >
                          {row.status}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Mobile dynamic metric cell — renders only at <md. */}
                <td className="py-3 pl-2 pr-4 text-center font-mono tabular-nums md:hidden">
                  <MobileMetricCell row={row} sortKey={sortKey} />
                </td>

                {/* Desktop-only cells. */}
                <td className="hidden px-3 py-3 text-center text-ink-muted md:table-cell">
                  {row.team ?? "—"}
                </td>
                <td className="hidden px-3 py-3 text-center md:table-cell">
                  <span className="font-mono text-xs text-brand-cyan">{row.position}</span>
                </td>
                <td className="hidden px-3 py-3 text-center font-mono tabular-nums text-ink-muted md:table-cell">
                  {row.position}
                  {row.position_rank}
                </td>
                <td className="hidden px-3 py-3 text-center md:table-cell">
                  {row.tier ? (
                    <span className="inline-flex rounded bg-surface-elevated px-2 py-0.5 text-xs">
                      T{row.tier}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-3 text-center font-mono tabular-nums md:table-cell">
                  {row.value !== null ? row.value.toLocaleString() : "—"}
                </td>
                <td className="hidden px-3 py-3 text-center font-mono tabular-nums md:table-cell">
                  <span className="inline-flex justify-center">
                    <RankTrendCell row={row} />
                  </span>
                </td>
                <td className="hidden py-3 pl-3 pr-4 text-center font-mono tabular-nums md:table-cell">
                  <span className="inline-flex justify-center">
                    <ValueTrendCell row={row} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PlayerDetailSheet
        row={openRow}
        onClose={() => setOpenRow(null)}
      />
    </>
  );
}

function mobileMetricLabel(sortKey: SortKey): string {
  const opt = MOBILE_SORT_OPTIONS.find((o) => o.key === sortKey);
  // When the active sort is one of the "name"-style sort keys that don't
  // have a mobile chip (e.g. desktop sorted by team/name then user came to
  // mobile), default the third column to Value to preserve the user's
  // explicit "default = Value" instruction.
  return opt?.label ?? "Value";
}

function MobileMetricCell({
  row,
  sortKey,
}: {
  row: RankingsRow;
  sortKey: SortKey;
}) {
  switch (sortKey) {
    case "tier":
      return row.tier !== null ? (
        <span className="inline-flex rounded bg-surface-elevated px-2 py-0.5 text-xs">
          T{row.tier}
        </span>
      ) : (
        <span className="text-ink-subtle">—</span>
      );
    case "position_rank":
      return (
        <span className="text-ink">
          {row.position}
          {row.position_rank}
        </span>
      );
    case "rank_change_7d":
      return <RankTrendCell row={row} />;
    case "change_7d":
      return <ValueTrendCell row={row} />;
    case "value":
    case "overall_rank":
    default:
      return (
        <span>{row.value !== null ? row.value.toLocaleString() : "—"}</span>
      );
  }
}

/**
 * Mobile bottom-sheet that surfaces every column from the desktop table
 * (team, position, tier, value, 7-day rank movement, 7-day value movement)
 * plus a CTA to the full player profile. Satisfies the mobile-first rule:
 * data hidden from the mobile table is still reachable via this sheet.
 */
function PlayerDetailSheet({
  row,
  onClose,
}: {
  row: RankingsRow | null;
  onClose: () => void;
}) {
  const open = row !== null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label={row ? `${row.name} details` : "Player details"}
    >
      {row && (
        <>
          <header className="flex items-start gap-3 px-5 pt-4">
            <PlayerHeadshot
              sleeperId={row.sleeper_id}
              position={row.position}
              name={row.name}
              size={56}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                {row.name}
              </h2>
              <p className="truncate text-xs text-ink-subtle">
                {row.position}
                {row.team ? ` · ${row.team}` : ""}
                {row.position_rank ? ` · ${row.position}#${row.position_rank}` : ""}
              </p>
              {row.status !== "active" && (
                <span
                  className="mt-1 inline-flex rounded bg-signal-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-signal-warning"
                  aria-label={`Injury status: ${row.status}`}
                >
                  {row.status}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player details"
              className="-mr-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </header>

          <section
            aria-label="Player metrics"
            className="grid grid-cols-2 gap-2 px-5 pt-5"
          >
            <MetricTile label="Overall rank" value={`#${row.overall_rank}`} />
            <MetricTile
              label={`${row.position} rank`}
              value={`#${row.position_rank}`}
            />
            <MetricTile
              label="Tier"
              value={row.tier !== null ? `T${row.tier}` : "—"}
            />
            <MetricTile
              label="Value"
              value={row.value !== null ? row.value.toLocaleString() : "—"}
            />
            <MetricTile
              label="Rank 7d"
              value={<RankTrendCell row={row} />}
            />
            <MetricTile
              label="Value 7d"
              value={<ValueTrendCell row={row} />}
            />
          </section>

          <div className="mt-5 flex flex-col gap-2 px-5">
            <Link
              href={`/players/${row.slug}`}
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              View full profile →
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink"
            >
              Close
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-base/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

// Plain-language verb the screen reader uses for rank movement.
function rankMovementVerb(change: number): string {
  if (change > 0) return `Moved up ${change} position${change === 1 ? "" : "s"} in the last 7 days`;
  if (change < 0)
    return `Moved down ${Math.abs(change)} position${change === -1 ? "" : "s"} in the last 7 days`;
  return "No rank change in the last 7 days";
}

function valueMovementVerb(pct: number): string {
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return `Value increased ${abs} percent in the last 7 days`;
  if (pct < 0) return `Value decreased ${abs} percent in the last 7 days`;
  return "No value change in the last 7 days";
}

function RankTrendCell({ row }: { row: RankingsRow }) {
  if (!row.show_trend_7d || row.rank_change_7d === null) {
    return (
      <span className="text-ink-subtle" aria-label="Insufficient history for 7-day rank movement">
        —
      </span>
    );
  }
  const weekly = row.cadence === "weekly" ? ", updated weekly" : "";
  const title = row.cadence === "weekly" ? "Updated weekly" : undefined;
  const change = row.rank_change_7d;
  if (change === 0) {
    return (
      <span className="text-ink-muted" aria-label={`No rank change in the last 7 days${weekly}`} title={title}>
        –
      </span>
    );
  }
  const isUp = change > 0;
  const tone = isUp ? "text-signal-positive" : "text-signal-warning";
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 ${tone}`}
      aria-label={`${rankMovementVerb(change)}${weekly}`}
      title={title}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span aria-hidden="true">{Math.abs(change)}</span>
    </span>
  );
}

function ValueTrendCell({ row }: { row: RankingsRow }) {
  if (!row.show_trend_7d || row.change_7d_pct === null || row.trend_7d === null) {
    return (
      <span className="text-ink-subtle" aria-label="Insufficient history for 7-day value trend">
        —
      </span>
    );
  }
  const weekly = row.cadence === "weekly" ? ", updated weekly" : "";
  const title = row.cadence === "weekly" ? "Updated weekly" : undefined;
  const pct = row.change_7d_pct;
  if (row.trend_7d === "stable" || pct === 0) {
    // "Stable" can include a small non-zero pct (within the ±2% trend
    // threshold). Visible text + aria-label both reflect the actual number
    // so screen-reader users hear what sighted users see.
    const pctText = pct === 0 ? "0.0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    return (
      <span
        className="text-ink-muted"
        aria-label={
          pct === 0
            ? `No value change in the last 7 days${weekly}`
            : `Value held roughly steady in the last 7 days, ${valueMovementVerb(pct).toLowerCase().replace(/^value /, "")}${weekly}`
        }
        title={title}
      >
        {pctText}
      </span>
    );
  }
  const isUp = pct > 0;
  const tone = isUp ? "text-signal-positive" : "text-signal-warning";
  const Icon = isUp ? ArrowUp : ArrowDown;
  const pctText = `${isUp ? "+" : ""}${pct.toFixed(1)}%`;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 ${tone}`}
      aria-label={`${valueMovementVerb(pct)}${weekly}`}
      title={title}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span aria-hidden="true">{pctText}</span>
    </span>
  );
}
