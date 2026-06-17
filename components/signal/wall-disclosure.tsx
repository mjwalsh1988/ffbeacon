"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Spotlight (Layout C) Wall disclosure. The Wall is collapsed behind a labeled
 * toggle instead of running as a feed, so Spotlight stays a clean landing page.
 *
 * HIDDEN-BUT-ACCESSIBLE via progressive enhancement: the server (and any no-JS
 * client) renders the region expanded with no toggle, so the Wall is always
 * present and reachable without JS. After mount the toggle appears and the
 * region collapses. We toggle the HTML `hidden` attribute (not unmount, not CSS
 * display alone): when collapsed the whole region, including the composer,
 * comment, and reaction controls, leaves the accessibility tree and the tab
 * order, so a keyboard user tabs the single toggle and then moves straight past
 * the Wall without expanding it. When expanded the region is back in natural
 * document flow right after the toggle, untrapped, so Tab flows toggle then
 * composer then posts then comment and reaction buttons then out. aria-controls
 * always references the region (it stays in the DOM), and aria-expanded tracks
 * the state. No aria-live region, so nothing double-announces.
 */
export function WallDisclosure({
  postCount,
  children,
}: {
  postCount: number;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  // Expanded on the server and on the first client render (matches SSR, so no
  // hydration mismatch); collapsed once mounted.
  const [open, setOpen] = useState(true);
  const regionId = useId();

  useEffect(() => {
    setMounted(true);
    setOpen(false);
  }, []);

  return (
    <div className="py-2">
      {mounted && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 text-brand-cyan motion-safe:transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
          {open ? "Hide the Wall" : `Show the Wall (${postCount})`}
        </button>
      )}
      <div id={regionId} hidden={mounted ? !open : false} className="mt-2">
        {children}
      </div>
    </div>
  );
}
