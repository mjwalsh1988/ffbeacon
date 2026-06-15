"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

/**
 * Accessible confirmation dialog. On desktop it pops as a centered modal; on
 * mobile it slides up from the bottom as a sheet. Follows the WAI-ARIA dialog
 * pattern: role="dialog", aria-modal, labelled + described by its title and
 * body, focus moved in on open and restored on close, focus trapped on Tab,
 * Escape and backdrop click cancel.
 *
 * Render it only when you want it shown (parent controls `open` via state).
 * Entrance and exit are animated; the exit runs before `onCancel`/`onConfirm`
 * fire so the parent can unmount after the animation.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  icon: Icon,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  icon?: LucideIcon;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  // Portal needs a document; only available after hydration.
  useEffect(() => setMounted(true), []);

  // Animate in on mount, lock scroll, move + trap focus, restore on unmount.
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => setShown(true));
    confirmRef.current?.focus();
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(onCancel);
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
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

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
    // We intentionally only run this on mount; close() is stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Play the exit animation, then invoke the chosen callback.
  const close = (cb: () => void) => {
    setShown(false);
    window.setTimeout(cb, 180);
  };

  if (!mounted) return null;

  const accent =
    tone === "danger"
      ? "border-signal-danger/40 bg-signal-danger/10 text-signal-danger"
      : "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
  const confirmClass =
    tone === "danger"
      ? "bg-signal-danger text-white hover:opacity-90"
      : "bg-beacon text-black hover:opacity-90";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={() => close(onCancel)}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={dialogRef}
        className={`relative w-full max-w-md rounded-t-modal border border-line bg-surface-elevated p-6 shadow-2xl shadow-black/50 sm:rounded-modal motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out ${
          shown
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "translate-y-full opacity-0 sm:translate-y-2 sm:scale-95"
        }`}
      >
        <div className="flex items-start gap-4">
          {Icon && (
            <span
              aria-hidden="true"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-card border ${accent}`}
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            <div id={descId} className="mt-1.5 text-sm leading-relaxed text-ink-muted">
              {description}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => close(onCancel)}
            className="inline-flex h-11 w-full items-center justify-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => close(onConfirm)}
            className={`inline-flex h-11 w-full items-center justify-center rounded-card px-4 text-sm font-semibold transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
