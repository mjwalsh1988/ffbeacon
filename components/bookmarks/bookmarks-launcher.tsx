"use client";

/**
 * The header control that opens a reader's bookmarks, and the sheet it opens.
 *
 * IT STANDS WHERE ASK BEAM USED TO. BEAM is a desktop feature now, so the slot
 * in a phone's header that it occupied belongs to this: without a control here
 * there is no bar on a small screen and therefore no way in at all.
 *
 * WHEN IT SHOWS, and there are three cases rather than one:
 *   - Below `lg`, always. There is no bar at that width.
 *   - At every width when the server read the request as a handheld, because it
 *     loaded no bar to fall back on. A large tablet reporting itself as a phone
 *     would otherwise have no route to its own bookmarks.
 *   - At every width when the reader has turned the BAR OFF. That switch is
 *     meant to hide a strip, not to lock a desktop reader out of the list, and
 *     the manage page promises in writing that the bookmarks stay one press
 *     away from the header. `barEnabled` comes from the store, so flipping the
 *     switch moves this control in the same moment.
 *
 * NOTHING IS LOADED UNTIL IT IS ASKED FOR. This never receives the list from
 * the server: on a handheld there is nothing to receive, and on a desktop the
 * bar already carries a copy and seeds the shared store with it, so a second
 * copy in the page payload would be the same few kilobytes of JSON twice. When
 * neither applies, the list is fetched once, on the first sign that the reader
 * is heading for it, and every later open is free.
 *
 * THE SHEET IS THE BAR, TURNED. Same bookmarks, same order, same actions, one
 * button per row instead of a context menu, because a right-click does not
 * exist on a phone and a hidden gesture is not a control.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Bookmark as BookmarkGlyph,
  Settings,
  Trash2,
} from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { BookmarkIcon } from "./bookmark-icon";
import { currentBookmarkPath } from "@/lib/bookmarks/path";
import type { Bookmark } from "@/lib/bookmarks/types";
import { useBookmarks, type BookmarkInitial } from "./store";
import { useBookmarkActions } from "./use-bookmark-actions";

export function BookmarksLauncher({
  initial,
  everyWidth,
}: {
  initial: BookmarkInitial;
  /**
   * True when the server read this request as a handheld, so no bar was loaded
   * and this is the only way to reach the list whatever the viewport turns out
   * to be. The bar being switched OFF has the same consequence and is decided
   * below from live state, because it can change without a page load.
   */
  everyWidth: boolean;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const { bookmarks, barEnabled, loaded, ensureLoaded } = useBookmarks(initial);

  const warm = useCallback(() => {
    if (!loaded) void ensureLoaded();
  }, [loaded, ensureLoaded]);

  const alwaysVisible = everyWidth || !barEnabled;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          warm();
          setOpen(true);
        }}
        onPointerEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open your saved bookmarks"
        // The visible box is 36px to match its neighbours in the header row,
        // and the `before` pseudo-element takes the actual target to 44 by 44.
        // Same trick, for the same rule, as the My Beacon shortcut and the
        // donate launcher on either side of it.
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 text-ink transition-colors before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:border-brand-cyan hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          alwaysVisible ? "" : "lg:hidden"
        }`}
      >
        <BookmarkGlyph aria-hidden="true" className="h-4 w-4" />
      </button>

      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label="Your bookmarks"
        labelledBy={headingId}
      >
        <SheetBody
          headingId={headingId}
          bookmarks={bookmarks}
          barEnabled={barEnabled}
          loaded={loaded}
          onNavigate={() => setOpen(false)}
        />
      </SlideUpDialog>
    </>
  );
}

function SheetBody({
  headingId,
  bookmarks,
  barEnabled,
  loaded,
  onNavigate,
}: {
  headingId: string;
  bookmarks: Bookmark[];
  barEnabled: boolean;
  loaded: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const { busyId, message, error, clearError, move, remove } = useBookmarkActions(
    bookmarks,
    barEnabled,
  );
  const [confirming, setConfirming] = useState<Bookmark | null>(null);

  // The same comparison the bar makes, from the same helper. Comparing the
  // stored path against the pathname alone meant no bookmark carrying a query
  // string could ever be the current page, which is every League Pulse tab and
  // every draft.
  const currentPath = currentBookmarkPath(pathname, searchParams?.toString());

  // Where focus goes after a row disappears. Without this the reader is
  // standing on a button that no longer exists, and most screen readers drop
  // them back to the top of the document, out of the sheet entirely.
  const listRef = useRef<HTMLUListElement>(null);
  const restoreIndex = useRef<number | null>(null);
  const manageRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const index = restoreIndex.current;
    if (index === null) return;
    restoreIndex.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-row-link]");
    if (!rows || rows.length === 0) {
      manageRef.current?.focus();
      return;
    }
    (rows[Math.min(index, rows.length - 1)] ?? rows[rows.length - 1])?.focus();
  }, [bookmarks]);

  return (
    <div className="px-4 pb-4">
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        Your bookmarks
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Pages you saved with the bookmark button. Tap one to go straight there.
      </p>

      {!loaded ? (
        <p className="mt-6 text-sm text-ink-muted" aria-busy="true">
          Loading your bookmarks.
        </p>
      ) : bookmarks.length === 0 ? (
        <p className="mt-6 text-sm leading-relaxed text-ink-muted">
          Nothing saved yet. On any page, press the bookmark button at the right
          of the breadcrumb bar and it will appear here.
        </p>
      ) : (
        <ul ref={listRef} className="mt-4 space-y-2">
          {bookmarks.map((bookmark, index) => {
            const isCurrent = bookmark.path === currentPath;
            const busy = busyId === bookmark.id;
            return (
              <li
                key={bookmark.id}
                aria-busy={busy || undefined}
                // Colour is never the only channel: the current row also carries
                // a solid left edge and a heavier label than its neighbours.
                className={`flex items-stretch gap-1 rounded-card border bg-base/50 ${
                  isCurrent
                    ? "border-brand-cyan/50 border-l-4 border-l-brand-cyan"
                    : "border-line"
                }`}
              >
                <Link
                  href={bookmark.path}
                  prefetch={false}
                  data-row-link
                  onClick={onNavigate}
                  aria-current={isCurrent ? "page" : undefined}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-l-card px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan"
                >
                  <span
                    className={`flex shrink-0 items-center ${
                      isCurrent ? "text-brand-cyan" : "text-ink-subtle"
                    }`}
                  >
                    <BookmarkIcon bookmark={bookmark} size={20} />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm ${
                        isCurrent
                          ? "font-semibold text-brand-cyan"
                          : "font-medium text-ink"
                      }`}
                    >
                      {bookmark.label}
                    </span>
                    {/* The destination, because a label the reader wrote a month
                        ago does not always say where it goes. */}
                    <span className="block truncate text-[11px] text-ink-subtle">
                      {bookmark.path}
                    </span>
                  </span>
                </Link>

                <RowButton
                  label={`Move ${bookmark.label} up, to position ${index}`}
                  disabled={index === 0}
                  busy={busy}
                  onClick={() => void move(bookmark, "earlier")}
                  icon={ArrowUp}
                />
                <RowButton
                  label={`Move ${bookmark.label} down, to position ${index + 2}`}
                  disabled={index === bookmarks.length - 1}
                  busy={busy}
                  onClick={() => void move(bookmark, "later")}
                  icon={ArrowDown}
                />
                <RowButton
                  label={`Remove ${bookmark.label}`}
                  disabled={false}
                  busy={busy}
                  danger
                  onClick={() => {
                    clearError();
                    setConfirming(bookmark);
                  }}
                  icon={Trash2}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Link
        ref={manageRef}
        href="/my-beacon/bookmarks"
        onClick={onNavigate}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-card border border-line px-3 text-sm font-semibold text-brand-cyan transition-colors hover:border-line-accent hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Settings aria-hidden="true" className="h-4 w-4" />
        Manage bookmarks
      </Link>

      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {error && (
        <p role="alert" className="mt-3 text-sm text-signal-danger">
          {error}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title="Remove this bookmark?"
          description={`"${confirming.label}" comes off your bookmarks. The page itself is untouched, and you can save it again any time.`}
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
              if (!removed) restoreIndex.current = null;
            });
          }}
        />
      )}
    </div>
  );
}

