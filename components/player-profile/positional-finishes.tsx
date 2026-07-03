/**
 * Positional finish badges. A finish like "WR4" is the player's season-end rank
 * within their position by fantasy points for the active scoring (computed by
 * the get_player_positional_finishes RPC). Shared by the hero and the overview
 * sidebar; the statistics tab renders its own multi-format matrix.
 */

import type { PositionalFinish } from "@/lib/player-profile";

const POS_CLASS: Record<string, string> = {
  QB: "bg-position-qb/15 text-position-qb",
  RB: "bg-position-rb/15 text-position-rb",
  WR: "bg-position-wr/15 text-position-wr",
  TE: "bg-position-te/15 text-position-te",
  K: "bg-position-k/15 text-position-k",
  DEF: "bg-position-def/15 text-position-def",
};

export function finishLabel(position: string, finish: number): string {
  return `${(position || "").toUpperCase()}${finish}`;
}

function posClass(position: string): string {
  return POS_CLASS[(position || "").toUpperCase()] ?? "bg-ink-subtle/15 text-ink-muted";
}

/**
 * A newest-first row of up to N season finish cards. `finishes` must already be
 * filtered to a single scoring and sliced to the seasons to show.
 */
export function LastThreeFinishes({
  position,
  finishes,
  emptyLabel = "No positional finishes yet",
}: {
  position: string;
  finishes: PositionalFinish[];
  emptyLabel?: string;
}) {
  if (finishes.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }
  return (
    <ol className="flex flex-wrap gap-2">
      {finishes.map((f) => {
        const label = finishLabel(position, f.finish);
        return (
          <li
            key={`${f.season}-${f.scoring}`}
            className="rounded-card border border-line bg-surface/60 px-3 py-2 text-center"
            aria-label={`${f.season} finish: ${label}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              {f.season}
            </p>
            <p
              className={`mt-0.5 inline-flex rounded-md px-1.5 font-mono text-lg font-bold tabular-nums ${posClass(
                position,
              )}`}
            >
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
