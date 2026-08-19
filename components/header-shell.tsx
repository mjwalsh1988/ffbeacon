"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Client wrapper that governs the site header's "floating" look. It owns only
 * the outer chrome (position, background, border, shape); the server component
 * renders the actual logo, nav, and action controls and passes them in as
 * `children`, so no functionality moves to the client.
 *
 * Two visual states, and they behave the same on every page:
 *   - Docked (scrolled to the very top): fully transparent. No bar, no border,
 *     no background, nothing painted across the viewport. The controls sit
 *     directly on the page, and on the homepage the hero is pulled up behind
 *     the header (see the Hero's negative top margin) so its backdrop shows
 *     through.
 *   - Condensed (after any scroll): a soft border and drop shadow, so the
 *     controls stay legible over real page content.
 *
 * The condensed state used to carry `backdrop-blur-xl`. Its background is 95%
 * opaque, so the blur was contributing about 5% of a frosted look while asking
 * the browser to re-sample and blur whatever sits behind it on every scroll
 * frame, on every page, including the animating hero backdrop. It is gone.
 *
 * TWO WIDTHS, PICKED BY ROUTE
 *   Contained (everywhere else): the controls sit in a centered `max-w-7xl`
 *   column, and the condensed state is a rounded floating pill inside it.
 *   Nothing paints the full width in either state. An earlier version faded a
 *   solid plate behind the pill, but the fade ended below the header box and
 *   left a hairline running the width of every page.
 *
 *   Full (inside a league view, `/leagues/...`): the logo sits at the far left,
 *   the nav in the middle, and the actions at the far right, spanning the whole
 *   screen to match the League Pulse dashboard underneath it. A pill makes no
 *   sense at that width, so the condensed state paints an edge-to-edge bar with
 *   a bottom border instead. That plate lives on the <header> itself rather than
 *   the inner row, so it reaches the header's real bottom edge with no
 *   transparent strip beneath it.
 *
 * The outer padding and the inner height are identical in every combination, so
 * the header is always exactly 72px tall. Nothing shifts under the reader when
 * it condenses, and the League Pulse rail and mobile section bar can both stick
 * to a fixed `top-[4.5rem]` beneath it.
 *
 * `data-header-state` is read by the `.header-edge-right` rule in globals.css:
 * the right-most control rounds its right edge to match the pill. That rule
 * excludes the full-width header via `data-header-width`, because there is no
 * pill edge there to match.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  // usePathname is resolved on the server too, so the width choice is already
  // correct in the first paint and there is no hydration mismatch to reconcile.
  const pathname = usePathname();
  const wide = pathname?.startsWith("/leagues/") ?? false;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-header-state={scrolled ? "condensed" : "docked"}
      data-header-width={wide ? "full" : "contained"}
      className={`sticky top-0 z-30 py-2 transition-colors duration-300 motion-reduce:transition-none ${
        wide
          ? `px-0 ${
              scrolled
                ? "border-b border-line-accent bg-surface-elevated/95 shadow-lg shadow-black/50"
                : "border-b border-transparent bg-transparent shadow-none"
            }`
          : "px-4 sm:px-6 lg:px-8"
      }`}
    >
      <div
        className={`flex h-14 items-center gap-3 transition-all duration-300 motion-reduce:transition-none ${
          wide
            ? "w-full px-4 sm:px-6 lg:px-8"
            : `mx-auto max-w-7xl ${
                scrolled
                  ? "rounded-full border border-line-accent bg-surface-elevated/95 pl-4 pr-3 shadow-xl shadow-black/60 ring-1 ring-brand-purple/10 sm:pl-5 sm:pr-4"
                  : "border border-transparent bg-transparent px-0 shadow-none"
              }`
        }`}
      >
        {children}
      </div>
    </header>
  );
}
