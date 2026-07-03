"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

/**
 * Two-column shell for The Beacon Brief list pages. On large screens the filter
 * rail sits inline on the left as a sticky column. On small screens it collapses
 * behind a full-width "Browse and filter" button that opens a full-screen drawer
 * (so the filter links stay real, tappable navigation). The drawer closes on
 * route change, Escape, and the close button, restoring focus to the trigger.
 *
 * `sidebar` is rendered server-side and passed in as a node, so the same markup
 * serves both the desktop rail and the mobile drawer.
 */
export function BriefShell({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const labelId = useId();

  useEffect(() => setMounted(true), []);

  // Close the drawer whenever navigation completes (a filter link was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        {/* Desktop rail */}
        <aside className="hidden lg:block" aria-label="Beacon Brief filters">
          <div className="beacon-scroll sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1">
            {sidebar}
          </div>
        </aside>

        <div className="min-w-0">
          {/* Mobile trigger */}
          <div className="mb-5 lg:hidden">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
              Browse and filter
            </button>
          </div>

          {children}
        </div>
      </div>

      {/* Mobile full-screen drawer */}
      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className="fixed inset-0 z-[70] flex flex-col bg-base lg:hidden"
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
                className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
    </div>
  );
}
