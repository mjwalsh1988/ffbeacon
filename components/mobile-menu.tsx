"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRIMARY_NAV } from "@/lib/site";
import type { FormatLike } from "@/lib/format-fallback";
import { FormatToggle, type FormatOption } from "@/components/format-toggle";
import { SourceToggle, type SourceOption } from "@/components/source-toggle";
import {
  InfoTooltip,
  SOURCE_INFO_TOOLTIP,
  FORMAT_INFO_TOOLTIP,
} from "@/components/info-tooltip";

export function MobileMenu({
  formats,
  initialFormatSlug,
  sources,
  initialSourceSlug,
  isAuthenticated,
  isAdmin,
  allFormats,
  supportedFormatSlugs,
}: {
  formats: FormatOption[];
  initialFormatSlug: string | null;
  sources: SourceOption[];
  initialSourceSlug: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  allFormats: FormatLike[];
  supportedFormatSlugs: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const labelId = useId();

  // SSR-safe portal: we only have a `document` after hydration. Setting this
  // once on mount lets the open-state JSX render via createPortal into
  // document.body, which is required so the overlay escapes the sticky
  // <header>'s z-30 stacking context (otherwise page hero text paints over it).
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

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
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [open]);

  return (
    <>
      {/* `header-edge-right`: this is the last control in the header row on
          small screens, so its right side rounds to match the header pill's
          curve once the header condenses on scroll (see globals.css). */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
        className="header-edge-right inline-flex h-9 w-9 items-center justify-center rounded-card border border-line bg-surface text-ink hover:border-line-accent md:hidden"
      >
        <span aria-hidden="true">☰</span>
      </button>
      {open && mounted && createPortal(
        <div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className="fixed inset-0 z-[60] flex md:hidden"
        >
          <button
            type="button"
            aria-label="Close menu overlay"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <div
            ref={dialogRef}
            className="relative ml-auto flex h-full w-80 max-w-full flex-col bg-surface-elevated p-6"
          >
            <div className="mb-6 flex shrink-0 items-center justify-between">
              <h2 id={labelId} className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
                Menu
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line text-ink hover:border-line-accent"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            {/* Scroll the nav + controls if they outgrow the drawer (small
                screens, long nav, on-screen keyboard). Header stays pinned.
                Negative margin keeps the scrollbar at the drawer edge while
                preserving the panel's padding. */}
            <div className="beacon-scroll -mx-6 flex min-h-0 flex-1 flex-col overflow-y-auto px-6">
            <nav
              aria-label="Mobile primary"
              className="flex flex-col divide-y divide-line/60 border-y border-line/60"
            >
              {PRIMARY_NAV.map((item) => {
                const active =
                  pathname === item.href ||
                  (pathname?.startsWith(`${item.href}/`) ?? false);
                const hasChildren = Boolean(
                  item.children && item.children.length > 0,
                );
                return (
                  <div key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center px-3 py-3.5 text-base transition-colors ${
                        active
                          ? "border-l-2 border-l-brand-purple bg-surface text-ink"
                          : "border-l-2 border-l-transparent text-ink-muted hover:bg-surface hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </Link>
                    {hasChildren && (
                      <ul
                        role="list"
                        aria-label={`${item.label} pages`}
                        className="flex flex-col pb-2"
                      >
                        {item.children!.map((child) => {
                          const childActive =
                            pathname === child.href ||
                            (pathname?.startsWith(`${child.href}/`) ?? false);
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                aria-current={childActive ? "page" : undefined}
                                className={`flex min-h-11 items-center py-2.5 pl-7 pr-3 text-sm transition-colors ${
                                  childActive
                                    ? "border-l-2 border-l-brand-cyan bg-surface text-ink"
                                    : "border-l-2 border-l-transparent text-ink-muted hover:bg-surface hover:text-ink"
                                }`}
                              >
                                {child.label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </nav>
            <div className="mt-auto space-y-4 border-t border-line pt-6">
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <InfoTooltip
                    content={SOURCE_INFO_TOOLTIP}
                    placement="below"
                    align="start"
                  />
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Source
                  </p>
                </div>
                <SourceToggle
                  options={sources}
                  initialSlug={initialSourceSlug}
                  currentFormatSlug={initialFormatSlug}
                  allFormats={allFormats}
                  placement="above"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <InfoTooltip
                    content={FORMAT_INFO_TOOLTIP}
                    placement="below"
                    align="start"
                  />
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Format
                  </p>
                </div>
                <FormatToggle
                  options={formats}
                  initialSlug={initialFormatSlug}
                  supportedFormatSlugs={supportedFormatSlugs}
                  placement="above"
                />
              </div>
              <div className="space-y-3">
                {isAuthenticated ? (
                  <>
                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="block rounded-card border border-brand-purple/50 bg-brand-purple/10 px-3 py-3 text-center text-sm font-semibold text-ink"
                      >
                        Admin
                      </Link>
                    )}
                    {/* Primary accent action, visually distinct from
                        Sign out so users tap "My Beacon" by mistake far
                        less often. */}
                    <Link
                      href="/my-beacon"
                      className="block rounded-card bg-beacon px-3 py-3 text-center text-sm font-semibold text-black"
                    >
                      My Beacon
                    </Link>
                    <form action="/auth/signout" method="post">
                      <button
                        type="submit"
                        className="w-full rounded-card border border-line bg-surface px-3 py-3 text-sm font-medium hover:border-line-accent"
                      >
                        Sign out
                      </button>
                    </form>
                  </>
                ) : (
                  <Link
                    href="/login"
                    className="block rounded-card bg-beacon px-3 py-3 text-center text-sm font-semibold text-black"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
