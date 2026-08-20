"use client";

/**
 * The small-screen half of the navigation rail: a trigger in the header that
 * slides a drawer in from the left holding the same section tree, with the same
 * two-level behaviour, plus the format and source controls that live in the
 * header popover on desktop and the sign-in state.
 *
 * Rendered through a portal into <body> so the drawer escapes the sticky
 * header's stacking context. As a modal dialog it takes focus on open, keeps
 * Tab inside itself, closes on Escape, restores focus to its trigger, and locks
 * the page behind it from scrolling.
 *
 * Nothing here is exclusive to the small layout: every link, toggle, and action
 * in this drawer also exists in the desktop rail or the desktop header.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { findActiveTrail, type NavNode, type NavViewer } from "@/lib/nav-types";
import type { FormatLike } from "@/lib/format-fallback";
import { FormatToggle, type FormatOption } from "@/components/format-toggle";
import { SourceToggle, type SourceOption } from "@/components/source-toggle";
import {
  InfoTooltip,
  SOURCE_INFO_TOOLTIP,
  FORMAT_INFO_TOOLTIP,
} from "@/components/info-tooltip";
import { NavLevels } from "./nav-levels";
import { useSidebar } from "./sidebar-state";
import { mergeRailSections, useRailSections } from "./rail-sections";

export function AppMobileNav({
  sections,
  viewer,
  formats,
  initialFormatSlug,
  sources,
  initialSourceSlug,
  allFormats,
  supportedFormatSlugs,
}: {
  /** The site sections this viewer can reach, already filtered on the server. */
  sections: NavNode[];
  viewer: NavViewer;
  formats: FormatOption[];
  initialFormatSlug: string | null;
  sources: SourceOption[];
  initialSourceSlug: string | null;
  allFormats: FormatLike[];
  supportedFormatSlugs: string[] | null;
}) {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname() ?? "/";
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const { extra, openId, active } = useRailSections();
  const tree = mergeRailSections(extra, sections);
  const trail = findActiveTrail(tree, pathname);

  // SSR-safe portal: there is no `document` until hydration.
  useEffect(() => setMounted(true), []);

  // A route change means the reader has arrived somewhere; the drawer's work
  // is done.
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // A second level showing inside the drawer owns Escape first: it steps
        // back to the main menu rather than closing the whole drawer. Only when
        // level one is showing does Escape dismiss.
        if (dialogRef.current?.querySelector('[data-level="2"][data-state="current"]')) {
          return;
        }
        event.preventDefault();
        setMobileOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.closest("[inert]"));
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
  }, [mobileOpen, setMobileOpen]);

  const drawer = (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        aria-hidden="true"
        onClick={() => {
          setMobileOpen(false);
          triggerRef.current?.focus();
        }}
        className="absolute inset-0 bg-black/75"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-drawer-title"
        className="app-drawer absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-line-accent bg-surface"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-px"
          style={{
            backgroundImage:
              "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-cyan">
              FF Beacon
            </p>
            <h2
              id="app-drawer-title"
              className="mt-0.5 text-lg font-bold tracking-tight text-ink"
            >
              Browse the site
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => {
              setMobileOpen(false);
              triggerRef.current?.focus();
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-5 w-5" />
            <span className="sr-only">Close the navigation menu</span>
          </button>
        </div>

        {/* The nav levels need a box with a height to slide inside. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <NavLevels
            tree={tree}
            activeSectionId={trail.sectionId}
            activeChildId={trail.childId}
            contributedActive={active}
            variant="drawer"
            label="Site sections"
            onNavigate={() => {
              setMobileOpen(false);
              // Every other way out of this drawer puts focus back on the
              // trigger, and a row press has to as well. A row that navigates
              // hands focus to the new page a moment later, and a row that
              // switches a view in place moves focus to what it revealed, but
              // neither is guaranteed, and landing on <body> is the worst
              // outcome available.
              triggerRef.current?.focus();
            }}
            defaultOpenId={openId}
          />
        </div>

        {/* Scrolls on its own so it can never push the section tree off the
            bottom of the drawer. The cap is generous because the source and
            format lists expand into this box: it only grows that tall when one
            of them is open, and the section tree above shrinks and keeps its
            own scrollbar. */}
        <div className="shrink-0 space-y-3 border-t border-line px-4 py-4 beacon-scroll max-h-[60vh] overflow-y-auto">
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">
              Data source
              <InfoTooltip content={SOURCE_INFO_TOOLTIP} placement="below" align="start" />
            </p>
            <SourceToggle
              options={sources}
              initialSlug={initialSourceSlug}
              currentFormatSlug={initialFormatSlug}
              allFormats={allFormats}
              placement="inline"
            />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted">
              League format
              <InfoTooltip content={FORMAT_INFO_TOOLTIP} placement="below" align="start" />
            </p>
            <FormatToggle
              options={formats}
              initialSlug={initialFormatSlug}
              supportedFormatSlugs={supportedFormatSlugs}
              placement="inline"
            />
          </div>
          {viewer.isAuthenticated ? (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex min-h-11 w-full items-center justify-center rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-3 text-sm font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-haspopup="dialog"
        // 44x44: below lg this button is the whole navigation of the site.
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base/60 text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan lg:hidden"
      >
        <Menu aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">Open the navigation menu</span>
      </button>
      {mounted && mobileOpen ? createPortal(drawer, document.body) : null}
    </>
  );
}
