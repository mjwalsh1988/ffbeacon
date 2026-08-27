"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Responsive slide-up dialog. Mobile slides up from the viewport bottom
 * (full-width, rounded top corners). Desktop centers in the viewport
 * (constrained width, fully rounded) but reuses the same slide-up
 * animation so the visual language stays consistent across breakpoints.
 *
 * Differs from {@link BottomSheet} only in viewport behavior, kept as a
 * separate component so existing mobile-only callers aren't accidentally
 * promoted to desktop. Wire your own header/content/footer inside.
 *
 * A close button in the top-right corner comes as standard. Escape and a
 * backdrop tap both close the dialog too, but neither is visible, and a drag
 * handle is a hint rather than a control. Callers that draw their own close
 * button inside a header of their own pass `showClose={false}` so there is
 * exactly one.
 *
 * WHY `onClose` LIVES IN A REF
 *   The focus effect below moves focus in on mount and hands it back to the
 *   opener on cleanup. If `onClose` were in its deps, every parent re-render
 *   that produced a fresh handler identity would tear the effect down and set
 *   it up again, and the cleanup would fire `previouslyFocused.focus()` while
 *   the dialog was still open. Focus would land on the button BEHIND the modal
 *   and then get dragged to the first focusable inside it 80ms later.
 *
 *   That is not hypothetical. Callers pass `onClose={() => setThing(null)}`,
 *   an inline arrow, and any `useState` in the parent re-renders it: a select
 *   inside the dialog updating the parent's pending choice was enough to yank
 *   focus off that select mid-interaction, so the next Enter hit the close
 *   button instead. WCAG 2.4.3 and 3.2.2 both.
 *
 *   Holding the handler in a ref means the deps are `[open]` alone and the
 *   effect runs exactly twice per dialog, on open and on close, whatever the
 *   parent does. Memoizing the caller's handler fixes one caller; this fixes
 *   all of them. Do not put `onClose` back in the dep array.
 */
export function SlideUpDialog({
  open,
  onClose,
  label,
  labelledBy,
  showClose = true,
  closeLabel = "Close",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Surfaced via an sr-only span +
   * aria-labelledby on the container. Ignored when `labelledBy` is given. */
  label: string;
  /**
   * The id of a heading inside `children` to name the dialog with, instead of
   * the sr-only span.
   *
   * Pass it whenever the dialog already draws a visible heading. Without it the
   * reader hears the dialog's name and then immediately hears the heading
   * saying much the same thing, which is two announcements for one fact. The
   * `label` prop stays required so a caller cannot end up with an unnamed
   * dialog by passing an id that does not resolve.
   */
  labelledBy?: string;
  /**
   * Set false only when `children` already renders its own close button. The
   * default is on, so a dialog that forgets to draw one still has a way out
   * that is visible on the screen.
   */
  showClose?: boolean;
  /** Accessible name for the built-in close button. */
  closeLabel?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  // Read by the Escape handler and the backdrop, never by a dep array. See the
  // note above the component for what putting it back in one costs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    // Two-frame defer ensures the initial `translate-y-full` paints before
    // we flip to `translate-y-0`, so the user actually sees the slide.
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
    // Wait for the sheet to be visible before moving focus: focusing into
    // an off-screen panel confuses screen readers.
    const focusTimer = window.setTimeout(() => {
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusables?.[0]?.focus();
    }, 80);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab" && sheetRef.current) {
        const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!mounted || !open) return null;

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? labelId}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
    >
      {!labelledBy && (
        <span id={labelId} className="sr-only">
          {label}
        </span>
      )}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={sheetRef}
        className={`relative flex w-full max-w-2xl flex-col rounded-t-modal border-x border-t border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-modal sm:border ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
          // Pull desktop view slightly above center so it doesn't fight the
          // viewport's vertical centroid, feels more "modal" than "panel".
          maxHeight: "min(90vh, 720px)",
        }}
      >
        {/* Top bar: drag handle centred on mobile, close button on the right
            at every width. The spacer on the left is what keeps the handle
            centred against the button's width without absolute positioning. */}
        {showClose ? (
          <div className="flex shrink-0 items-center gap-2 px-2 pb-1 pt-2">
            <span aria-hidden="true" className="h-11 w-11 shrink-0 sm:hidden" />
            <span
              aria-hidden="true"
              className="mx-auto h-1.5 w-12 rounded-full bg-beacon opacity-60 sm:hidden"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:ml-auto"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 justify-center pt-2 sm:hidden">
            <span
              aria-hidden="true"
              className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
            />
          </div>
        )}
        {/* Scroll content that outgrows the capped panel height. Callers that
            manage their own internal scroll (fixed header + scrollable body)
            still work: their region caps smaller, so this wrapper stays put. */}
        <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
