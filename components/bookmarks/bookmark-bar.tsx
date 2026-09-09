"use client";

/**
 * The bookmark bar: a row of saved pages under the header, browser-style.
 *
 * DESKTOP ONLY, and that is enforced twice for two different reasons. CSS hides
 * it below `lg`, because that is the width at which a horizontal row of
 * shortcuts stops being usable. The SERVER does not even load the list on a
 * handheld (lib/device.ts, lib/bookmarks/load.ts), because a query paid for a
 * bar that is never painted is waste rather than caution. A phone reads the
 * same bookmarks through the sheet in the header instead.
 *
 * IT DOES NOT EXIST UNTIL THERE IS SOMETHING IN IT. A reader with no bookmarks
 * gets no bar, no strip, and no empty-state prompt: an empty container that
 * explains itself is a permanent advertisement for a feature they have already
 * seen the button for. That decision is made HERE rather than in the server
 * slot, because saving a first bookmark has to make the bar appear without a
 * reload, and switching the bar off on the manage page has to make it go.
 *
 * THE PULL TAB. A small square hanging off the bottom-right edge, like the tab
 * on a folder. It is absolutely positioned and reserves NO height, so the bar
 * ends at its own bottom border and nothing sits between it and the page below;
 * the tab simply overhangs. Pressing it slides the bar up behind the header and leaves the
 * tab behind, now pointing down. The tab is the only part of this that never
 * moves, so there is always something to press. It is 44 by 24 CSS px, which
 * clears the WCAG 2.2 target-size minimum; it is not 44 tall because a target
 * that deep would sit on top of the breadcrumb bar underneath it.
 *
 * IT DOCKS UNDER THE HEADER. Sticky at the header's own height, so scrolling
 * leaves the two together as one block of chrome. The navigation rail sticks
 * below it rather than behind it; see app/globals.css for why that is done in
 * CSS rather than from here.
 *
 * WHY THE MINIMISED STATE IS NOT REACT STATE. See ./collapsed-state.ts: it is
 * an attribute on <html>, set by a blocking script before the first paint, so
 * the bar is the right height in the first frame instead of snapping shut after
 * hydration. `inert` follows React, which lags that attribute by a hydration,
 * so app/globals.css also takes the collapsed track out of the tab order with
 * `visibility: hidden`. Neither alone is enough: the attribute cannot express
 * `inert`, and React cannot act before it has hydrated.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BookmarkIcon } from "./bookmark-icon";
import { currentBookmarkPath } from "@/lib/bookmarks/path";
import type { Bookmark } from "@/lib/bookmarks/types";
import { useBookmarks, type BookmarkInitial } from "./store";
import { useBookmarkActions } from "./use-bookmark-actions";
import { useBookmarkBarCollapsed } from "./collapsed-state";
import { BookmarkRowMenu, type BookmarkMenuAction } from "./bookmark-row-menu";
import { RenameBookmarkDialog } from "./rename-bookmark-dialog";

export function BookmarkBar({ initial }: { initial: BookmarkInitial }) {
  const trackId = useId();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const { bookmarks, barEnabled } = useBookmarks(initial);
  const { collapsed, toggle } = useBookmarkBarCollapsed();
  const {
    busyId,
    message,
    announce,
    error,
    clearError,
    move,
    rename,
    remove,
  } = useBookmarkActions(bookmarks, barEnabled);

  const [renaming, setRenaming] = useState<Bookmark | null>(null);
  const [confirming, setConfirming] = useState<Bookmark | null>(null);

  // Where focus goes after a row disappears. Without it the reader is standing
  // on a control that no longer exists and most screen readers drop them to the
  // top of the document. The tab is the fallback because it is the one thing on
  // this bar that is always present, right up until the bar itself unmounts.
  const listRef = useRef<HTMLUListElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const restoreIndex = useRef<number | null>(null);

  useEffect(() => {
    const index = restoreIndex.current;
    if (index === null) return;
    restoreIndex.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-row-link]");
    if (!rows || rows.length === 0) {
      tabRef.current?.focus();
      return;
    }
    (rows[Math.min(index, rows.length - 1)] ?? rows[rows.length - 1])?.focus();
  }, [bookmarks]);

  const currentPath = currentBookmarkPath(pathname, searchParams?.toString());

  const onMenuAction = useCallback(
    (bookmark: Bookmark, action: BookmarkMenuAction) => {
      if (action === "earlier" || action === "later") {
        void move(bookmark, action);
      } else if (action === "rename") {
        // A failure from a minute ago must not open the dialog already marked
        // invalid, carrying an alert about something else entirely.
        clearError();
        setRenaming(bookmark);
      } else {
        clearError();
        setConfirming(bookmark);
      }
    },
    [move, clearError],
  );

  if (!barEnabled || bookmarks.length === 0) return null;

  return (
    // The nav wraps the tab as well as the list, so the control that opens and
    // closes this region is inside the region it names rather than orphaned
    // outside every landmark on the page.
    <nav
      aria-label="Your bookmarks"
      // No background and no border here, deliberately: THE BAR IS THE TRACK,
      // and this element is only the box the overhanging tab is positioned
      // against. `relative` is the fallback for that; at lg the sticky rule in
      // app/globals.css takes over and is a containing block in its own right.
      className="bookmark-bar-sticky relative hidden lg:block"
    >
      <div
        id={trackId}
        // The bar's own surface and its bottom edge live here rather than on
        // the nav, so both end where the bar ends. The near-opaque background
        // is what docking requires: at 40% the page scrolled visibly through
        // it. It stays `surface` rather than the header's `surface-elevated`,
        // so the two read as two strips rather than one tall header.
        className="bookmark-bar-track border-b border-line bg-surface/95"
        // Out of the tab order and out of the accessibility tree while it is
        // slid away. CSS does the same job before React has hydrated; see the
        // file header for why both are needed.
        inert={collapsed || undefined}
        aria-hidden={collapsed || undefined}
      >
        <div className="bookmark-bar-inner">
          <ul
            ref={listRef}
            className="beacon-scroll flex items-center gap-0.5 overflow-x-auto px-3 py-1.5"
          >
            {bookmarks.map((bookmark, index) => {
              const isCurrent = bookmark.path === currentPath;
              return (
                <li
                  key={bookmark.id}
                  className="group relative flex shrink-0 items-center rounded pr-0.5 hover:bg-base/70"
                  aria-busy={busyId === bookmark.id || undefined}
                >
                  <Link
                    href={bookmark.path}
                    // Forty prefetches on every page load is not a bar, it is a
                    // background download. These are one deliberate click each.
                    prefetch={false}
                    data-row-link
                    aria-current={isCurrent ? "page" : undefined}
                    className={`flex h-7 max-w-[12rem] items-center gap-1.5 rounded px-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan ${
                      isCurrent
                        ? "font-semibold text-brand-cyan"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {/* A league paints its own logo here; everything else
                        paints the glyph its section of the site uses. */}
                    <BookmarkIcon bookmark={bookmark} size={16} />
                    {/* `title` on the span rather than on the link. A truncated
                        label is unreadable to the eye and complete to a screen
                        reader, which takes the link's name from its text; a
                        title on the link itself would be announced as a second
                        description saying the same words again. */}
                    <span className="truncate" title={bookmark.label}>
                      {bookmark.label}
                    </span>
                  </Link>
                  <BookmarkRowMenu
                    bookmarkLabel={bookmark.label}
                    canMoveEarlier={index > 0}
                    canMoveLater={index < bookmarks.length - 1}
                    busy={busyId === bookmark.id}
                    onAction={(action) => onMenuAction(bookmark, action)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* THE TAB IS OUT OF THE FLOW. It used to sit in a 24px row under the
          track, which reserved 24px of empty page under the bar and made the
          tab read as something inside a container rather than something hanging
          off one. Absolutely positioned against the nav (which is sticky, so it
          is already a containing block), it takes up no height at all: the bar
          now ends at its own bottom border and the tab hangs past it, over
          whatever is underneath.

          `top-full` puts its top edge exactly on that border, so the whole tab
          is below the bar. That also means it is fully visible when the bar is
          folded away, where the track is zero height and this is the only thing
          left to press.

          THE INSET FROM THE RIGHT IS NOT ARBITRARY. Directly below is the
          breadcrumb bar, whose right-hand end carries the save-this-page button:
          32px of padding plus a 44px control. Anything nearer the corner than
          that would hang straight on top of it. 88px clears it with room to
          spare and still reads as the bar's right-hand end. */}
      <button
        ref={tabRef}
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={trackId}
        aria-label={
          collapsed
            ? "Show the bookmark bar"
            : "Hide the bookmark bar. Your bookmarks stay saved."
        }
        // `bg-surface`, the bar's own material, fully opaque: the tab is a piece
        // of the bar hanging below its edge, not a chip resting on the page, and
        // it has the breadcrumb bar and then scrolling content behind it. No top
        // border, so it joins the bar's bottom edge rather than drawing a second
        // line across itself.
        className="absolute right-[5.5rem] top-full inline-flex h-6 w-11 items-center justify-center rounded-b-card border-x border-b border-line bg-surface text-ink-subtle transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {collapsed ? (
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </button>

      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {/* One alert for one failure. While a dialog is open it owns the error,
          so the same sentence is not inserted into two assertive regions in the
          same commit and read out twice. */}
      <span role="alert" className="sr-only">
        {renaming || confirming ? "" : (error ?? "")}
      </span>

      {renaming && (
        <RenameBookmarkDialog
          open
          currentLabel={renaming.label}
          path={renaming.path}
          busy={busyId === renaming.id}
          error={error}
          onCancel={() => setRenaming(null)}
          onSave={async (label) => {
            const said = await rename(renaming, label);
            // Both state changes in one commit, so the dialog is gone by the
            // time the polite region outside it changes. VoiceOver prunes
            // anything outside an aria-modal subtree, so announcing while the
            // dialog is still mounted loses the sentence.
            if (said) {
              setRenaming(null);
              announce(said);
            }
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Remove this bookmark?"
          description={`"${confirming.label}" comes off your bookmark bar. The page itself is untouched, and you can save it again any time.`}
          confirmLabel="Remove bookmark"
          cancelLabel="Keep it"
          tone="danger"
          icon={Trash2}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming;
            const index = bookmarks.findIndex((b) => b.id === target.id);
            restoreIndex.current = index < 0 ? 0 : index;
            setConfirming(null);
            void remove(target).then((removed) => {
              // A failed delete leaves the list reference untouched, so the
              // effect above never runs and never clears this. Left armed, it
              // would fire on the next unrelated change and drag focus into the
              // row list without the reader asking.
              if (!removed) restoreIndex.current = null;
            });
          }}
        />
      )}
    </nav>
  );
}
