"use client";

/**
 * The button that widens and narrows the navigation rail. It sits in the header
 * rather than in the rail, immediately to the right of the logo, so the logo
 * cell and the rail beneath it read as one piece of chrome: narrow the rail and
 * the header keeps only the mark, widen it and the wordmark comes back with it.
 *
 * Desktop only, because the rail is. On a phone the same tree opens from the
 * drawer trigger next to this slot.
 */

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebar } from "./sidebar-state";

export function RailToggle() {
  const { expanded, toggle } = useSidebar();
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      aria-controls="app-rail"
      className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base/60 text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan lg:inline-flex"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {/* The rail is never hidden, only narrowed to icons, so the name says
          what the press does rather than claiming the rail is gone. */}
      <span className="sr-only">
        {expanded
          ? "Narrow the navigation rail to icons"
          : "Widen the navigation rail to show labels"}
      </span>
    </button>
  );
}
