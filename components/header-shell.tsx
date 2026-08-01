"use client";

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
 *   - Condensed (after any scroll): a translucent, blurred, rounded floating
 *     pill with a soft border and drop shadow, so the controls stay legible
 *     over real page content.
 *
 * Nothing paints the full width in either state. An earlier version faded a
 * solid plate behind the condensed pill, but the fade ended below the header
 * box and left a hairline running the width of every page.
 *
 * The outer padding and the inner height are identical in both states, so
 * toggling never changes the header's height and the page never shifts under
 * the reader.
 *
 * `data-header-state` is read by the `.header-edge-right` rule in globals.css:
 * the right-most control rounds its right edge to match the pill.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-header-state={scrolled ? "condensed" : "docked"}
      className="sticky top-0 z-30 px-4 py-2 sm:px-6 lg:px-8"
    >
      <div
        className={`mx-auto flex h-14 max-w-7xl items-center gap-3 transition-all duration-300 motion-reduce:transition-none ${
          scrolled
            ? "rounded-full border border-line-accent bg-surface-elevated/95 pl-4 pr-3 shadow-xl shadow-black/60 ring-1 ring-brand-purple/10 backdrop-blur-xl sm:pl-5 sm:pr-4"
            : "border border-transparent bg-transparent px-0 shadow-none"
        }`}
      >
        {children}
      </div>
    </header>
  );
}
