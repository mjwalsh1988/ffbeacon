"use client";

/**
 * The player table under the Positional WAR charts.
 *
 * A real semantic <table> with a caption, scope headers, aria-sort on the
 * active column, sort buttons inside the <th>, a name search, and a polite
 * live region that announces the settled count and sort. Modelled on
 * app/tools/on-the-clock/available-list.tsx, which is this project's reference
 * implementation for a sortable, searchable table.
 *
 * NO DATA IS HIDDEN AT ANY BREAKPOINT, per CLAUDE.md's mobile rule. The table
 * keeps its natural width and the wrapper scrolls horizontally on a narrow
 * screen (`w-max min-w-full` inside an `overflow-x-auto` region, the same
 * construction available-list.tsx uses), so every column, every header and
 * every sort button is reachable at 320px. The player cell additionally
 * carries a stacked context line (position, team, manager, tier) so a reader
 * on a phone gets a row's identity without scrolling sideways to find it; that
 * line duplicates columns rather than replacing them.
 *
 * THE POSITION FILTER LIVES IN THE PARENT. One control drives this table, the
 * line chart and the scatterplot together, so a reader who hides kickers hides
 * them everywhere at once rather than having to say it three times.
 *
 * Sorting is delegated to lib/positional-war/table.ts, which is pure and
 * tested on its own, so the ordering rules (nulls last in both directions,
 * ties broken by WAR then player id) are not restated here.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  filterWarRows,
  ownerLabel,
  sortWarRows,
  type WarSortDirection,
  type WarSortKey,
  type WarTableRow,
} from "@/lib/positional-war/table";
import { WAR_TIER_LABEL, WAR_TIER_MEANING, type WarTier } from "@/lib/positional-war/tiers";
import type { PulsePosition } from "@/lib/power-pulse/types";

/** How long the spoken summary waits for typing to settle. */
const ANNOUNCE_DELAY_MS = 500;
const PAGE_SIZE = 25;

/**
 * Tier styling. Every tier keeps a readable border and text colour, and the
 * LABEL is the tier: nothing here is conveyed by colour alone, and the badge
 * is plain text a screen reader reads verbatim.
 */
const TIER_CLASS: Record<WarTier, string> = {
  "league-breaker": "border-brand-purple/60 bg-brand-purple/15 text-brand-purple",
  elite: "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan",
  strong: "border-signal-good/50 bg-signal-good/10 text-signal-good",
  starter: "border-line-accent bg-surface text-ink",
  replacement: "border-line bg-base text-ink-muted",
  below: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
};

type Column = {
  key: WarSortKey;
  /** The visible header. Short, because it sits above a number. */
  label: string;
  /** The full name, for screen readers and for the CSV header. */
  full: string;
  /** High-to-low is the natural first press for every column except rank. */
  defaultDirection: WarSortDirection;
};

/**
 * The sortable numeric columns.
 *
 * "PORP" from the reference screenshots is deliberately not used anywhere: an
 * unexplained acronym in a table header is a puzzle, not a label. The header
 * reads "Pts over repl." and its accessible name reads the whole phrase.
 */
const COLUMNS: Column[] = [
  {
    key: "war",
    label: "Positional WAR",
    full: "Positional WAR, wins over replacement",
    defaultDirection: "desc",
  },
  {
    key: "pointsAboveReplacement",
    label: "Pts over repl.",
    full: "Projected points above replacement, over the whole window",
    defaultDirection: "desc",
  },
  {
    key: "warPerWeek",
    label: "Wins/wk",
    full: "Wins over replacement per week he is projected for",
    defaultDirection: "desc",
  },
  {
    key: "projectedPointsPerWeek",
    label: "Pts/wk",
    full: "Projected fantasy points per week under this league's scoring",
    defaultDirection: "desc",
  },
  { key: "tradeValue", label: "Value", full: "Current trade value", defaultDirection: "desc" },
];

function ariaSortFor(active: boolean, dir: WarSortDirection): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

/**
 * One CSV field, quoted and escaped per RFC 4180, and neutered against formula
 * injection.
 *
 * A spreadsheet treats a cell beginning with =, +, - or @ as a formula, so a
 * player or manager name starting with one of those would run as code the
 * moment somebody opened the file. Every name in this table comes from Sleeper,
 * which is to say from a stranger's keyboard: manager display names are
 * user-chosen. A leading apostrophe is the standard defusal and every
 * spreadsheet strips it back out on display.
 */
