"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Client wrapper that governs the site header's "floating" look. It owns only
 * the outer chrome (position, background, border, shape); the server component
 * renders the actual logo, nav, and action controls and passes them in as
 * `children`, so no functionality moves to the client.
 *
 * Two visual states:
 *   - Floating (homepage, scrolled to the very top): fully transparent, no bar,
 *     no border, no background. The homepage hero is pulled up behind the header
 *     (see the Hero's negative top margin), so its animated backdrop shows
 *     through and the nav appears to float directly in the hero, matching the
 *     homepage design.
 *   - Condensed (after any scroll, or on every non-home page): a translucent,
 *     blurred, rounded floating pill with a soft border and drop shadow, so the
 *     controls stay legible over real page content.
 *
 * `usePathname()` is available during SSR for client components, so the homepage
 * renders transparent on the first paint with no flash. The scroll listener then
 * takes over on the client.
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const floating = isHome && !scrolled;

  return (
    <header
      className={`sticky top-0 z-30 transition-[padding] duration-300 motion-reduce:transition-none ${
        floating
          ? "px-4 sm:px-6 lg:px-8"
          : // Short solid-to-transparent fade masks the sliver of content that
            // would otherwise show in the gap above the floating pill, while the
            // lower fade keeps the pill reading as a floating object, not a bar.
            "px-3 pt-2.5 sm:px-4 sm:pt-3 bg-[linear-gradient(to_bottom,#07070D_0px,#07070D_16px,transparent_70px)]"
      }`}
    >
      <div
        className={`mx-auto flex max-w-7xl items-center gap-3 transition-all duration-300 motion-reduce:transition-none ${
          floating
            ? "h-16 border border-transparent bg-transparent shadow-none"
            : "h-14 rounded-full border border-line-accent bg-surface-elevated/95 pl-4 pr-3 shadow-xl shadow-black/60 ring-1 ring-brand-purple/10 backdrop-blur-xl sm:pl-5 sm:pr-4"
        }`}
      >
        {children}
      </div>
    </header>
  );
}
