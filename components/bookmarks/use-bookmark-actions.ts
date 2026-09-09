"use client";

/**
 * The one copy of "call a bookmark action, then apply what came back".
 *
 * Three surfaces mutate bookmarks (the desktop bar, the mobile sheet, the
 * manage page in My Beacon) and all three do the same four things. Written once
 * so they cannot drift: a rename that announced itself on one surface and went
 * silent on another would be a bug nobody notices until a reader hits the quiet
 * one.
 *
 * THE SERVER'S ANSWER IS THE TRUTH. Every action returns the whole list, and
 * that list replaces the store outright. Nothing here computes what the new
 * order ought to be.
 *
 * A MOVE IS OPTIMISTIC AND THE OTHERS ARE NOT. Reordering is a swap of two
 * neighbours, so the right answer is known locally and instantly, and a reader
 * nudging a bookmark along three places should not watch it lurch. Adding,
 * renaming and removing all wait, because each can genuinely fail (a cap, a
 * blank name, a row that is already gone) and showing the reader a result we
 * then have to take back is worse than a moment's wait.
 *
 * RENAME DOES NOT ANNOUNCE ITSELF. It returns the sentence instead, and the
 * caller says it in the same commit that closes the dialog. A live region
 * outside an `aria-modal` subtree is pruned by VoiceOver while the dialog is
 * still mounted, and the dialog closes one microtask after the action resolves,
 * so announcing from in here loses the message on exactly the surface where it
 * matters most.
 */

import { useCallback, useState } from "react";
import {
  deleteBookmark,
  moveBookmark,
  renameBookmark,
  setBookmarkBarEnabled,
} from "@/app/actions/bookmarks";
import type { Bookmark, BookmarkResult } from "@/lib/bookmarks/types";
import { publishBookmarks, readSnapshot } from "./store";

export type BookmarkActions = {
  /** The bookmark id currently being written, or "bar" for the bar toggle. */
  busyId: string | null;
  /** The last thing that happened, for a polite live region. */
  message: string;
  /** Say something in the polite region from a caller that had to wait. */
  announce: (message: string) => void;
  /** The last failure, for an alert. Cleared at the start of every action. */
  error: string | null;
  /** Drop a stale failure, so a dialog does not open carrying one. */
  clearError: () => void;
  move: (bookmark: Bookmark, direction: "earlier" | "later") => Promise<void>;
  /** Resolves to the sentence to announce, or null when it failed. */
  rename: (bookmark: Bookmark, label: string) => Promise<string | null>;
  /** False when the row is still there, so a caller can drop a pending focus move. */
  remove: (bookmark: Bookmark) => Promise<boolean>;
  setBarEnabled: (enabled: boolean) => Promise<void>;
};

export function useBookmarkActions(
  /** The list as it stands, needed only for the optimistic move. */
  bookmarks: Bookmark[],
  barEnabled: boolean,
): BookmarkActions {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: BookmarkResult, success: string): boolean => {
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    publishBookmarks({
      bookmarks: result.bookmarks,
      barEnabled: result.barEnabled,
      loaded: true,
    });
    // An empty string means the caller announces for itself, or the control
    // re-announces its own name and a second sentence would be noise.
    if (success) setMessage(success);
    return true;
  }, []);

  const announce = useCallback((next: string) => setMessage(next), []);
  const clearError = useCallback(() => setError(null), []);

  const move = useCallback(
    async (bookmark: Bookmark, direction: "earlier" | "later") => {
      const index = bookmarks.findIndex((b) => b.id === bookmark.id);
      const target = direction === "earlier" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= bookmarks.length) return;

      setBusyId(bookmark.id);
      setError(null);

      // The state to go back to if the write fails, taken from the store rather
      // than from the props this hook was called with: another action may have
      // landed since this component last rendered, and reverting to a captured
      // prop would undo it.
      const before = readSnapshot();

      const swapped = [...bookmarks];
      [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
      publishBookmarks({
        bookmarks: swapped.map((b, position) => ({ ...b, sortOrder: position })),
        barEnabled,
        loaded: true,
      });

      const revert = () => {
        if (before) publishBookmarks(before);
        else publishBookmarks({ bookmarks, barEnabled, loaded: true });
      };

      try {
        const result = await moveBookmark(bookmark.id, direction);
        const moved = apply(
          result,
          `${bookmark.label} moved to position ${target + 1} of ${bookmarks.length}.`,
        );
        // Put the old order back rather than leaving the reader looking at a
        // move that did not happen.
        if (!moved) revert();
      } catch {
        revert();
        setError("Could not reach the server. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [apply, bookmarks, barEnabled],
  );

  const rename = useCallback(
    async (bookmark: Bookmark, label: string) => {
      setBusyId(bookmark.id);
      setError(null);
      try {
        const result = await renameBookmark(bookmark.id, label);
        // Empty success string: the caller announces, once the dialog is gone.
        const ok = apply(result, "");
        return ok ? `Bookmark renamed to ${label.trim()}.` : null;
      } catch {
        setError("Could not reach the server. Please try again.");
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [apply],
  );

  const remove = useCallback(
    async (bookmark: Bookmark) => {
      setBusyId(bookmark.id);
      setError(null);
      try {
        const result = await deleteBookmark(bookmark.id);
        return apply(result, `${bookmark.label} removed from your bookmarks.`);
      } catch {
        setError("Could not reach the server. Please try again.");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [apply],
  );

  const setBarEnabled = useCallback(
    async (enabled: boolean) => {
      setBusyId("bar");
      setError(null);
      try {
        // No message. The switch changes `aria-checked` AND its own visible
        // text ("Bookmark bar is on" becomes "Bookmark bar is off"), so a third
        // sentence in a live region is the same fact said for the third time.
        apply(await setBookmarkBarEnabled(enabled), "");
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [apply],
  );

  return {
    busyId,
    message,
    announce,
    error,
    clearError,
    move,
    rename,
    remove,
    setBarEnabled,
  };
}