/**
 * One square action at the end of a row. 44 by 44, because this is the phone.
 *
 * NEVER THE `disabled` ATTRIBUTE, for either reason it could be unavailable.
 * Disabling a button that currently holds focus makes the browser move focus to
 * `body`, and nothing gives it back. Inside this `aria-modal` sheet that ejects
 * the reader from the dialog: the focus trap only fires on the first and last
 * focusable inside the panel, so from `body` the next Tab lands on the skip
 * link behind the backdrop.
 *
 * Both reasons are transient. `busy` clears when the write lands, and
 * "already first" stops being true the moment a move succeeds, which is exactly
 * when this button is holding focus. So both go through `aria-disabled` plus a
 * guard in the handler, which is what the ARIA menu pattern asks for anyway:
 * the control stays perceivable and announces that it is unavailable.
 */
function RowButton({
  label,
  icon: Icon,
  disabled,
  busy,
  danger,
  onClick,
}: {
  label: string;
  icon: typeof ArrowUp;
  disabled: boolean;
  busy: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled || busy) return;
        onClick();
      }}
      aria-disabled={disabled || busy || undefined}
      aria-label={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-card transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan aria-disabled:opacity-30 ${
        danger
          ? "text-signal-danger hover:bg-signal-danger/10 hover:text-rose-300"
          : "text-ink-muted hover:bg-surface hover:text-ink"
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
