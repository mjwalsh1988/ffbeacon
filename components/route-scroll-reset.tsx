"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Puts the window back at the top when the route changes. Mounted once in the
 * root layout, so it covers every page on the site.
 *
 * Why this is needed at all: Next's App Router only resets scroll when its own
 * heuristic decides the top of the new page is not already in view, and that
 * heuristic skips the reset more often than it should. A reader who is scrolled
 * a long way down the rankings table and taps a player then lands on the new
 * profile still scrolled down, looking at whitespace or the footer of a page
 * that is shorter than the one they left. It reads as "the page did not load",
 * and a manual refresh appears to fix it because a refresh always starts at the
 * top. components/scroll-to-top.tsx documented the same failure for the league
 * routes; this generalises the fix instead of repeating it per route.
 *
 * Deliberately NOT solved with a root app/loading.tsx. A loading boundary at the
 * root makes every invalid URL answer 200 while rendering a 404 body, which
 * Google files as a soft 404. app/leagues/loading.tsx has the full write-up.
 *
 * Three cases are left alone:
 *   - The first render. The browser already positioned the initial page, and
 *     scrolling on mount would fight restoration on a reload.
 *   - Back and forward. Next restores the previous scroll position on a popstate
 *     navigation, and clobbering that would lose the reader's place in a long
 *     list, which is the main thing the back button is for.
 *   - Any URL carrying a hash. The fragment target is the intended position.
 *
 * Query-only changes (?tab=, ?position=, ?source=) do not fire this, because
 * usePathname ignores the query string. That is intentional: those are in-page
 * refinements, and several pages (app/rankings/scroll-to-rankings.tsx,
 * app/tools/league-pulse/scroll-to-results.tsx) already anchor the reader
 * somewhere specific when they change.
 */
export function RouteScrollReset() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);
  const cameFromHistory = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      cameFromHistory.current = true;
      // A popstate that lands on the same pathname (a query-only back step)
      // never runs the effect below, so nothing would clear this flag and it
      // would swallow the next real navigation. Drop it after a beat instead.
      window.setTimeout(() => {
        cameFromHistory.current = false;
      }, 1500);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const fromHistory = cameFromHistory.current;
    cameFromHistory.current = false;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (fromHistory) return;
    if (window.location.hash) return;

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
