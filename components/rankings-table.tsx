"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";

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
  data_points_30d: number;
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

// Rows with fewer than this many history points hide the 7-day trend display
// (per CLAUDE.md "Pre-calculated tables" rule — sparse data shouldn't be shown).
const TREND_MIN_DATA_POINTS = 7;

const COLUMNS: Array<{
  key: SortKey;
  label: string;
  numeric: boolean;
  // Mobile column is the merged "Trend" stack cell that holds both rank and
  // value movement vertically. On desktop the rank + value trends split into
  // two sortable columns; sorting on either one is preserved on mobile by
  // making the merged header a button that cycles both columns' sort state.
  mobileOnly?: boolean;
  desktopOnly?: boolean;
}> = [
  { key: "overall_rank", label: "Rank", numeric: true },
  { key: "name", label: "Player", numeric: false },
  { key: "team", label: "Team", numeric: false, desktopOnly: true },
  { key: "position", label: "Pos", numeric: false, desktopOnly: true },
  { key: "position_rank", label: "Pos rank", numeric: true, desktopOnly: true },
  { key: "tier", label: "Tier", numeric: true, desktopOnly: true },
  { key: "value", label: "Value", numeric: true },
  { key: "rank_change_7d", label: "Rank 7d", numeric: true, desktopOnly: true },
  { key: "change_7d", label: "Value 7d", numeric: true, desktopOnly: true },
  // Mobile-only merged header. The button toggles between sorting by
  // rank_change_7d and change_7d on each press so both metrics remain
  // sortable when the columns are stacked.
  { key: "rank_change_7d", label: "Trend 7d", numeric: true, mobileOnly: true },
];

