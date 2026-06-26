"use client";

import { useEffect } from "react";

/**
 * Smooth-scrolls the results section into view after a username search so the
 * user lands on their leagues instead of staying at the top of the page.
 *
 * Rendered only when results exist. The parent gives it a `key` tied to the
 * current search (username + season) so it remounts and re-scrolls on every
 * new search, not just the first one. Honors prefers-reduced-motion and moves
 * focus to the results heading for screen-reader users.
 */
export function ScrollToResults({
  targetId,
  headingId,
}: {
  targetId: string;
  headingId: string;
}) {
  useEffect(() => {
    // Defer to the next frame so the freshly-rendered results section is laid
    // out before we measure and scroll. On a soft navigation the DOM is
    // committed but layout for the new content can lag a tick.
    const raf = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });

      // Move focus to the heading without re-scrolling so keyboard and screen
      // reader users are taken straight to the leagues, too.
      const heading = document.getElementById(headingId);
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [targetId, headingId]);

  return null;
}
