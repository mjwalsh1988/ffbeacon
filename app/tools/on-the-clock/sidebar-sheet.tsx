"use client";

/**
 * The draft room's side rail, on a phone.
 *
 * Below xl there is no second column to put the rail in, so it used to stack
 * underneath the whole page: four panels a drafter has to scroll past the entire
 * board to reach, which in a live draft is the same as not having them. Here it
 * becomes a bottom sheet behind one full-width bar that leads the content
 * column.
 *
 * THE BAR FOLLOWS YOU DOWN. Once you have scrolled past it, it re-attaches
 * itself under the site header so the rail is always one tap away, and it lets
 * go again the moment you scroll back up to where it lives. The switch is an
 * IntersectionObserver on the bar's own slot rather than `position: sticky`,
 * because the room's outer shell carries `overflow-hidden` and that silently
 * turns sticky into static.
 *
 * The slot keeps its height whether the bar is in it or docked above, so the
 * page never jumps under the reader at the moment it detaches.
 *
 * The panels are rendered HERE and nowhere else at these widths. Several of them
 * carry fixed DOM ids, so the room decides which single home they get.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PanelRight, ChevronUp, X } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";

/**
 * Where the docked bar parks: the site header is 4.5rem tall (sticky, z-30),
 * and the extra 1rem is the breathing room that keeps the bar from looking
 * welded to the header.
 */
const HEADER_HEIGHT_REM = 4.5;
const DOCK_GAP_REM = 1;
const DOCK_TOP_REM = HEADER_HEIGHT_REM + DOCK_GAP_REM;

/**
 * The same offset in pixels, read from the document rather than assumed to be
 * 16 per rem. The bar's own `top` is in rem, so it scales with a reader's font
 * size; hardcoding the observer's trigger line at 88px would leave a widening
 * band, on exactly the setups this product exists for, where the bar has slid
 * behind the header and has not yet docked.
 */
function dockTopPx(): number {
  if (typeof window === "undefined") return DOCK_TOP_REM * 16;
  const root = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return DOCK_TOP_REM * (Number.isFinite(root) && root > 0 ? root : 16);
}

/**
 * Horizontal inset that lines the docked bar up with where it sits in the flow.
 * Three things pad it there: the navigation rail (from lg up, and its width is
 * whatever the reader last set it to), the page shell (px-4 / sm:px-6 /
 * lg:px-8), and the draft room's own body (px-4 / sm:px-6), plus the room's 1px
 * border. Without this the bar would jump left and grow wider the instant it
 * detached, and from lg up it would land on top of the rail.
 *
 * This wrapper is xl:hidden and the rail is lg:flex, so the two overlap in the
 * 1024px to 1279px band. That band is the only reason the rail term exists.
 * Keep in step with app/tools/on-the-clock/page.tsx and the room's body padding.
 */
const DOCK_INSET =
  "px-[2.0625rem] sm:px-[3.0625rem] lg:pr-[3.5625rem] lg:pl-[calc(var(--app-rail-w)+3.5625rem)]";

export function SidebarSheet({
  label,
  summary,
  leading,
  children,
}: {
  /** Short visible label on the bar, also the sheet's heading. */
  label: string;
  /**
   * One line naming what is inside, so the bar's accessible name says what
   * opening it gets you rather than just "Quick info, button".
   */
  summary: string;
  /**
   * A control that rides in the same docking bar, to the left of this one.
   *
   * The draft-view switcher uses it below lg. Two independently docking bars
   * would park at the same offset and cover each other, and stacking them
   * would push the room down by two bar heights, so there is one bar and the
   * pair share it. Above the width where the leading control hides itself,
   * this sheet's own button simply takes the whole row back.
   */
  leading?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Stable, and it has to be. This component re-renders on every pick in the
  // room (its children are rebuilt by the parent), and BottomSheet keys its
  // focus-and-scroll-lock effect on this identity. A fresh closure each render
  // tore that effect down and set it up again per pick, which moved focus twice
  // a pick and rewrote document.body.style.overflow twice a pick, for as long
  // as the sheet stayed open.
  const close = useCallback(() => setOpen(false), []);

  /**
   * Keep focus out from under the docked bar.
   *
   * When the browser scrolls a newly focused control into view it honours
   * scroll-padding on the scrolling element, so one declaration covers every
   * focusable in the room: the search box, the sort headers, the watchlist
   * stars, the show-more button, the trade builder. Chasing it with scroll-mt
   * per control would mean touching a dozen files and missing the next one.
   *
   * 8.5rem is the bar's bottom edge (5.5rem top plus its 3rem height), which
   * also clears the 4.5rem site header underneath it. Scoped to this
   * component's lifetime and restored on unmount, because the bar only exists
   * below xl and the padding should not outlive it.
   *
   * WCAG 2.2 AA, 2.4.11 Focus Not Obscured (Minimum).
   */
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = "8.5rem";
    return () => {
      root.style.scrollPaddingTop = previous;
    };
  }, []);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof IntersectionObserver === "undefined") return;
    const trigger = dockTopPx();
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Dock only once the bar's own slot has left the top of the viewport.
        // The boundingClientRect check is what stops it docking while the slot
        // is still BELOW the fold, which is the other way to not intersect.
        setDocked(!entry.isIntersecting && entry.boundingClientRect.top < trigger);
      },
      { rootMargin: `-${trigger}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="xl:hidden">
      {/* The slot holds the bar's height at all times, so detaching it does not
          pull the page up by 3rem under whoever is reading. */}
      <div ref={slotRef} className="h-12">
        <div
          className={docked ? `fixed inset-x-0 z-20 ${DOCK_INSET}` : "relative"}
          style={docked ? { top: `${DOCK_TOP_REM}rem` } : undefined}
        >
          <div className="flex items-stretch gap-2">
          {leading}
          <button
            type="button"
            onClick={() => setOpen(true)}
            // aria-haspopup="dialog" and nothing else. aria-expanded is a
            // disclosure property, and this content does not expand in place;
            // it opens a modal and takes focus with it. Screen readers announce
            // "collapsed" on a trigger that carries it, which is a promise about
            // layout that this button does not keep.
            aria-haspopup="dialog"
            aria-label={`${label}. ${summary}`}
            className="relative flex h-12 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-card border border-line-accent bg-surface-elevated px-4 text-left shadow-lg shadow-black/40 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 60%)",
            }}
          >
            {/* Beacon hairline, matching the room's other elevated surfaces. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <PanelRight aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
            <span aria-hidden="true" className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {label}
            </span>
            <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
          </button>
          </div>
        </div>
      </div>

      <BottomSheet
        open={open}
        onClose={close}
        label={label}
        labelledBy={headingId}
        hideAboveClass="xl:hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-semibold tracking-tight text-ink">
              {label}
            </h2>
            {/* Hidden from assistive tech on purpose: it is the tail of the
                trigger's accessible name, so a screen-reader user heard this
                exact sentence one keystroke ago. It stays visible because a
                sighted user did not. */}
            <p aria-hidden="true" className="text-xs text-ink-muted">
              {summary}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={`Close ${label}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-4 pb-4 pt-2">{children}</div>
      </BottomSheet>
    </div>
  );
}