export function RankingsTable({ rows }: { rows: RankingsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("overall_rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  // For the mobile merged "Trend 7d" column we want a tap to cycle through:
  // rank-desc → rank-asc → value-desc → value-asc → ... so a single thumb-tap
  // can reach both metrics. Desktop users get two separate column headers
  // and don't see this control.
  const cycleMobileTrend = () => {
    if (sortKey === "rank_change_7d" && sortDir === "desc") {
      setSortDir("asc");
    } else if (sortKey === "rank_change_7d" && sortDir === "asc") {
      setSortKey("change_7d");
      setSortDir("desc");
    } else if (sortKey === "change_7d" && sortDir === "desc") {
      setSortDir("asc");
    } else if (sortKey === "change_7d" && sortDir === "asc") {
      setSortKey("rank_change_7d");
      setSortDir("desc");
    } else {
      setSortKey("rank_change_7d");
      setSortDir("desc");
    }
  };

  const mobileTrendLabel = (() => {
    if (sortKey === "rank_change_7d") return `Trend 7d (by rank, ${sortDir === "asc" ? "low→high" : "high→low"}). Activate to flip direction or move to value sort.`;
    if (sortKey === "change_7d") return `Trend 7d (by value, ${sortDir === "asc" ? "low→high" : "high→low"}). Activate to flip direction or move to rank sort.`;
    return "Trend 7d, not currently sorted. Activate to sort by rank movement, highest gain first.";
  })();

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Player rankings. Sortable by rank, name, team, position, tier, value, 7-day rank
          movement, and 7-day value change.
        </caption>
        <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            {COLUMNS.map((col, idx) => {
              const isActive = col.key === sortKey;
              const isTrendStack = col.mobileOnly && col.label === "Trend 7d";
              const isStackParticipant =
                isTrendStack &&
                (sortKey === "rank_change_7d" || sortKey === "change_7d");
              const visibility = col.mobileOnly
                ? "sm:hidden"
                : col.desktopOnly
                  ? "hidden sm:table-cell"
                  : "";
              const sortAttr: "ascending" | "descending" | "none" = isTrendStack
                ? isStackParticipant
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
                : isActive
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
              return (
                <th
                  key={`${col.key}-${idx}-${col.mobileOnly ? "m" : "d"}`}
                  scope="col"
                  aria-sort={sortAttr}
                  className={`${col.numeric ? "px-3 py-3 text-right" : "px-3 py-3"} ${visibility}`}
                >
                  <button
                    type="button"
                    onClick={() => (isTrendStack ? cycleMobileTrend() : toggle(col.key))}
                    // 44px min height per WCAG 2.5.5. The header rows are
                    // dense on mobile; without min-h the button hit area
                    // collapses to ~38-40px.
                    className="inline-flex min-h-[44px] items-center gap-1 hover:text-ink"
                    aria-label={isTrendStack ? mobileTrendLabel : undefined}
                  >
                    <span>{col.label}</span>
                    {(isTrendStack ? isStackParticipant : isActive) ? (
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
        <tbody className="divide-y divide-line">
          {sorted.map((row) => (
            <tr key={row.slug} className="hover:bg-surface">
              <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">
                {row.overall_rank}
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2.5">
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
                    {/* Mobile-only compact context line: surfaces team / pos / pos-rank
                        that the desktop layout shows in dedicated columns. Keeps the
                        same data accessible on mobile per CLAUDE.md mobile-first rule. */}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-subtle sm:hidden">
                      <span className="font-mono text-brand-cyan">
                        {row.position}
                        {row.position_rank}
                      </span>
                      {row.team && <span>{row.team}</span>}
                      {row.tier !== null && <span>T{row.tier}</span>}
                    </span>
                  </div>
                </div>
              </td>
              <td className="hidden px-3 py-3 text-ink-muted sm:table-cell">{row.team ?? "—"}</td>
              <td className="hidden px-3 py-3 sm:table-cell">
                <span className="font-mono text-xs text-brand-cyan">{row.position}</span>
              </td>
              <td className="hidden px-3 py-3 text-right font-mono tabular-nums text-ink-muted sm:table-cell">
                {row.position}
                {row.position_rank}
              </td>
              <td className="hidden px-3 py-3 text-right sm:table-cell">
                {row.tier ? (
                  <span className="inline-flex rounded bg-surface-elevated px-2 py-0.5 text-xs">
                    T{row.tier}
                  </span>
                ) : (
                  <span className="text-ink-subtle">—</span>
                )}
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {row.value !== null ? row.value.toLocaleString() : "—"}
              </td>
              {/* Desktop: two separate trend columns. */}
              <td className="hidden px-3 py-3 text-right font-mono tabular-nums sm:table-cell">
                <RankTrendCell row={row} />
              </td>
              <td className="hidden px-3 py-3 text-right font-mono tabular-nums sm:table-cell">
                <ValueTrendCell row={row} />
              </td>
              {/* Mobile: stacked merged cell. Both metrics still visible. */}
              <td className="px-3 py-3 text-right font-mono tabular-nums sm:hidden">
                <span className="flex flex-col items-end gap-0.5">
                  <RankTrendCell row={row} />
                  <ValueTrendCell row={row} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  if (row.data_points_30d < TREND_MIN_DATA_POINTS || row.rank_change_7d === null) {
    return (
      <span className="text-ink-subtle" aria-label="Insufficient history for 7-day rank movement">
        —
      </span>
    );
  }
  const change = row.rank_change_7d;
  if (change === 0) {
    return (
      <span className="text-ink-muted" aria-label="No rank change in the last 7 days">
        –
      </span>
    );
  }
  const isUp = change > 0;
  const tone = isUp ? "text-signal-positive" : "text-signal-warning";
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 ${tone}`}
      aria-label={rankMovementVerb(change)}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span aria-hidden="true">{Math.abs(change)}</span>
    </span>
  );
}

function ValueTrendCell({ row }: { row: RankingsRow }) {
  if (
    row.data_points_30d < TREND_MIN_DATA_POINTS ||
    row.change_7d_pct === null ||
    row.trend_7d === null
  ) {
    return (
      <span className="text-ink-subtle" aria-label="Insufficient history for 7-day value trend">
        —
      </span>
    );
  }
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
            ? "No value change in the last 7 days"
            : `Value held roughly steady in the last 7 days, ${valueMovementVerb(pct).toLowerCase().replace(/^value /, "")}`
        }
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
      className={`inline-flex items-center justify-end gap-1 ${tone}`}
      aria-label={valueMovementVerb(pct)}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span aria-hidden="true">{pctText}</span>
    </span>
  );
}
