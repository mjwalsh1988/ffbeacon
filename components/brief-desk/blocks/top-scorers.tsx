"use client";

/**
 * top_scorers: the period's scorers per position as ranked rows, sortable.
 *
 * Each player is one compact row (./player-line-row.tsx): the name on one
 * line, the whole stat line as a sentence under it, and PPR points large on
 * the right with the half PPR and standard totals under them. It replaced a
 * 17-column table whose names wrapped and which scrolled sideways at every
 * width; every column it carried is still on the row.
 *
 * Sorting is one native <select>; the status line under the lists announces
 * the order. The default state (rank order) is rendered on the server, so a
 * crawler and a reader without JavaScript see the lists.
 *
 * Client component. Takes plain data only.
 */

import { useId, useState } from "react";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { readPlayer, rowLineText, toNumber, type DatasetRow } from "@/lib/brief-desk/dataset-read";
import { PlayerLineRow, rowMeta } from "./player-line-row";

const SORTS: Array<{ column: string; label: string }> = [
  { column: "pts_ppr", label: "PPR points" },
  { column: "pts_half_ppr", label: "Half PPR points" },
  { column: "pts_std", label: "Standard points" },
  { column: "pass_yd", label: "Passing yards" },
  { column: "rush_yd", label: "Rushing yards" },
  { column: "rec_yd", label: "Receiving yards" },
  { column: "rec_tgt", label: "Targets" },
  { column: "snap_pct", label: "Snap share" },
];

const SELECT_CLASS =
  "min-h-11 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function one(v: unknown): string {
  const n = toNumber((v ?? null) as string | number | null);
  // Always one decimal, so "29.0" lines up under "29.8".
  return n === null ? "n/a" : (Math.round(n * 10) / 10).toFixed(1);
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
  const id = useId();
  const sorts = SORTS.filter((s) => dataset.columns.includes(s.column));
  const [sortColumn, setSortColumn] = useState<string>("pts_ppr");
  const hasPosition = dataset.columns.some((c) => c === "position" || c === "pos");

  const groups: Array<{ label: string | null; rows: DatasetRow[] }> = [];
  if (hasPosition) {
    for (const pos of positions.map((p) => p.toUpperCase())) {
      const rows = dataset.rows.filter((r) => (readPlayer(r).position ?? "").toUpperCase() === pos);
      if (rows.length > 0) groups.push({ label: pos, rows });
    }
  } else {
    groups.push({ label: null, rows: dataset.rows });
  }

  const sorted = groups.map((g) => {
    const rows =
      sortColumn === "pts_ppr"
        ? g.rows
        : [...g.rows].sort((a, b) => (toNumber(b[sortColumn] ?? null) ?? -Infinity) - (toNumber(a[sortColumn] ?? null) ?? -Infinity));
    return { ...g, rows: rows.slice(0, limit) };
  });
  const sortLabel = sorts.find((s) => s.column === sortColumn)?.label ?? "PPR points";

  return (
    <div>
      {sorts.length > 1 && (
        <label htmlFor={`${id}-sort`} className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Sort by
          <select id={`${id}-sort`} value={sortColumn} onChange={(e) => setSortColumn(e.target.value)} className={SELECT_CLASS}>
            {sorts.map((s) => (
              <option key={s.column} value={s.column}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No scorers were recorded for the positions this block names.</p>
      ) : (
        <div className="mt-3">
          {sorted.map((g) => (
            <div key={g.label ?? "all"} className="min-w-0">
              {g.label && (
                <h4 id={`${id}-${g.label}`} className="border-b border-line pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-brand-cyan">
                  {g.label}
                </h4>
              )}
              <ol role="list" aria-labelledby={g.label ? `${id}-${g.label}` : undefined} aria-label={g.label ? undefined : "Top scorers"} className="divide-y divide-line/60">
                {g.rows.map((row, i) => {
                  const p = readPlayer(row);
                  const opponent = typeof row.opponent === "string" ? row.opponent : null;
                  return (
                    <PlayerLineRow
                      key={`${p.id ?? p.slug ?? p.name}-${i}`}
                      rank={i + 1}
                      name={p.name}
                      slug={p.slug}
                      sleeperId={p.sleeperId}
                      meta={rowMeta(hasPosition ? null : p.position, p.team, opponent)}
                      line={rowLineText(row) || null}
                      figure={one(row.pts_ppr)}
                      figureLabel="PPR"
                      sub={
                        <>
                          <span className="block">{`Half ${one(row.pts_half_ppr)}`}</span>
                          <span className="block">{`Standard ${one(row.pts_std)}`}</span>
                        </>
                      }
                    />
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
      <p id={`top-scorers-${blockId}-status`} role="status" className="mt-2 text-xs text-ink-subtle">
        {sortColumn === "pts_ppr" ? "In rank order, by PPR points." : `Sorted by ${sortLabel}, highest first.`}
      </p>
    </div>
  );
}
