"use client";

import { useEffect } from "react";

/**
 * Smooth-scrolls the rankings board into view after a filter change so the user
 * lands on the table instead of being snapped back to the top of the page.
 *
 * Rendered only when a filter is active (position / format / source param). The
 * parent gives it a `key` tied to the current filter signature so it remounts
 * and re-scrolls on every filter change, not just the first. Honors
 * prefers-reduced-motion and moves focus to the board heading for keyboard and
 * screen-reader users.
 */
export function ScrollToRankings({
  targetId,
  headingId,
}: {
  targetId: string;
  headingId: string;
}) {
  useEffect(() => {
    // Defer to the next frame so the freshly-rendered board is laid out before
    // we measure and scroll. On a soft navigation the DOM is committed but
    // layout for the new content can lag a tick.
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
      // reader users are taken straight to the board, too.
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
