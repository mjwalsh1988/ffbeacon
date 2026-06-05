"use client";

import { useEffect } from "react";

/**
 * Forces the window to the top when it mounts. Rendered inside the root
 * loading.tsx, so it fires the instant a slow navigation commits and the
 * loading boundary appears. Next's App Router scroll-to-top is a heuristic
 * that can skip resetting when the destination streams a full-viewport
 * loading state (it treats the partially-visible loader as "already in
 * view"), which left users mid-page after navigating while scrolled down.
 * This makes the reset explicit so the loader and new page top are visible.
 *
 * Back/Forward to a cached route does not render loading.tsx, so native
 * scroll restoration is preserved in that case.
 */
export function ScrollToTop() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
}
