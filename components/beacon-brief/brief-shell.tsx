"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { PageBody } from "@/components/app-shell/page-body";

/**
 * The two-column frame every Beacon Brief surface renders inside: the listing
 * pages and the articles themselves.
 *
 * From xl the filter rail sits on the right and follows you down the page, the
 * way the League Pulse and player-profile rails do, capped at the viewport and
 * scrolling inside itself because it is longer than one. The content takes the
 * rest of the width.
 *
 * Below xl the rail collapses behind a full-width "Browse and filter" button
 * that opens a full-screen drawer, so the filter links stay real, tappable
 * navigation. THE BUTTON FOLLOWS YOU DOWN: once you have scrolled past it, it
 * re-attaches under the site header, and it lets go again when you scroll back
 * to where it lives. Same behaviour, and the same IntersectionObserver, as the
 * draft room's Quick info bar; see app/tools/on-the-clock/sidebar-sheet.tsx.
 *
 * The drawer closes on route change, on Escape, and on the close button,
 * restoring focus to the trigger.
 *
 * `sidebar` is rendered server-side and passed in as a node, so the same markup
 * serves the desktop rail and the drawer.
 */

/** Where the docked bar parks: the 4.5rem site header, plus breathing room. */
const DOCK_TOP_REM = 5.5;

/**
 * The trigger line in pixels, read from the document rather than assumed to be
 * 16 per rem. The bar's own `top` is in rem, so it scales with the reader's font
 * size, and a hardcoded 88px would leave a band on exactly the setups this
 * product exists for where the bar has slid under the header and not yet docked.
 */
function dockTopPx(): number {
  if (typeof window === "undefined") return DOCK_TOP_REM * 16;
  const root = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return DOCK_TOP_REM * (Number.isFinite(root) && root > 0 ? root : 16);
}

/**
 * Lines the docked bar up with where it sits in the flow. Two things pad it
 * there: the page shell (px-4 / sm:px-6 / lg:px-8) and, from lg, the navigation
 * rail, whose width is whatever the reader last set it to.
 *
 * This wrapper is xl:hidden and the rail is lg:flex, so the two overlap between
 * 1024px and 1279px. That band is the only reason the rail term exists.
 */
const DOCK_INSET =
  "px-4 sm:px-6 lg:pr-8 lg:pl-[calc(var(--app-rail-w)+2rem)]";

export function BriefShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [docked, setDocked] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const labelId = useId();

  useEffect(() => setMounted(true), []);

  // Close the drawer whenever navigation completes (a filter link was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof IntersectionObserver === "undefined") return;
    const trigger = dockTopPx();
    const observer = new IntersectionObserver(
      ([entry]) => {
        const box = entry.boundingClientRect;
        // Three things have to be true. The slot is not intersecting; it left
        // through the TOP rather than being below the fold (that is the other
        // way to not intersect); and it is actually laid out, because from xl
        // the slot is display:none, and a hidden element reports a zero box that
        // otherwise reads as "scrolled past".
        setDocked(!entry.isIntersecting && box.height > 0 && box.top < trigger);
      },
      { rootMargin: `-${trigger}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  /**
   * Keep focus out from under the docked bar.
   *
   * When the browser scrolls a newly focused control into view it honours
   * scroll-padding on the scrolling element, so one declaration covers every
   * link in the feed and every control in an article. 8.5rem is the bar's bottom
   * edge (5.5rem top plus its 2.75rem height), which also clears the 4.5rem site
   * header underneath it. It lasts exactly as long as the bar is docked.
   *
   * WCAG 2.2 AA, 2.4.11 Focus Not Obscured (Minimum).
   */
  useEffect(() => {
    if (!docked) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = "8.5rem";
    return () => {
      root.style.scrollPaddingTop = previous;
    };
  }, [docked]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "Tab" && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open]);

  return (
    <PageBody>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* The slot holds the bar's height at all times, so detaching it does
              not pull the page up under whoever is reading. */}
          <div ref={slotRef} className="mb-5 h-11 xl:hidden">
            <div
              className={docked ? `fixed inset-x-0 z-20 ${DOCK_INSET}` : "relative"}
              style={docked ? { top: `${DOCK_TOP_REM}rem` } : undefined}
            >
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(true)}
                // aria-haspopup="dialog" and nothing else. aria-expanded is a
                // disclosure property, and this does not expand in place; it
                // opens a modal and takes focus with it.
                aria-haspopup="dialog"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface-elevated px-4 text-sm font-semibold text-ink shadow-lg shadow-black/40 transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                Browse and filter
              </button>
            </div>
          </div>

          {children}
        </div>

        {/* The rail. Hidden below xl, where the drawer above carries the same
            markup, because rendering both would put two copies of every filter
            link and every heading id in the document. */}
        <aside
          aria-label="Beacon Brief filters"
          // Focusable so the scroll inside it is reachable from the keyboard.
          tabIndex={0}
          className="beacon-scroll hidden xl:sticky xl:top-[5.5rem] xl:block xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
        >
          {sidebar}
        </aside>
      </div>

      {/* Below xl: the same rail, full screen. */}
      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className="fixed inset-0 z-[70] flex flex-col bg-base xl:hidden"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
              <h2
                id={labelId}
                className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
              >
                Browse The Beacon Brief
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <div
              ref={drawerRef}
              className="beacon-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5"
            >
              {sidebar}
            </div>
          </div>,
          document.body,
        )}
    </PageBody>
  );
}
