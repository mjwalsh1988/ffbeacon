"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Responsive side panel. On desktop it slides in from the right edge as a
 * full-height drawer (Google-style detail panel); on mobile it slides up from
 * the viewport bottom as a rounded sheet, matching the app's usual modal
 * behavior. Dims the page behind, traps focus, locks body scroll, and closes on
 * Esc, backdrop tap, or the header close button. The visible header title
 * doubles as the accessible name via aria-labelledby.
 *
 * The single element carries both transforms: mobile animates translateY,
 * desktop (sm+) resets translateY and animates translateX instead, so one
 * component covers both breakpoints. Animation is skipped under reduced motion.
 */
/**
 * Desktop width. Mobile is full width either way, so this only changes the
 * drawer. `lg` exists for panels holding a table, where 28rem forces a name and
 * a number onto separate lines for no reason.
 */
const DESKTOP_WIDTH = {
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
} as const;

export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Visible header title, also the dialog's accessible name. */
  title: string;
  subtitle?: string;
  size?: keyof typeof DESKTOP_WIDTH;
  children: ReactNode;
}) {
  const labelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    // Two-frame defer so the off-screen transform paints before we flip it.
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
    const focusTimer = window.setTimeout(() => {
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusables?.[0]?.focus();
    }, 80);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
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
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end"
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        className={`relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-modal border-x border-t border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out motion-reduce:transition-none sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-modal sm:border-x-0 sm:border-t-0 sm:border-l ${DESKTOP_WIDTH[size]} ${
          entered
            ? "translate-x-0 translate-y-0"
            : "translate-y-full sm:translate-y-0 sm:translate-x-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Mobile drag handle. */}
        <div className="flex shrink-0 justify-center pt-2 sm:hidden">
          <span
            aria-hidden="true"
            className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
          />
        </div>

        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="min-w-0">
            <h2
              id={labelId}
              className="truncate text-lg font-bold tracking-tight text-ink"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 rounded-card border border-line p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
