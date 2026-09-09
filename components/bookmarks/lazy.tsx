"use client";

/**
 * The bookmark UI, behind a dynamic import.
 *
 * WHY THIS FILE EXISTS, and it is not a style preference. The three bookmark
 * components are reachable from the root layout, and so are SiteSearch and
 * DonateLauncher, which render for everyone. Webpack merges every client module
 * in one entry's chunk group into the same always-loaded set, so loading either
 * of those loaded the bookmark code too: measured at 24.8 kB raw, 7.7 kB gzip,
 * in the HTML of a request carrying no session at all. The server slots
 * returning null keeps the module out of the FLIGHT payload, which is what they
 * were reasoned about; it does not keep the chunk off the page.
 *
 * A dynamic `import()` creates an ASYNC chunk, which webpack never folds back
 * into an initial group. A signed-out visitor downloads the few hundred bytes
 * of these wrappers and never renders them, so the bookmark bar, the sheet, the
 * row menu, the rename dialog and the two shared dialogs they pull in are never
 * fetched.
 *
 * SSR STAYS ON. `next/dynamic` here is React.lazy plus a boundary, not a
 * client-only escape hatch: the bar and the save button are still rendered into
 * the served HTML, which is the whole reason they receive their state from the
 * server rather than fetching it. Nothing about the no-flash behaviour changes.
 */

import dynamic from "next/dynamic";

export const BookmarkBarLazy = dynamic(() =>
  import("./bookmark-bar").then((mod) => mod.BookmarkBar),
);

export const BookmarkToggleLazy = dynamic(() =>
  import("./bookmark-toggle").then((mod) => mod.BookmarkToggle),
);

export const BookmarksLauncherLazy = dynamic(() =>
  import("./bookmarks-launcher").then((mod) => mod.BookmarksLauncher),
);
