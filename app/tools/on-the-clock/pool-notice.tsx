"use client";

/**
 * One-time player-pool notice. When a draft room opens, this modal explains in
 * plain English which league type was detected and which player pool the room
 * is therefore showing ("Looks like this is a dynasty rookie draft, so we are
 * showing rookies only."). The pool is inferred automatically (no manual
 * toggle), so this is the user's window into WHY the pool is what it is.
 *
 * Anti-annoyance: shown once per draft (localStorage-keyed), dismissible by
 * button, Escape, or backdrop click. Accessible dialog semantics: role=dialog,
 * aria-modal, labelled title, focus moves to the dialog on open and returns to
 * the previously focused element on close, focus is trapped while open.
 */

import { useCallback, useEffect, useRef } from "react";
import { Users, Baby } from "lucide-react";

const STORAGE_PREFIX = "ffbeacon.otc.pool-notice.";

/** True when this draft's notice has already been shown on this device. */
export function poolNoticeSeen(draftId: string): boolean {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${draftId}`) === "1";
  } catch {
    return true; // storage unavailable: err on the quiet side
  }
}

export function markPoolNoticeSeen(draftId: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${draftId}`, "1");
  } catch {
    // Storage unavailable; the notice may show again next time. Harmless.
  }
}

export function PoolNotice({
  open,
  pool,
  message,
  formatLabel,
  onClose,
  onReportFormat,
}: {
  open: boolean;
  pool: "everyone" | "rookies";
  /** Plain-English explanation from describeInferredPool. */
  message: string;
  /** Detected FF Beacon format label, shown as supporting context. */
  formatLabel: string;
  onClose: () => void;
  /** Opens the "report incorrect format" dialog. Omit to hide the report link. */
  onReportFormat?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus management: remember the opener, focus the dialog, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      // Focus trap: cycle Tab within the dialog's focusable elements (the confirm
      // button plus the optional "report incorrect format" link).
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  const Icon = pool === "rookies" ? Baby : Users;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop (click closes; decorative). */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="otc-pool-notice-title"
        aria-describedby="otc-pool-notice-body"
        className="relative w-full max-w-md overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-5 shadow-[0_0_80px_-30px_rgba(168,85,247,0.55)] sm:p-6"
      >
        {/* Beacon hairline, matching the cockpit shells. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              Player pool detected
            </p>
            <h2 id="otc-pool-notice-title" className="mt-1 text-lg font-semibold tracking-tight text-ink">
              {pool === "rookies" ? "Showing rookies only" : "Showing all players"}
            </h2>
          </div>
        </div>
        <div id="otc-pool-notice-body" className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
          <p>{message}</p>
          <p className="text-xs text-ink-subtle">
            Detected format: <span className="font-medium text-ink">{formatLabel}</span>. The pool
            is set automatically from your Sleeper league and draft settings.
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            Got it
          </button>
          {onReportFormat && (
            <button
              type="button"
              onClick={onReportFormat}
              className="inline-flex min-h-11 items-center justify-center rounded-card px-1 text-xs font-medium text-ink-subtle underline decoration-dotted underline-offset-4 transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Wrong format? Report it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