function csvField(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  // A negative number legitimately starts with a hyphen, so it is exempt:
  // prefixing "-0.15" would turn a figure into text and break every sum in the
  // sheet. Nothing that parses as a finite number can carry a formula.
  const risky = /^[=+\-@\t\r]/.test(raw) && !Number.isFinite(Number(raw));
  const s = risky ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: readonly WarTableRow[]): string {
  const header = [
    "Player",
    "Position",
    "Position rank",
    "NFL team",
    "Manager",
    "Positional WAR tier",
    "Positional WAR",
    "Points above replacement",
    "Wins per projected week",
    "Projected points per week",
    "Replacement points per week",
    "Weeks projected",
    "Trade value",
  ];
  const lines = [header.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.position,
        row.positionRank,
        row.team ?? "",
        ownerLabel(row.owner),
        WAR_TIER_LABEL[row.tier],
        row.war.toFixed(3),
        row.pointsAboveReplacement.toFixed(1),
        row.warPerWeek === null ? "" : row.warPerWeek.toFixed(4),
        row.projectedPointsPerWeek.toFixed(1),
        row.replacementPointsPerWeek.toFixed(1),
        row.weeksProjected,
        row.tradeValue === null ? "" : Math.round(row.tradeValue),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function WarPlayerTable({
  rows,
  positions,
  leagueName,
  sourceDisplay,
}: {
  /** Every row, unfiltered. The position filter is applied here. */
  rows: WarTableRow[];
  /** The currently visible positions, owned by the dashboard. */
  positions: ReadonlySet<PulsePosition>;
  /** For the download's filename. */
  leagueName: string;
  /** Named in the value column's description, never a raw source slug. */
  sourceDisplay: string;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<WarSortKey>("war");
  const [sortDir, setSortDir] = useState<WarSortDirection>("desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(
    () => sortWarRows(filterWarRows(rows, positions, search), sortKey, sortDir),
    [rows, positions, search, sortKey, sortDir],
  );

  const shown = filtered.slice(0, visibleCount);

  const activeColumn = COLUMNS.find((c) => c.key === sortKey);
  const sortLabel = activeColumn ? activeColumn.full : "position rank";

  const summary =
    `Showing ${shown.length} of ${filtered.length} players, sorted by ${sortLabel}, ` +
    `${sortDir === "asc" ? "lowest first" : "highest first"}.` +
    (shown.length > 0 ? ` Top of the list is ${shown[0].name}, ${shown[0].position}.` : "");

  // Announce the settled sentence, and only for something the user did.
  // Typing "Jefferson" would otherwise queue nine announcements over the
  // character echo. Same mechanism, and the same reason, as available-list.tsx.
  const [interactions, setInteractions] = useState(0);
  const noteInteraction = () => setInteractions((n) => n + 1);
  const [announced, setAnnounced] = useState("");
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  useEffect(() => {
    if (interactions === 0) return;
    const timer = setTimeout(() => setAnnounced(summaryRef.current), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [interactions, search, sortKey, sortDir, visibleCount]);

  const toggleSort = (column: Column) => {
    if (column.key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir(column.defaultDirection);
    }
    setVisibleCount(PAGE_SIZE);
    noteInteraction();
  };

  /**
   * Download every row currently passing the filter, not just the page on
   * screen. "Show more" is a rendering budget; a file is not.
   *
   * Built and revoked in the browser: nothing is sent anywhere, because the
   * numbers are already on this page.
   */
  const download = () => {
    const blob = new Blob([buildCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${leagueName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "league"}-positional-war.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // The padding belongs to the BUTTON, not the cell, or the target is only as
  // tall as the text. min-h-11 is the project's 44px floor.
  const headerBtn =
    "inline-flex min-h-11 w-full items-center gap-1 px-3 py-2 text-left font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="war-table-search" className="mb-1 block text-xs font-medium text-ink-muted">
            Search players
          </label>
          <input
            id="war-table-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
              noteInteraction();
            }}
            placeholder="Type a name"
            className="min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <button
          type="button"
          onClick={download}
          className="flex min-h-11 items-center gap-2 rounded-card border border-line bg-base/40 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Download aria-hidden="true" className="h-4 w-4 shrink-0" />
          Download {filtered.length} rows as CSV
        </button>
      </div>

      <p aria-hidden="true" className="mt-3 text-xs text-ink-muted">
        {summary}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>

      <div
        tabIndex={0}
        role="region"
        aria-label="Player wins over replacement table, scrollable"
        className="mt-2 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {/* On a narrow screen the table keeps its natural width and the wrapper
            scrolls, so every column stays readable and reachable instead of
            being squeezed or dropped. On desktop it fills the container. */}
        <table className="w-max min-w-full border-collapse text-sm sm:w-full">
          <caption className="sr-only">
            Every plotted player, with wins over replacement, projected points, and current trade
            value from {sourceDisplay}. Sortable by any numeric column.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Player
              </th>
              <th
                scope="col"
                aria-sort={ariaSortFor(sortKey === "positionRank", sortDir)}
                className="px-3 py-2 text-left"
              >
                <button
                  type="button"
                  className={headerBtn}
                  onClick={() =>
                    toggleSort({
                      key: "positionRank",
                      label: "Pos",
                      full: "position rank",
                      defaultDirection: "asc",
                    })
                  }
                >
                  <span aria-hidden="true">Pos</span>
                  <span className="sr-only">Sort by position rank</span>
                </button>
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Team
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Manager
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Tier
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSortFor(sortKey === column.key, sortDir)}
                  className="px-3 py-2 text-right"
                >
                  <button
                    type="button"
                    className={`${headerBtn} justify-end`}
                    onClick={() => toggleSort(column)}
                  >
                    <span aria-hidden="true">{column.label}</span>
                    <span className="sr-only">Sort by {column.full}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((row) => (
              <tr
                key={row.playerId}
                className={row.isYours ? "bg-brand-purple/5" : undefined}
              >
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span>{row.name}</span>
                    {row.isYours && (
                      <span className="rounded-full border border-brand-purple/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                        Yours
                      </span>
                    )}
                    {row.injuryStatus && (
                      <span className="text-[11px] font-normal text-signal-warn">
                        {row.injuryStatus}
                      </span>
                    )}
                  </span>
                  {/* The row's identity, repeated compactly so a reader on a
                      phone has it without scrolling sideways. The standalone
                      columns still exist and still scroll into view; this
                      duplicates them rather than replacing them. */}
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-subtle sm:hidden">
                    {row.position}
                    {row.positionRank}, {row.team ?? "no team"}, {ownerLabel(row.owner)},{" "}
                    {WAR_TIER_LABEL[row.tier]}
                  </span>
                </th>
                <td className="px-3 py-2 text-left tabular-nums text-ink-muted">
                  {row.position}
                  {row.positionRank}
                </td>
                <td className="px-3 py-2 text-left text-ink-muted">{row.team ?? "-"}</td>
                <td className="px-3 py-2 text-left text-ink-muted">{ownerLabel(row.owner)}</td>
                <td className="px-3 py-2 text-left">
                  <span
                    title={WAR_TIER_MEANING[row.tier]}
                    className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TIER_CLASS[row.tier]}`}
                  >
                    {WAR_TIER_LABEL[row.tier]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                  {row.war.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {row.pointsAboveReplacement.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {row.warPerWeek === null ? "-" : row.warPerWeek.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {row.projectedPointsPerWeek.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {/* A dash, never a zero: this source publishes no value for
                      him, which is not the same as saying he is worthless. */}
                  {row.tradeValue === null ? (
                    <span title={`${sourceDisplay} publishes no value for this player`}>-</span>
                  ) : (
                    Math.round(row.tradeValue)
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5 + COLUMNS.length} className="px-3 py-6 text-center text-sm text-ink-muted">
                  No players match that search at the positions you have showing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > shown.length && (
        <button
          type="button"
          onClick={() => {
            setVisibleCount((n) => n + PAGE_SIZE);
            noteInteraction();
          }}
          className="mt-3 min-h-11 rounded-card border border-line bg-base/40 px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more
        </button>
      )}
    </div>
  );
}
