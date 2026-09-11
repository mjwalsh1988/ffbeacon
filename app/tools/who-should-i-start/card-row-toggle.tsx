"use client";

/**
 * The "Show as a list" control for the Who Should I Start card row.
 *
 * Plan: docs/seo/who-should-i-start-and-site-seo-plan.md section 2.5 item 2.
 *
 * BOTH LAYOUTS ARE SERVER-RENDERED ALREADY. start-sit-board.tsx (a server
 * component) builds the horizontal scroll row and the stacked list as two
 * separate trees of StartSitCard elements (row layout and stack layout) and
 * hands both to this component as children. This file owns nothing but which
 * one is visible: no data crosses the server/client boundary here, so there
 * is nothing to refetch and nothing that can drift between the two views.
 *
 * VISIBILITY IS THE NATIVE `hidden` ATTRIBUTE, NOT A CSS DISPLAY CLASS. Both
 * trees stay mounted; toggling `hidden` (rather than conditionally rendering
 * one of them) removes the inactive one from the accessibility tree and the
 * tab order in one step, with no separate aria-hidden bookkeeping to keep in
 * sync with a class name.
 *
 * A REAL BUTTON WITH aria-pressed, ONE FIXED VISIBLE LABEL. The label never
 * changes text between the two states; aria-pressed carries which state is
 * active, exactly the pattern the plan calls for. The accessible name equals
 * the visible text, per the project's accessibility contract.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { LayoutList } from "lucide-react";

export function CardRowToggle({
  rowView,
  listView,
}: {
  /** The horizontal scroll-row layout, shown by default. */
  rowView: ReactNode;
  /** The vertically stacked layout, shown once the toggle is pressed. */
  listView: ReactNode;
}) {
  const [showList, setShowList] = useState(false);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          aria-pressed={showList}
          onClick={() => setShowList((prev) => !prev)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <LayoutList aria-hidden="true" className="h-3.5 w-3.5" />
          Show as a list
        </button>
      </div>
      <div hidden={showList}>{rowView}</div>
      <div hidden={!showList}>{listView}</div>
    </div>
  );
}
