"use client";

/**
 * The save button that sits at the right end of the breadcrumb bar, opposite
 * the trail, on every page a signed-in reader visits.
 *
 * WHAT IT SAVES. The path the reader is actually on, query string included.
 * That is deliberate: a League Pulse tab, a draft in On The Clock and a shared
 * verdict all live in a query string, and a bookmark that dropped it would land
 * the reader somewhere other than where they pressed save. The one exception is
 * a league page, where `?username=` and `?name=` are stripped because they name
 * the viewer rather than the page; see lib/bookmarks/path.ts.
 *
 * IT SAVES THE PAGE, NOT WHAT IS ON TOP OF IT. League Pulse opens a league in a
 * sheet without changing the URL, so on that page this button means the tool
 * page, which is what the reader is standing on. Saving the league itself is
 * the sheet's own button (./bookmark-league-button.tsx); it has to be, because
 * nothing about the address bar knows a sheet is open.
 *
 * THE TOOLTIP IS FOR THE EYE; THE LABEL IS FOR THE EAR. The visible bubble is
 * `aria-hidden`, and the same sentence is the button's `aria-label`, so a
 * screen reader hears the whole explanation the moment the control takes focus
 * whether or not the bubble is painted. That is the contract every other
 * tooltip on the site uses (components/info-tooltip.tsx), and it is why there
 * is no `aria-describedby` here: the sentence would then be said twice.
 *
 * NO `aria-pressed`. The accessible NAME states the action and flips with it
 * ("Save this page..." becomes "Remove this page..."), which is unambiguous on
 * its own. On a handheld the list is not loaded until the reader asks for it,
 * so a pressed state would have to be absent-then-present, and a control whose
 * role changes underneath a reader is worse than one that simply says what
 * pressing it will do.
 *
 * REMOVING FROM HERE DOES NOT ASK FIRST, and deleting from the bar, the sheet
 * or the manage page does. The difference is what the reader can see: here they
 * are standing on the page in question and one more press puts it back, exactly
 * like the star in a browser's address bar. There they are removing a row that
 * points somewhere they are not, and getting it back means going to find that
 * page again.
 *
 * `aria-disabled` while a write is in flight, never `disabled`. Disabling the
 * button the reader is standing on makes the browser move focus to `body`, and
 * nothing hands it back when the write finishes, so a press would land the
 * reader at the top of the document every single time.
 */

import { useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { useBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { useTooltipDismiss } from "@/components/info-tooltip";
import { defaultBookmarkLabel } from "@/lib/bookmarks/label";
import { currentBookmarkPath } from "@/lib/bookmarks/path";
import { type BookmarkInitial } from "./store";
import { useBookmarkTarget } from "./use-bookmark-target";

const SAVE_TOOLTIP =
  "Save this page to your bookmarks so you can jump straight back to it.";
const REMOVE_TOOLTIP = "Remove this page from your bookmarks.";

export function BookmarkToggle({
  initial,
  pageLabel,
}: {
  initial: BookmarkInitial;
  /**
   * The name to save this page under, for a surface that knows a better one
   * than its breadcrumb does. League Pulse passes the league's name plus the
   * section, because the URL there is a Sleeper id.
   */
  pageLabel?: string;
}) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const { label: registeredLabel } = useBreadcrumbLabel();

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useTooltipDismiss(open, setOpen, buttonRef);

  const path = useMemo(
    () => currentBookmarkPath(pathname, searchParams?.toString()),
    [pathname, searchParams],
  );

  const label = useMemo(
    () => pageLabel?.trim() || defaultBookmarkLabel(pathname, registeredLabel),
    [pageLabel, pathname, registeredLabel],
  );

  const { saved, busy, message, warm, toggle } = useBookmarkTarget({
    path,
    label,
    initial,
  });

  const tooltip = saved ? REMOVE_TOOLTIP : SAVE_TOOLTIP;
  // A plus when pressing it will add, a tick when it already has. The plain
  // bookmark glyph is reserved for the header control that OPENS the list, so
  // the two are never the same picture doing two jobs.
  const Icon = saved ? BookmarkCheck : BookmarkPlus;

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          void toggle();
          setOpen(false);
        }}
        onPointerEnter={(event) => {
          warm();
          if (event.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setOpen(false);
        }}
        onFocus={() => {
          warm();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onTouchStart={warm}
        aria-disabled={busy || undefined}
        aria-busy={busy}
        aria-label={tooltip}
        className={`-my-2 inline-flex h-11 w-11 items-center justify-center rounded-card border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60 ${
          saved
            ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan hover:border-brand-cyan"
            : "border-line bg-base/60 text-ink-muted hover:border-line-accent hover:text-ink"
        }`}
      >
        <Icon aria-hidden="true" className="h-4 w-4" />
      </button>

      {open && (
        <span
          aria-hidden="true"
          role="presentation"
          className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-56 rounded-card border border-line bg-surface-elevated/95 px-3 py-2 text-left text-xs font-normal leading-relaxed text-ink shadow-2xl backdrop-blur"
        >
          {tooltip}
        </span>
      )}

      {/* What the press did, said out loud. Polite, because nothing here
          interrupts anything: the reader pressed a button and this is the
          answer to it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </span>
  );
}
