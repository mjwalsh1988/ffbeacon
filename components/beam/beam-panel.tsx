"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { BeamAvatar } from "@/components/beam/beam-mark";

/**
 * The Ask BEAM panel.
 *
 * Slides UP from the bottom on mobile and IN from the right on desktop, the same
 * motion as components/signal-guide/guide-panel.tsx, so the two site-wide
 * overlays behave identically: portal, focus trap, Esc, scroll lock, focus
 * restored to whatever opened it, reduced motion respected.
 *
 * ONE THING IS DELIBERATELY DIFFERENT. Once opened, the panel stays mounted and
 * is hidden with `display: none` rather than being unmounted. A conversation
 * that vanishes because someone closed the panel to look at a player page is a
 * conversation they have to retype, and the whole point of a panel over a page
 * is that the rest of the site stays reachable. `hidden` takes the whole subtree
 * out of the accessibility tree and the tab order, and `inert` says so
 * explicitly, so a closed panel is invisible to every input method while its
 * React state survives.
 */
export function BeamPanel({
  open,
  prime = false,
  onClose,
  children,
}: {
  open: boolean;
  /** Build the panel now, hidden, because the reader looks about to open it. */
  prime?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const labelId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // True from the first open onward. Nothing is rendered before that, so a
  // reader who never asks BEAM anything pays nothing for it.
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  // `prime` mounts the panel hidden, before the click. Mounting it costs a React
  // render plus a style and layout pass over the whole subtree, and doing that in
  // the same frame that starts the slide is what a click feels like when it
  // stutters. The launcher primes on hover, focus, or touchstart, so by the time
  // the click lands there is nothing left to build.
  useEffect(() => {
    if (!open && !prime) return;
    setMounted(true);
  }, [open, prime]);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setEntered(true)),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer focus until the panel is on-screen. The composer is the reason
    // anyone opened this, so that is where focus goes; the close button is the
    // fallback for a panel that somehow has no composer.
    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "[data-beam-initial-focus]",
      );
      (target ?? closeRef.current)?.focus();
    }, 90);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          // tabIndex -1 skips the learn form's off-screen honeypot, which is a
          // real input a naive trap would happily wrap focus onto.
          (el) =>
            el.tabIndex !== -1 &&
            (el.offsetParent !== null || el === document.activeElement),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Scroll lock, with the scrollbar's width handed back as padding. Hiding
    // body overflow removes the classic scrollbar, which narrows the viewport by
    // about 15px, which relayouts and repaints EVERY element on the page. On a
    // long rankings or league table that is the freeze, and it is why the page
    // also jumps sideways as the panel opens. Compensating keeps the content box
    // the same width, so nothing below reflows.
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      // Only restore focus if the previously-focused element is still in the
      // DOM. A route change can unmount the launcher while the panel is open,
      // and focusing a detached node silently drops focus to <body>.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.();
      }
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const panelTransform = entered
    ? "translate-y-0 sm:translate-x-0"
    : "translate-y-full sm:translate-y-0 sm:translate-x-full";

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={descId}
      aria-hidden={open ? undefined : true}
      inert={open ? undefined : true}
      className={`fixed inset-0 z-50 ${
        open ? "flex" : "hidden"
      } items-end justify-center sm:items-stretch sm:justify-end`}
    >
      {/* Click-away backdrop. Kept out of the tab order and the accessibility
          tree: the header close button and Esc already dismiss the panel, so a
          second control whose name only makes sense to a mouse is noise.
          A plain dim, not a backdrop blur. backdrop-filter forces the browser to
          re-rasterize everything behind the overlay, on a page that can be a
          2,000-row rankings table, and it does it on every frame of the slide.
          That is the "whole site freezes for a moment" cost, and darkening one
          shade further buys the same separation for nothing. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        style={{ willChange: "opacity" }}
        className={`absolute inset-0 transform-gpu bg-black/75 transition-opacity duration-200 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* transform-gpu plus will-change hands the slide to the compositor. A
          rounded, clipped, shadowed box this size is otherwise repainted by
          Chrome on every frame of the animation, which is main-thread work that
          lands on top of whatever the page underneath is doing. `contain` then
          walls the panel off, so typing in the composer or growing the
          transcript can never invalidate layout outside it. */}
      <div
        ref={panelRef}
        style={{ willChange: "transform", contain: "layout paint" }}
        className={`relative flex h-[88vh] w-full max-w-2xl transform-gpu flex-col overflow-hidden rounded-t-modal border border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out motion-reduce:transition-none sm:h-full sm:max-w-3xl sm:rounded-none sm:rounded-l-modal sm:border-y-0 sm:border-r-0 ${panelTransform}`}
      >
        {/* Mobile drag handle (decorative). */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span
            aria-hidden="true"
            className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
          />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-3 sm:px-5 sm:pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <BeamAvatar size={36} />
            <div className="min-w-0">
              <p id={labelId} className="text-base font-semibold text-ink">
                Ask BEAM
              </p>
              <p id={descId} className="mt-0.5 text-xs text-ink-muted">
                Answers from FF Beacon&apos;s own data
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close Ask BEAM"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
