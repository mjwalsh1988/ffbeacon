"use client";

import { useId } from "react";
import { ListFilter } from "lucide-react";
import { positionNoun } from "@/lib/site";

export type PositionFilter = "all" | string;

function filterChipClass(active: boolean): string {
  return active
    ? "border-brand-purple/70 bg-brand-purple/15 text-ink hover:bg-brand-purple/25"
    : "border-line bg-surface/60 text-ink-muted hover:border-brand-cyan/50 hover:text-ink";
}

/**
 * Quick filters that narrow a multi-position board to a single position,
 * turning it into that positional list without the user maintaining a
 * separate board.
 *
 * Filtering is deliberately read-only. Reordering inside a filtered subset is
 * ambiguous: moving your QB3 "up one" says nothing about where he belongs in
 * the overall order, so we show the positional view and keep edits on the full
 * board. Chips are single-select toggle buttons in a group, matching the chip
 * bars elsewhere on the site.
 */
export function PositionFilterBar({
  positions,
  counts,
  active,
  totalCount,
  visibleCount,
  listId,
  onChange,
}: {
  positions: readonly string[];
  counts: Map<string, number>;
  active: PositionFilter;
  totalCount: number;
  visibleCount: number;
  /** Id of the list these chips filter, for aria-controls. */
  listId: string;
  onChange: (next: PositionFilter) => void;
}) {
  const headingId = useId();
  // The explanation lives once on the group rather than on every chip, so
  // arrowing across them does not repeat it every time.
  const descId = useId();
  const isFiltered = active !== "all";

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium text-ink">
          <ListFilter aria-hidden="true" className="h-4 w-4 text-brand-purple" />
          View by position
        </h3>
        <div
          role="group"
          aria-label="Filter the board by position"
          aria-describedby={descId}
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => onChange("all")}
            aria-pressed={active === "all"}
            aria-controls={listId}
            aria-label={`Show all positions, ${totalCount} player${totalCount === 1 ? "" : "s"}`}
            className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0 sm:min-w-0 ${filterChipClass(
              active === "all",
            )}`}
          >
            <span>All</span>
            <span className="font-mono text-[10px] tabular-nums opacity-70">{totalCount}</span>
          </button>

          {positions.map((pos) => {
            const count = counts.get(pos) ?? 0;
            const isOn = active === pos;
            return (
              <button
                key={pos}
                type="button"
                onClick={() => onChange(pos)}
                aria-pressed={isOn}
                aria-controls={listId}
                aria-label={`Show ${positionNoun(pos, "plural")} only, ${count} player${count === 1 ? "" : "s"}`}
                className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0 sm:min-w-0 ${filterChipClass(
                  isOn,
                )}`}
              >
                <span>{pos}</span>
                <span className="font-mono text-[10px] tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Names only what filtering actually turns off. Adding, importing, and
          the tier controls above stay live in this view. */}
      <p id={descId} className="mt-2 text-xs text-ink-muted">
        {isFiltered
          ? `Showing your ${visibleCount} ranked ${positionNoun(active, visibleCount === 1 ? "singular" : "plural")} of ${totalCount} players, in board order. Reordering, tier lines and removing are off here. Choose All to edit the board.`
          : "Each player shows their overall rank and their rank at their position. Pick a position to see just that list."}
      </p>
    </section>
  );
}
