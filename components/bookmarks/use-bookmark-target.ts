"use client";

/**
 * Save or unsave ONE page, wherever the control that does it happens to live.
 *
 * Two controls do this and they must behave identically: the icon button at the
 * right of the breadcrumb bar, which saves the page you are on, and the button
 * inside League Pulse's league sheet, which saves a league you are only looking
 * at. Written once so that the announcement, the already-saved wording and the
 * warm-on-intent behaviour cannot drift between them.
 *
 * BEFORE THE LIST HAS LOADED, PRESSING ONLY EVER ADDS. On a handheld the server
 * sends no bookmarks, so until the warm fetch lands there is no way to know
 * whether this page is saved. `addBookmark` leaves an existing row completely
 * alone and reports `created: false`, so the reader is told "already in your
 * bookmarks" rather than "Saved", and a name they chose is never overwritten by
 * one derived from a slug. It never silently removes.
 */

import { useCallback, useState } from "react";
import { addBookmark, deleteBookmark } from "@/app/actions/bookmarks";
import type { Bookmark } from "@/lib/bookmarks/types";
import { isBookmarked, publishBookmarks, useBookmarks } from "./store";

export type BookmarkTarget = {
  /** True once we know the page is saved. False also means "not known yet". */
  saved: boolean;
  /** True while the list itself is still unknown, on a handheld. */
  loaded: boolean;
  busy: boolean;
  /** The last outcome, for a polite live region. */
  message: string;
  /** Fetch the list on the first sign of intent, when there is none. */
  warm: () => void;
  toggle: () => Promise<void>;
};

export function useBookmarkTarget({
  path,
  label,
  initial,
}: {
  /** The canonical path to save. Already through lib/bookmarks/path.ts. */
  path: string;
  /** The name to save it under, when it is not already saved. */
  label: string;
  initial: { bookmarks: Bookmark[] | null; barEnabled: boolean };
}): BookmarkTarget {
  const { bookmarks, loaded, ensureLoaded } = useBookmarks(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const saved = loaded && isBookmarked(bookmarks, path);
  const existing = saved ? bookmarks.find((b) => b.path === path) : undefined;

  const warm = useCallback(() => {
    if (!loaded) void ensureLoaded();
  }, [loaded, ensureLoaded]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result =
        existing !== undefined
          ? await deleteBookmark(existing.id)
          : await addBookmark(path, label);
      if (result.ok) {
        publishBookmarks({
          bookmarks: result.bookmarks,
          barEnabled: result.barEnabled,
          loaded: true,
        });
        setMessage(
          existing !== undefined
            ? `Removed ${label} from your bookmarks.`
            : result.created === false
              ? "That page is already in your bookmarks."
              : `Saved ${label} to your bookmarks.`,
        );
      } else {
        setMessage(result.error);
      }
    } catch {
      setMessage("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, existing, label, path]);

  return { saved, loaded, busy, message, warm, toggle };
}
