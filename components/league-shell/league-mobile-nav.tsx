"use client";

/**
 * The small-screen half of the League Pulse rail. One full-width button naming
 * the section you are on; pressing it slides a sheet up from the bottom holding
 * every section, with the same labels and hints the desktop rail carries.
 *
 * The button sticks under the site header the moment the page scrolls past it,
 * so the menu is always one tap away rather than something you scroll back up
 * to find. A one-pixel sentinel above the bar tells us when that has happened,
 * which is what switches the bar to its docked treatment (border, shadow,
 * opaque backdrop) instead of guessing from a scroll offset.
 *
 * The sheet is a modal dialog: focus moves into it on open, Tab is kept inside
 * it, Escape closes it, and focus returns to the button that opened it. The
 * page behind it is locked from scrolling for as long as it is up.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import {
  LEAGUE_NAV_ITEMS,
  leagueTabHref,
  leagueTabLabel,
  type LeagueTabId,
} from "./nav-items";

export function LeagueMobileNav({
  sleeperLeagueId,
  activeTab,
  searchedUsername,
}: {
  sleeperLeagueId: string;
  activeTab: LeagueTabId;
  searchedUsername: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Docked state. The sentinel sits in normal flow directly above the sticky
  // bar, so it leaves the viewport at exactly the moment the bar starts to
  // stick. rootMargin accounts for the site header sitting on top of it.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setDocked(!entry.isIntersecting),
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // While the sheet is up: lock the page behind it, close on Escape, and keep
  // Tab inside the dialog.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusable = sheet.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const currentLabel = leagueTabLabel(activeTab);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px lg:hidden" />

      <div
        data-league-mobile-nav=""
        data-docked={docked ? "true" : "false"}
        className={`sticky top-[4.5rem] z-30 px-4 py-2 transition-colors duration-200 motion-reduce:transition-none sm:px-6 lg:hidden ${
          docked
            ? "border-b border-line-accent bg-base/95 shadow-lg shadow-black/50"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="flex min-h-11 w-full items-center gap-3 rounded-card border border-line-accent bg-surface px-4 py-2.5 text-left transition-colors hover:border-brand-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Menu aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-cyan" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
              League section
            </span>
            <span className="block truncate text-sm font-semibold text-ink">
              {currentLabel}
            </span>
          </span>
          <span aria-hidden="true" className="text-xs font-semibold text-brand-cyan">
            Change
          </span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Scrim. Clicking it dismisses, but it is not a focus stop: Escape
              and the labelled Close button are the keyboard paths out. */}
          <div
            aria-hidden="true"
            onClick={close}
            className="absolute inset-0 bg-black/75"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="league-sheet-title"
            className="lp-sheet absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-modal border-t border-line-accent bg-surface pb-[env(safe-area-inset-bottom)] beacon-scroll"
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-cyan">
                  League Pulse
                </p>
                <h2
                  id="league-sheet-title"
                  className="mt-0.5 text-lg font-bold tracking-tight text-ink"
                >
                  Jump to a section
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">Close the league menu</span>
              </button>
            </div>

            <nav aria-label="League sections" className="p-3">
              <ul className="space-y-2">
                {LEAGUE_NAV_ITEMS.map((item) => {
                  const isActive = item.id === activeTab;
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <Link
                        href={leagueTabHref(sleeperLeagueId, item.id, searchedUsername)}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={`flex min-h-11 items-center gap-3 rounded-card border px-3 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                          isActive
                            ? "border-brand-cyan/40 bg-brand-cyan/10"
                            : "border-line bg-base/60 hover:border-line-accent"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${
                            isActive
                              ? "border-brand-cyan/40 text-brand-cyan"
                              : "border-line text-ink-muted"
                          }`}
                        >
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm font-semibold ${
                              isActive ? "text-brand-cyan" : "text-ink"
                            }`}
                          >
                            {item.label}
                            {item.isNew && (
                              <span className="ml-2 rounded-full bg-beacon px-1.5 py-px align-middle text-[9px] font-extrabold uppercase tracking-[0.1em] text-black">
                                New
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-ink-subtle">{item.hint}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
