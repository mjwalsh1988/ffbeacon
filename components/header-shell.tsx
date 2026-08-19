"use client";

/**
 * The outer chrome of the site header. The server component renders the logo,
 * the controls, and the nav trigger and passes them in as `children`, so no
 * functionality moves to the client.
 *
 * The header is now one edge-to-edge bar on every page, sticky at the top, 72px
 * tall, always painted. It used to be transparent while the page was scrolled
 * to the top and condense into a floating pill on scroll. That made sense when
 * it was the only chrome; it does not now that a navigation rail runs down the
 * left of every page and the header's left cell is the top of that rail. A pill
 * cannot sit on top of a rail.
 *
 * Height is fixed at 72px, which the rail, the breadcrumb bar, and every
 * sticky row on the site are positioned against.
 */

import { useEffect, useState } from "react";

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
      className={`sticky top-0 z-40 h-[4.5rem] border-b bg-surface-elevated/95 transition-shadow duration-300 motion-reduce:transition-none ${
        scrolled
          ? "border-line-accent shadow-lg shadow-black/50"
          : "border-line shadow-none"
      }`}
    >
      <div className="flex h-full items-center">{children}</div>
    </header>
  );
}
