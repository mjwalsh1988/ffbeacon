/**
 * The two-column body a Manager Pulse report renders in: the sections down the
 * left across the width the navigation rail leaves, and a rail on the right
 * that follows you down the page.
 *
 * Same arrangement, and the same 340px track, as the League Pulse overview,
 * the player profile and The Beacon Brief. Manager Pulse shipped without one,
 * which is why an eight-section report read as one long column of half-empty
 * cards: a figure like "60 league-seasons" was given the full width of a
 * desktop screen to say one number in.
 *
 * The rail is SECOND IN DOM ORDER. Everything in it is a summary of the
 * sections it sits beside, so on a phone it belongs after the report rather
 * than in front of it. It is capped at the viewport and scrolls inside itself,
 * and takes focus so that scroll works from the keyboard.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";

export function ReportColumns({
  rail,
  railLabel,
  children,
}: {
  rail: ReactNode;
  /** Names the rail's landmark, so it is more than "complementary" in a list. */
  railLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">{children}</div>

      <aside
        aria-label={railLabel}
        tabIndex={0}
        className="beacon-scroll min-w-0 space-y-4 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
      >
        {rail}
      </aside>
    </div>
  );
}
