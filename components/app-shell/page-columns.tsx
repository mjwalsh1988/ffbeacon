/**
 * The two-column body a story page uses under its masthead: the content on the
 * left across the width the navigation rail leaves, and a rail on the right that
 * follows you down the page.
 *
 * Same arrangement, and the same 340px track, as the League Pulse overview, the
 * player profile, and The Beacon Brief. The rail is capped at the viewport and
 * scrolls inside itself, because a rail that carries a form is taller than one
 * screen more often than not, and it takes focus so that scroll works from the
 * keyboard.
 *
 * The rail is second in DOM order. Everything in it is supplementary to the page
 * it sits beside, so on a phone it belongs after the story rather than in front
 * of it.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";
import { PageBody } from "./page-body";

export function PageColumns({
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
    <PageBody>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">{children}</div>

        <aside
          aria-label={railLabel}
          tabIndex={0}
          className="beacon-scroll min-w-0 space-y-6 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
        >
          {rail}
        </aside>
      </div>
    </PageBody>
  );
}
