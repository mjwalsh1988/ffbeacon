/**
 * box_score_lines: the cited players' week lines as compact rows (see
 * ./player-line-row.tsx). The block's options name which players; rows are
 * matched on player_id. Each row carries every stat column the dataset has,
 * as one sentence, with the points on the right: PPR for an offensive
 * player, Sleeper default IDP points for a defender, never both.
 *
 * Server component.
 */

import type { BundleDataset } from "@/lib/brief-desk/types";
import { readPlayer, rowLineText, toNumber } from "@/lib/brief-desk/dataset-read";
import { BlockShell } from "./block-shell";
import { PlayerLineRow, rowMeta } from "./player-line-row";

function one(v: unknown): string {
  const n = toNumber((v ?? null) as string | number | null);
  // Always one decimal, so "29.0" lines up under "29.8".
  return n === null ? "n/a" : (Math.round(n * 10) / 10).toFixed(1);
}

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

  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No week lines were recorded for the players this block names.</p>
      ) : (
        <ol role="list" aria-label={caption || dataset.title || "Week lines"} className="divide-y divide-line/60">
          {rows.map((row, i) => {
            const p = readPlayer(row);
            const defender = row.pts_idp123 !== undefined && row.pts_idp123 !== null;
            const opponent = typeof row.opponent === "string" ? row.opponent : null;
            return (
              <PlayerLineRow
                key={`${p.id ?? i}`}
                name={p.name}
                slug={p.slug}
                sleeperId={p.sleeperId}
                meta={rowMeta(p.position, p.team, opponent)}
                line={rowLineText(row) || null}
                figure={one(defender ? row.pts_idp123 : row.pts_ppr)}
                figureLabel={defender ? "IDP" : "PPR"}
                sub={
                  defender ? (
                    "Sleeper IDP scoring"
                  ) : (
                    <>
                      <span className="block">{`Half ${one(row.pts_half_ppr)}`}</span>
                      <span className="block">{`Standard ${one(row.pts_std)}`}</span>
                    </>
                  )
                }
              />
            );
          })}
        </ol>
      )}
    </BlockShell>
  );
}
