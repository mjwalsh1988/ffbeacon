"use client";

/**
 * The one live copy of the reader's bookmarks in the browser.
 *
 * WHY A MODULE STORE RATHER THAN A CONTEXT PROVIDER. The pieces that need this
 * state do not share a useful ancestor. The bar sits under the header, the save
 * button sits in the breadcrumb bar, the mobile trigger sits in the header
 * itself, and on a league page the save button sits inside League Pulse's own
 * chrome, several segments below. Wrapping all of that in a provider means the
 * provider lives in the root layout, and the root layout is deliberately
 * SYNCHRONOUS (see app/layout.tsx): an `await` there blocks React from
 * descending into `children`, which would put a bookmark query in front of
 * every page's own data. A provider that took a Promise instead would suspend
 * the whole tree for the same reason.
 *
 * A module store has no ancestor requirement, so each piece renders inside its
 * own Suspense boundary, server-side, from the same request-scoped read
 * (lib/bookmarks/load.ts is React-cached, so they cannot disagree), and then
 * subscribes here for everything that happens afterwards.
 *
 * HYDRATION. `getServerSnapshot` returns null, and so does the client snapshot
 * until the first mount hydrates it, so both the server render and the first
 * client render fall back to the `initial` prop the server passed. Identical
 * markup, no mismatch, and no empty bar that fills in a frame later.
 *
 * NOTHING HERE RUNS ON THE SERVER. This module is imported only by client
 * components, and every mutation happens in an effect or an event handler, so
 * module state is per-tab and can never leak between two readers' requests the
 * way a server-side module variable would. Sign-in and sign-out are both full
 * document loads on this site, so the module cannot outlive an account either.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Bookmark } from "@/lib/bookmarks/types";
import { listBookmarks } from "@/app/actions/bookmarks";

export type BookmarkSnapshot = {
  /**
   * Whether this reader can have bookmarks at all.
   *
   * Recorded separately from the list, and by any surface that mounts, because
   * a control far from the chrome needs to know this without being handed a
   * list of its own. The league sheet in League Pulse is the case: it is deep
   * inside a page, it has no server slot, and a save button that rendered for a
   * signed-out reader would open a dialog telling them to sign in for something
   * they never asked about.
   */
  signedIn: boolean;
  bookmarks: Bookmark[];
  barEnabled: boolean;
  /** False on a handheld before the sheet has been opened for the first time. */
  loaded: boolean;
};

/**
 * The empty list, once.
 *
 * A fresh `[]` in the fallback below gives `bookmarks` a new identity on every
 * render while the store is unseeded, which re-runs every effect that depends
 * on it (the focus-restoration effects in the sheet and the manage page do).
 */
const NO_BOOKMARKS: Bookmark[] = [];

/** Null until the first component hydrates it. Never written on the server. */
let snapshot: BookmarkSnapshot | null = null;
const listeners = new Set<() => void>();

/** The in-flight lazy load, so several triggers warming at once share one call. */
let pendingLoad: Promise<void> | null = null;
/**
 * Set once a lazy load has come back with an error. Without it every hover and
 * every focus on the save button fires another server action for as long as the
 * failure lasts, which is exactly when the server is least able to answer.
 */
let loadFailed = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Always a fresh object, so `useSyncExternalStore` sees the change. */
export function publishBookmarks(
  next: Omit<BookmarkSnapshot, "signedIn">,
): void {
  if (typeof window === "undefined") return;
  // Anything with a list came from an authenticated read by definition.
  snapshot = { signedIn: true, ...next };
  loadFailed = false;
  emit();
}

/**
 * Record that the reader is signed in, WITHOUT touching the list.
 *
 * Order matters and this is why it is separate. Three surfaces mount on a
 * normal page and only some of them carry a list; if the one that carries
 * nothing were allowed to publish a snapshot, whichever mounted first would
 * decide, and a bar with forty bookmarks could be overwritten by a header
 * trigger that was handed none.
 */
export function markBookmarksAvailable(barEnabled: boolean): void {
  if (typeof window === "undefined") return;
  if (snapshot?.signedIn) return;
  snapshot = snapshot
    ? { ...snapshot, signedIn: true }
    : { signedIn: true, bookmarks: NO_BOOKMARKS, barEnabled, loaded: false };
  emit();
}

/** The list as it stands right now, for a caller that is not rendering. */
export function readSnapshot(): BookmarkSnapshot | null {
  return snapshot;
}

/**
 * What the server sent for this render. `bookmarks: null` means the server did
 * not load them, which is what happens on a handheld, when signed out, and on
 * the surfaces that deliberately do not carry a copy of the list.
 */
export type BookmarkInitial = {
  bookmarks: Bookmark[] | null;
  barEnabled: boolean;
};

/**
 * The current bookmarks, plus a loader for the lazy paths.
 *
 * `ensureLoaded` is a no-op once the list is in hand, several callers warming
 * at the same moment share one request, and a failure is remembered so a
 * struggling server is not asked again on every pointer move.
 */
export function useBookmarks(initial: BookmarkInitial): BookmarkSnapshot & {
  ensureLoaded: () => Promise<void>;
} {
  const live = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );

  // Seed the store from the server's answer, once, on the first mount that has
  // one. A later mount with a staler `initial` finds the store already
  // hydrated and leaves it alone; the manage page, which exists to be
  // authoritative, publishes its own list outright instead of seeding.
  const seeded = useRef(false);
  useEffect(() => {
    // Every mount of this hook is a signed-in surface, because the server slots
    // render nothing otherwise.
    markBookmarksAvailable(initial.barEnabled);
    if (seeded.current || snapshot?.loaded) return;
    if (initial.bookmarks === null) return;
    seeded.current = true;
    publishBookmarks({
      bookmarks: initial.bookmarks,
      barEnabled: initial.barEnabled,
      loaded: true,
    });
  }, [initial.bookmarks, initial.barEnabled]);

  const ensureLoaded = useCallback(async () => {
    if (snapshot?.loaded || loadFailed) return;
    if (pendingLoad) return pendingLoad;
    pendingLoad = (async () => {
      try {
        const result = await listBookmarks();
        if (result.ok) {
          publishBookmarks({
            bookmarks: result.bookmarks,
            barEnabled: result.barEnabled,
            loaded: true,
          });
        } else {
          loadFailed = true;
        }
      } catch {
        loadFailed = true;
      } finally {
        pendingLoad = null;
      }
    })();
    return pendingLoad;
  }, []);

  const current: BookmarkSnapshot = live ?? {
    signedIn: true,
    bookmarks: initial.bookmarks ?? NO_BOOKMARKS,
    barEnabled: initial.barEnabled,
    loaded: initial.bookmarks !== null,
  };

  return { ...current, ensureLoaded };
}

/**
 * The store as it stands, for a surface with no server slot of its own.
 *
 * Returns null until something signed-in has mounted, which is the honest
 * answer: the league sheet cannot know whether to offer a save button before
 * the page chrome has told it. The sheet only ever opens on a press, long after
 * hydration, so nothing appears late on screen.
 */
export function useBookmarkAudience(): BookmarkSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}

/** True when this path is already saved. Query strings count: two tabs of one
 * league are two pages, and that is what the reader bookmarked. */
export function isBookmarked(bookmarks: Bookmark[], path: string): boolean {
  return bookmarks.some((bookmark) => bookmark.path === path);
}
