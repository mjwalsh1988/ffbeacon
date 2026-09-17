/**
 * box_score_lines: the cited players' week lines as one table. The block's
 * options name which players; rows are matched on player_id. Every stat
 * column the dataset carries is shown, and the table scrolls sideways on a
 * phone rather than dropping any of them.
 *
 * Server component.
 */

import Link from "next/link";
import { DataTable, Td, Th } from "@/components/chart-kit";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { figureColumns, formatCell, humanizeColumn, readPlayer } from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS, BlockShell } from "./block-shell";

export function BoxScoreLinesBlock({
  id,
  caption,
  conclusion,
  dataset,
  options,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
  options: { player_ids: string[] };
}) {
  const wanted = new Set(options.player_ids);
  const rows = dataset.rows.filter((r) => {
    const pid = readPlayer(r).id;
    return pid !== null && wanted.has(pid);
  });
  const statColumns = figureColumns(dataset.columns);

  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No week lines were recorded for the players this block names.</p>
      ) : (
        <div
          className="overflow-x-auto"
          role="region"
          tabIndex={0}
          aria-label={`${caption || dataset.title || "Week lines"}: one row per player`}
        >
          <DataTable
            caption={`${caption || dataset.title || "Week lines"}: one row per player`}
            head={
              <>
                <Th>Player</Th>
                <Th>Pos</Th>
                <Th>Team</Th>
                {statColumns.map((c) => (
                  <Th key={c} numeric>
                    {humanizeColumn(c)}
                  </Th>
                ))}
              </>
            }
          >
            {rows.map((row, i) => {
              const p = readPlayer(row);
              return (
                <tr key={`${p.id ?? i}`}>
                  <Td>{p.slug ? <Link href={`/players/${p.slug}`} className={BLOCK_LINK_CLASS}>{p.name}</Link> : p.name}</Td>
                  <Td>{p.position ?? "n/a"}</Td>
                  <Td>{p.team ?? "n/a"}</Td>
                  {statColumns.map((c) => (
                    <Td key={c} numeric>
                      {formatCell(row[c] ?? null, c)}
                    </Td>
                  ))}
                </tr>
              );
            })}
          </DataTable>
        </div>
      )}
    </BlockShell>
  );
}
