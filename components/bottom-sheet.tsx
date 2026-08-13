"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * What the focus trap counts as tabbable. Form fields are in the list because
 * leaving them out is a trap-escape bug waiting for the first sheet that holds
 * an input, not because any sheet holds one today.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mobile-first bottom-sheet modal. Slides up from the viewport bottom, dims
 * the page behind, traps focus, closes on Esc or backdrop tap. Designed to
 * match the FF Beacon palette: dark surface with a beacon-gradient drag
 * handle on top.
 *
 * Render-time gated to a breakpoint so it never appears on desktop layouts,
 * desktop callers should provide a parallel UI (table cell, hover popover,
 * etc.) for the same content. The gate defaults to `md:hidden`; pass
 * `hideAboveClass` when the parallel desktop UI appears at a different width.
 *
 * Usage:
 *   <BottomSheet open={open} onClose={...} label="Player details">
 *     ...content...
 *   </BottomSheet>
 */
export function BottomSheet({
  open,
  onClose,
  label,
  labelledBy,
  hideAboveClass = "md:hidden",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog (passed via aria-labelledby on the
   * sheet, applied to an sr-only span). Ignored when `labelledBy` is given. */
  label: string;
  /**
   * Id of a heading already inside `children` to name the dialog with. Prefer
   * this whenever the sheet has a visible title: without it the same words are
   * announced twice, once from the hidden name span and again from the heading.
   */
  labelledBy?: string;
  /**
   * Tailwind class that hides the sheet at and above the width where the
   * caller's parallel desktop UI takes over, e.g. "xl:hidden" for a layout
   * whose side rail only appears at xl.
   */
  hideAboveClass?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    const raf = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer focus until after the panel has mounted; otherwise the focus
    // jump happens before the sheet is visible and screen readers get a
    // stale tree.
    const focusTimer = window.setTimeout(() => {
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      focusables?.[0]?.focus();
    }, 60);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab" && sheetRef.current) {
        const focusables = sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
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
      // Only if it is still in the document. When a breakpoint change unmounts
      // the sheet and its trigger together, focusing the removed node silently
      // dumps focus on <body> and the reader loses their place entirely.
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.();
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const portal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? labelId}
      className={`fixed inset-0 z-50 flex items-end justify-center ${hideAboveClass}`}
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
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={sheetRef}
        className={`relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-t-modal border-x border-t border-line bg-surface-elevated shadow-2xl shadow-black/60 transition-transform duration-300 ease-out motion-reduce:transition-none ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex shrink-0 justify-center pt-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-12 rounded-full bg-beacon opacity-60"
          />
        </div>
        {/* Scroll the content if it outgrows the sheet so nothing is clipped
            below the viewport. The drag handle above stays pinned. */}
        <div className="beacon-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}
