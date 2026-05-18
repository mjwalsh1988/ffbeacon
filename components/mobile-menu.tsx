"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRIMARY_NAV } from "@/lib/site";
import type { FormatLike } from "@/lib/format-fallback";
import { ThemeToggle } from "@/components/theme-toggle";
import { FormatToggle, type FormatOption } from "@/components/format-toggle";
import { SourceToggle, type SourceOption } from "@/components/source-toggle";

export function MobileMenu({
  formats,
  initialFormatSlug,
  sources,
  initialSourceSlug,
  isAuthenticated,
  allFormats,
  supportedFormatSlugs,
}: {
  formats: FormatOption[];
  initialFormatSlug: string | null;
  sources: SourceOption[];
  initialSourceSlug: string | null;
  isAuthenticated: boolean;
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
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line bg-surface text-ink hover:border-line-accent md:hidden"
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
            className="absolute inset-0 bg-black/70"
          />
          <div
            ref={dialogRef}
            className="relative ml-auto flex h-full w-80 max-w-full flex-col bg-surface-elevated p-6"
          >
            <div className="mb-6 flex items-center justify-between">
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
            <nav aria-label="Mobile primary" className="flex flex-col gap-1">
              {PRIMARY_NAV.map((item) => {
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-card px-3 py-3 text-base ${
                      active
                        ? "bg-surface text-ink"
                        : "text-ink-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto space-y-4 border-t border-line pt-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Source
                </p>
                <SourceToggle
                  options={sources}
                  initialSlug={initialSourceSlug}
                  currentFormatSlug={initialFormatSlug}
                  allFormats={allFormats}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Format
                </p>
                <FormatToggle
                  options={formats}
                  initialSlug={initialFormatSlug}
                  supportedFormatSlugs={supportedFormatSlugs}
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Theme
                </p>
                <ThemeToggle />
              </div>
              <div>
                {isAuthenticated ? (
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      className="w-full rounded-card border border-line bg-surface px-3 py-3 text-sm font-medium hover:border-line-accent"
                    >
                      Sign out
                    </button>
                  </form>
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
        </div>,
        document.body,
      )}
    </>
  );
}
