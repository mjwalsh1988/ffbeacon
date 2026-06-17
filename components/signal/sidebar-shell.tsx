"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";

/**
 * Layout B (sidebar) shell. Owns the two-column desktop layout AND the mobile
 * "Profile info" drawer, so the secondary sidebar blocks (about, text, links,
 * favorites) render exactly once. Rendering them twice (a desktop aside plus a
 * mobile drawer toggled with CSS) would put duplicate hard-coded ids in the DOM
 * (signal-favorites-heading, signal-links-heading, ...) and break the
 * aria-labelledby links, so we switch the whole subtree by mount state instead.
 *
 * PROGRESSIVE ENHANCEMENT (hidden-but-accessible): on the server and the first
 * client render, and whenever JS is unavailable, we render the inline
 * two-column tree exactly as Phase 5 did. The sidebar stacks below the main
 * column on small screens, so nothing is ever hidden without JS. After mount,
 * at the compact breakpoint (below lg, where the grid already collapses to one
 * column), the sidebar collapses into a labeled, focus-trapped drawer reachable
 * from a top-bar trigger. Desktop (lg and up) is unchanged.
 *
 * The drawer reuses the proven mobile-menu focus model: portal to document.body
 * (so it escapes the page stacking context), role="dialog" + aria-modal, a Tab
 * focus trap, Escape to close, body scroll lock, and focus return to the
 * trigger on close. Read-only public page: announcement is carried by the
 * dialog semantics and the focus move, so there is no aria-live region here and
 * nothing double-announces.
 */
export function SidebarShell({
  main,
  sidebar,
}: {
  /** The main column: board/league blocks followed by the fixed Wall. */
  main: ReactNode;
  /** The secondary blocks. Caller guarantees this is non-empty. */
  sidebar: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  // Track the compact breakpoint. The grid goes single-column below lg
  // (lg:grid-cols-[2fr_1fr]), so the drawer takes over at exactly that width.
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // If the viewport grows back to desktop while the drawer is open, close it so
  // the inline aside takes over cleanly.
  useEffect(() => {
    if (!isCompact && open) setOpen(false);
  }, [isCompact, open]);

  // Drive the open transition. Two-frame defer so the off-screen start state
  // paints before we slide in (the slide itself is motion-safe only).
  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const raf = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setEntered(true)),
    );
    return () => window.cancelAnimationFrame(raf);
  }, [open]);

  // Focus trap, Escape, scroll lock, focus return (mobile-menu model). Focus is
  // deferred until the panel is on screen so a screen reader does not land on an
  // off-screen tree.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 80);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Desktop, SSR, and no-JS: the unchanged Phase 5 two-column layout. The aside
  // stacks below the main column on small screens, so the sidebar is always
  // reachable without JS.
  if (!mounted || !isCompact) {
    return (
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <div>{main}</div>
        <aside aria-label="More about this profile">{sidebar}</aside>
      </div>
    );
  }

  // Compact with JS: a top-bar trigger over a clean single main column, with the
  // sidebar blocks collapsed into the drawer.
  return (
    <div>
      <div className="mb-6">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="profile-info-panel"
          aria-label="Open profile info"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Menu aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Profile info
          <span className="ml-auto text-xs text-ink-muted">Bio, links, and more</span>
        </button>
      </div>

      <div>{main}</div>

      {open &&
        createPortal(
          <div
            id="profile-info-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            className="fixed inset-0 z-[60] flex"
          >
            <button
              type="button"
              aria-label="Close profile info overlay"
              onClick={() => setOpen(false)}
              className={`absolute inset-0 bg-black/60 backdrop-blur-md motion-safe:transition-opacity motion-safe:duration-200 ${
                entered ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={dialogRef}
              className={`relative ml-auto flex h-full w-80 max-w-full flex-col overflow-y-auto bg-surface-elevated p-6 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out ${
                entered ? "translate-x-0" : "translate-x-full"
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id={labelId}
                  className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
                >
                  Profile info
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close profile info"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-card border border-line text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              {sidebar}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
