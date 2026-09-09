"use client";

/**
 * Whether the bookmark bar is minimised, and how that survives a reload.
 *
 * SAME SHAPE AS THE NAVIGATION RAIL, and for the same reason
 * (components/app-shell/sidebar-state.tsx): React cannot know the remembered
 * value until it has hydrated, so a React-driven height would paint the bar
 * open and then visibly snap shut on every page load for anyone who had
 * minimised it. A blocking script in <head> stamps `data-bookmark-bar` on
 * <html> before the first paint, CSS selects on that attribute, and the React
 * state that mirrors it is only ever used for `aria-expanded` and the tab's
 * label.
 *
 * WHY LOCAL STORAGE RATHER THAN THE DATABASE. Minimised is a per-device answer:
 * a reader on a laptop with a short viewport wants the bar out of the way, and
 * the same reader on a large monitor does not. Whether the bar EXISTS at all is
 * a different question, is a real preference, and does live in the database
 * (`user_preferences.bookmarks_bar_enabled`, migration 0279).
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ffbeacon:bookmark-bar-collapsed";

/**
 * The blocking script that re-applies the remembered state before the first
 * paint. Rendered once, in <head>, by app/layout.tsx.
 *
 * The bar starts OPEN. Only an explicit "1" minimises it, so a reader who has
 * never touched the tab sees their bookmarks rather than a closed strip they
 * have to discover.
 */
export const BOOKMARK_BAR_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});document.documentElement.dataset.bookmarkBar=v==="1"?"collapsed":"open";}catch(e){document.documentElement.dataset.bookmarkBar="open";}})();`;

export function useBookmarkBarCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  // Matches what the server renders. Reconciled from the DOM attribute in the
  // effect below, and nothing visible depends on that reconciliation, so there
  // is no flash: the attribute already had the right value before paint.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(document.documentElement.dataset.bookmarkBar === "collapsed");
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      document.documentElement.dataset.bookmarkBar = next ? "collapsed" : "open";
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Private mode or blocked storage. The choice still applies to this view.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
