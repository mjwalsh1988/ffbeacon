import "server-only";

/**
 * The server side of the bookmark feature: three small components that resolve
 * who is reading, hand the answer to the matching client component, and render
 * nothing at all for anyone signed out.
 *
 * WHY SLOTS RATHER THAN ONE COMPONENT. The three pieces live in three different
 * places in the DOM (a bar under the header, a button in the breadcrumb bar, a
 * trigger in the header itself) and no useful element contains all three. Each
 * is passed into the chrome that owns its position, exactly the way the
 * navigation rail is passed into the app shell, so the root layout stays
 * synchronous and none of this sits in front of a page's own data.
 *
 * They share one read. `loadBookmarkState` is React-cached, so all three get
 * the same in-flight Promise and one query between them, and, more to the
 * point, they cannot disagree about what the reader has saved.
 *
 * EVERY ONE OF THESE RENDERS NOTHING WHEN SIGNED OUT. Not hidden: absent. The
 * client components sit behind a dynamic import (./lazy.tsx), so a signed-out
 * visitor does not download them either, which was NOT true when they were
 * imported statically.
 *
 * ONE COPY OF THE LIST PER PAGE. Only the surfaces that must paint it correctly
 * before hydration carry the array: the bar, and the save button, which cannot
 * know whether the current page is saved without it (a server component has no
 * pathname to compare). The header sheet trigger gets `bookmarks: null` and
 * reads the store the bar seeds, or fetches once on intent when there is no bar.
 */

import { Suspense } from "react";
import { loadBookmarkState } from "@/lib/bookmarks/load";
import {
  BookmarkBarLazy,
  BookmarkToggleLazy,
  BookmarksLauncherLazy,
} from "./lazy";

/** The bar of shortcuts under the header. Desktop only. */
export async function BookmarkBarSlot() {
  const state = await loadBookmarkState();
  // Only the two facts that cannot change without a page load are decided here.
  // Whether there is anything IN the bar, and whether the reader has it turned
  // on, are both decided by the component, because both change under the
  // reader's hands: saving a first bookmark has to make the bar appear, and
  // switching it off on the manage page has to make it go, without a reload
  // either time.
  if (!state.signedIn || state.isHandheld) return null;
  return (
    // useSearchParams inside, so a boundary is required. Nothing sensible to
    // show while it resolves: this is chrome, and an empty strip that fills in
    // is worse than one that simply appears.
    <Suspense fallback={null}>
      <BookmarkBarLazy
        initial={{ bookmarks: state.bookmarks, barEnabled: state.barEnabled }}
      />
    </Suspense>
  );
}

/** The save button for the current page. */
export async function BookmarkToggleSlot({
  pageLabel,
}: {
  /** A better name for this page than its breadcrumb would give. */
  pageLabel?: string;
}) {
  const state = await loadBookmarkState();
  if (!state.signedIn) return null;
  return (
    <Suspense fallback={null}>
      <BookmarkToggleLazy
        initial={{ bookmarks: state.bookmarks, barEnabled: state.barEnabled }}
        pageLabel={pageLabel}
      />
    </Suspense>
  );
}

/** The header control that opens the bookmarks sheet. */
export async function BookmarksLauncherSlot() {
  const state = await loadBookmarkState();
  if (!state.signedIn) return null;
  return (
    <BookmarksLauncherLazy
      // Deliberately no list. On a handheld there is none to send, and on a
      // desktop the bar is already carrying one and seeding the shared store
      // with it, so a second copy would put the same JSON in the page twice.
      initial={{ bookmarks: null, barEnabled: state.barEnabled }}
      everyWidth={state.isHandheld}
    />
  );
}
