"use client";

/**
 * top_scorers: the period's scorers as a table per position, sortable by
 * column.
 *
 * Sorting is a native <button> in each column header carrying aria-sort on
 * its <th>, and the result region under the tables announces the sort. The
 * default state (the dataset's own order, which is rank order) is rendered on
 * the server, so a crawler and a reader without JavaScript see the table.
 * Nothing visible is aria-hidden and no column is dropped at any width: the
 * table scrolls inside its container on a phone.
 *
 * Client component. Takes plain data only.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { BundleDataset } from "@/lib/brief-desk/types";
import {
  figureColumns,
  formatCell,
  humanizeColumn,
  readPlayer,
  toNumber,
  type DatasetRow,
} from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS } from "./block-shell";

type SortState = { column: string | null; direction: "asc" | "desc" };

const HEADER_BUTTON =
  "inline-flex min-h-11 items-center gap-1 rounded-card px-1 text-left font-semibold uppercase tracking-wide text-ink-subtle hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function compare(a: DatasetRow, b: DatasetRow, column: string, direction: "asc" | "desc"): number {
  const av = a[column] ?? null;
  const bv = b[column] ?? null;
  const an = toNumber(av);
  const bn = toNumber(bv);
  let cmp: number;
  if (an !== null && bn !== null) cmp = an - bn;
  else if (an !== null) cmp = -1;
  else if (bn !== null) cmp = 1;
  else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
  return direction === "asc" ? cmp : -cmp;
}

export function TopScorersTable({
  blockId,
  dataset,
  positions,
  limit,
}: {
  blockId: string;
  dataset: BundleDataset;
  positions: string[];
  limit: number;
}) {
  const [sort, setSort] = useState<SortState>({ column: null, direction: "desc" });
  const statColumns = figureColumns(dataset.columns);
  const hasPosition = dataset.columns.some((c) => c === "position" || c === "pos");

  // One table per position when the dataset carries one, else one table.
  const groups: Array<{ label: string | null; rows: DatasetRow[] }> = [];
  if (hasPosition) {
    const wanted = positions.map((p) => p.toUpperCase());
    for (const pos of wanted) {
      const rows = dataset.rows.filter((r) => (readPlayer(r).position ?? "").toUpperCase() === pos);
      if (rows.length > 0) groups.push({ label: pos, rows });
    }
  } else {
    groups.push({ label: null, rows: dataset.rows });
  }

  const sortedGroups = groups.map((g) => {
    const rows = sort.column ? [...g.rows].sort((a, b) => compare(a, b, sort.column as string, sort.direction)) : g.rows;
    return { ...g, rows: rows.slice(0, limit) };
  });

  function toggle(column: string) {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "desc" };
      return { column, direction: prev.direction === "desc" ? "asc" : "desc" };
    });
  }

  const sortLabel = sort.column
    ? `Sorted by ${humanizeColumn(sort.column)}, ${sort.direction === "desc" ? "highest first" : "lowest first"}.`
    : "In rank order.";

  return (
    <div>
      {sortedGroups.length === 0 ? (
        <p className="text-sm text-ink-muted">No scorers were recorded for the positions this block names.</p>
      ) : (
        sortedGroups.map((g) => (
          <div key={g.label ?? "all"} className="mt-3 first:mt-0">
            {g.label && <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{g.label}</h4>}
            {/* Focusable and named, so a keyboard reader can scroll the columns
                sideways on a narrow window: Chrome does not focus a bare scroll
                container. */}
            <div
              className="overflow-x-auto"
              role="region"
              tabIndex={0}
              aria-label={g.label ? `${g.label} top scorers` : "Top scorers"}
            >
              <table className="w-full min-w-[20rem] border-collapse text-left text-xs">
                <caption className="sr-only">
                  {g.label ? `${g.label} top scorers` : "Top scorers"}, sortable by column. {sortLabel}
                </caption>
                <thead>
                  <tr className="border-b border-line text-[10px]">
                    <th scope="col" className="py-1.5 pr-3 font-semibold uppercase tracking-wide text-ink-subtle">
                      Player
                    </th>
                    {statColumns.map((column) => {
                      const active = sort.column === column;
                      return (
                        <th
                          key={column}
                          scope="col"
                          className="py-1 pr-2 text-right"
                          aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                        >
                          <button
                            type="button"
                            onClick={() => toggle(column)}
                            className={`${HEADER_BUTTON} ${active ? "text-brand-cyan" : ""}`}
                          >
                            {humanizeColumn(column)}
                            {active ? (
                              sort.direction === "asc" ? (
                                <ArrowUp aria-hidden="true" className="h-3 w-3" />
                              ) : (
                                <ArrowDown aria-hidden="true" className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown aria-hidden="true" className="h-3 w-3 opacity-60" />
                            )}
                            <span className="sr-only">
                              {active ? `, sorted ${sort.direction === "asc" ? "lowest first" : "highest first"}, activate to reverse` : ", activate to sort"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {g.rows.map((row, i) => {
                    const p = readPlayer(row);
                    return (
                      <tr key={`${p.id ?? p.slug ?? p.name}-${i}`}>
                        <th scope="row" className="py-1.5 pr-3 font-normal text-ink">
                          {p.slug ? (
                            <Link href={`/players/${p.slug}`} className={BLOCK_LINK_CLASS}>
                              {p.name}
                            </Link>
                          ) : (
                            p.name
                          )}
                          {(p.team || (!hasPosition && p.position)) && (
                            <span className="ml-1.5 text-[11px] text-ink-subtle">
                              {[!hasPosition ? p.position : null, p.team].filter(Boolean).join(", ")}
                            </span>
                          )}
                        </th>
                        {statColumns.map((column) => (
                          <td key={column} className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">
                            {formatCell(row[column] ?? null, column)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      <p id={`top-scorers-${blockId}-status`} role="status" className="mt-2 text-xs text-ink-subtle">
        {sortLabel}
      </p>
    </div>
  );
}
