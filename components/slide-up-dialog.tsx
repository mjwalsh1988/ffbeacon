"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Responsive slide-up dialog. Mobile slides up from the viewport bottom
 * (full-width, rounded top corners). Desktop centers in the viewport
 * (constrained width, fully rounded) but reuses the same slide-up
 * animation so the visual language stays consistent across breakpoints.
 *
 * Differs from {@link BottomSheet} only in viewport behavior — kept as a
 * separate component so existing mobile-only callers aren't accidentally
 * promoted to desktop. Wire your own header/content/footer inside.
 */
export function SlideUpDialog({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Surfaced via an sr-only span +
   * aria-labelledby on the container. */
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

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
    // Wait for the sheet to be visible before moving focus — focusing into
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
        onClose();
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
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={sheetRef}
        className={`relative flex w-full max-w-2xl flex-col rounded-t-modal border-x border-t border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out sm:rounded-modal sm:border ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
          // Pull desktop view slightly above center so it doesn't fight the
          // viewport's vertical centroid — feels more "modal" than "panel".
          maxHeight: "min(90vh, 720px)",
        }}
      >
        <div className="flex shrink-0 justify-center pt-2 sm:hidden">
          <span
            aria-hidden="true"
            className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
          />
        </div>
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
