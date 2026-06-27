"use client";

/**
 * Available players: a real semantic <table> with search, position filter, column
 * sorting (aria-sort on the active column, sort buttons inside <th>), and
 * pagination via "Show more" (NOT virtualized, per owner decision 10). MOCKED for
 * Phase 4 from the fixture board.
 *
 * Accessibility: <caption>, scope headers, aria-sort, aria-pressed filter chips,
 * a polite live region announcing the visible count and sort changes, 44px targets.
 */

import { useMemo, useState } from "react";
import type { DraftPosition, RankedPlayer } from "./fixtures";

type SortKey = "value" | "overallRank" | "positionRank";
type SortDir = "asc" | "desc";

const POSITIONS: Array<DraftPosition | "ALL"> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
const PAGE_SIZE = 10;

function ariaSortFor(active: boolean, dir: SortDir): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

export function AvailableList({ players }: { players: RankedPlayer[] }) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<DraftPosition | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = players.filter((p) => {
      if (position !== "ALL" && p.position !== position) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [players, search, position, sortKey, sortDir]);

  const shown = filtered.slice(0, visible);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // value defaults high-to-low; ranks default low-to-high.
      setSortDir(key === "value" ? "desc" : "asc");
    }
    setVisible(PAGE_SIZE);
  };

  const headerBtn =
    "inline-flex items-center gap-1 text-left font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="otc-avail-search" className="sr-only">
            Search available players
          </label>
          <input
            id="otc-avail-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(PAGE_SIZE);
            }}
            placeholder="Search players..."
            className="w-full rounded-card border border-line bg-base px-3 py-2 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div role="group" aria-label="Filter by position" className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => {
            const active = position === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setPosition(p);
                  setVisible(PAGE_SIZE);
                }}
                className={`min-h-11 rounded-card border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                    : "border-line bg-base text-ink-muted hover:text-ink"
                }`}
              >
                {p === "ALL" ? "All" : p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live region: visible count + sort state. */}
      <p role="status" aria-live="polite" className="mt-3 text-xs text-ink-muted">
        Showing {Math.min(visible, filtered.length)} of {filtered.length} available players, sorted by{" "}
        {sortKey === "value" ? "value" : sortKey === "overallRank" ? "overall rank" : "position rank"}{" "}
        {sortDir === "asc" ? "ascending" : "descending"}.
      </p>

      <div className="mt-2 overflow-x-auto rounded-card border border-line">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Available players, sortable by value, overall rank, and position rank.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Player
              </th>
              <th scope="col" aria-sort={ariaSortFor(sortKey === "positionRank", sortDir)} className="px-3 py-2 text-left">
                <button type="button" className={headerBtn} onClick={() => toggleSort("positionRank")}>
                  Pos rank
                </button>
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Tier
              </th>
              <th scope="col" aria-sort={ariaSortFor(sortKey === "value", sortDir)} className="px-3 py-2 text-right">
                <button type="button" className={`${headerBtn} justify-end`} onClick={() => toggleSort("value")}>
                  Value
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                  No players match your search and filters.
                </td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.playerId} className="border-t border-line/60">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="font-semibold text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ""}
                      {p.isRookie ? " · Rookie" : ""}
                    </span>
                  </th>
                  <td className="px-3 py-2 text-ink-muted">
                    {p.position}
                    {p.positionRank}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">Tier {p.tier}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {p.value.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {visible < filtered.length && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
