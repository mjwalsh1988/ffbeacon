"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type RankingsRow = {
  overall_rank: number;
  position_rank: number;
  tier: number | null;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  status: string;
  value: number | null;
  change_7d: number | null;
  change_7d_pct: number | null;
  trend_7d: string | null;
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
  | "change_7d";
type SortDir = "asc" | "desc";

// Rows with fewer than this many history points hide the 7-day trend display
// (per CLAUDE.md "Pre-calculated tables" rule — sparse data shouldn't be shown).
const TREND_MIN_DATA_POINTS = 7;

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "overall_rank", label: "Rank", numeric: true },
  { key: "name", label: "Player", numeric: false },
  { key: "team", label: "Team", numeric: false },
  { key: "position", label: "Pos", numeric: false },
  { key: "position_rank", label: "Pos rank", numeric: true },
  { key: "tier", label: "Tier", numeric: true },
  { key: "value", label: "Value", numeric: true },
  { key: "change_7d", label: "7d", numeric: true },
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
      setSortDir(key === "name" || key === "team" || key === "position" ? "asc" : "asc");
    }
  };

  return (
    <div className="overflow-hidden rounded-card border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Player rankings. Sortable by rank, name, team, position, tier, value, and 7-day trend.
        </caption>
        <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            {COLUMNS.map((col) => {
              const isActive = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                  }
                  className={col.numeric ? "px-3 py-3 text-right" : "px-3 py-3"}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink"
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
        <tbody className="divide-y divide-line">
          {sorted.map((row) => (
            <tr key={row.slug} className="hover:bg-surface">
              <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">
                {row.overall_rank}
              </td>
              <td className="px-3 py-3">
                <Link
                  href={`/players/${row.slug}`}
                  className="font-medium text-ink hover:text-brand-purple"
                >
                  {row.name}
                </Link>
                {row.status !== "active" && (
                  <span className="ml-2 rounded bg-signal-warning/15 px-1.5 py-0.5 text-xs uppercase text-signal-warning">
                    {row.status}
                  </span>
                )}
              </td>
              <td className="px-3 py-3 text-ink-muted">{row.team ?? "—"}</td>
              <td className="px-3 py-3">
                <span className="font-mono text-xs text-brand-cyan">{row.position}</span>
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-muted">
                {row.position}
                {row.position_rank}
              </td>
              <td className="px-3 py-3 text-right">
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
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                <TrendCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendCell({ row }: { row: RankingsRow }) {
  if (
    row.data_points_30d < TREND_MIN_DATA_POINTS ||
    row.change_7d === null ||
    row.trend_7d === null
  ) {
    return <span className="text-ink-subtle" aria-label="Insufficient history for 7-day trend">—</span>;
  }
  const direction = row.trend_7d;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "→";
  const tone =
    direction === "up"
      ? "text-signal-positive"
      : direction === "down"
        ? "text-signal-warning"
        : "text-ink-muted";
  const delta = row.change_7d;
  const deltaText = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
  const pctText =
    row.change_7d_pct === null
      ? ""
      : ` (${row.change_7d_pct > 0 ? "+" : ""}${row.change_7d_pct.toFixed(1)}%)`;
  return (
    <span
      className={`inline-flex items-center gap-1 ${tone}`}
      aria-label={`7-day value change ${direction}: ${deltaText}${pctText}`}
    >
      <span aria-hidden="true">{arrow}</span>
      <span aria-hidden="true">{deltaText}</span>
    </span>
  );
}
