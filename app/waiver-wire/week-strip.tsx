/**
 * The previous and next arrows under a weekly board.
 *
 * The full week PICKER lives in the rail now
 * (`components/waiver-wire/board-rail.tsx WeekRail`), because it is a control
 * rather than content. These two arrows stay with the board: they are the
 * "keep reading" affordance at the end of a page, which is a different job
 * from a picker and belongs where the reading stops.
 *
 * Plain links, so they work with scripting off and a crawler follows them.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { weekPath } from "@/lib/waiver-wire/weeks";

/** The previous and next arrows, under the board itself. */
export function WeekPager({
  prev,
  next,
}: {
  prev: number | null;
  next: number | null;
}) {
  if (prev == null && next == null) return null;
  const base =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  return (
    <nav aria-label="Nearby weeks" className="flex flex-wrap justify-between gap-3">
      {prev != null ? (
        <Link href={weekPath(prev)} className={base}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Week {prev} waiver wire
        </Link>
      ) : (
        <span />
      )}
      {next != null && (
        <Link href={weekPath(next)} className={base}>
          Week {next} waiver wire
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      )}
    </nav>
  );
}
