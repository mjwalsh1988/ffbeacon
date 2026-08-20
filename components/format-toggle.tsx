"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";
import { saveFormatPreference } from "@/app/actions/preferences";
import { shortFormatName } from "@/lib/format-display";

export type FormatOption = {
  id: string;
  slug: string;
  display_name: string;
  is_default: boolean;
};

const LOCAL_STORAGE_KEY = "ffbeacon.format";

export function FormatToggle({
  options,
  initialSlug,
  supportedFormatSlugs,
  placement = "below",
}: {
  options: FormatOption[];
  initialSlug: string | null;
  // When provided, the dropdown is restricted to formats whose slug appears
  // in this array. null/undefined means "no restriction" (the source supports
  // every active format). An empty array means "the current source supports
  // nothing" and the dropdown collapses to a static label.
  supportedFormatSlugs?: string[] | null;
  // "below" floats the menu over the page from a trigger that has room around
  // it, which is the header popover. "inline" expands the list in the flow of
  // the page instead, for the mobile drawer: the drawer's footer is a scroll
  // box, and a scroll box clips anything positioned outside it, so a floating
  // menu there was cut off to a few rows no matter which way it opened. An
  // in-flow list cannot be clipped, it just makes its container scroll.
  placement?: "below" | "inline";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const filteredOptions =
    supportedFormatSlugs == null
      ? options
      : options.filter((o) => supportedFormatSlugs.includes(o.slug));
  const visibleOptions = filteredOptions.length > 0 ? filteredOptions : options;

  const urlSlug = searchParams.get("format");
  const effectiveSlug =
    urlSlug ?? initialSlug ?? DEFAULT_FORMAT_SLUG;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(""), 1500);
    return () => clearTimeout(t);
  }, [announcement]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, visibleOptions.findIndex((o) => o.slug === effectiveSlug));
    setActiveIndex(idx);
    const raf = requestAnimationFrame(() => {
      itemRefs.current[idx]?.focus();
      // An in-flow list can open below the fold of whatever is scrolling it
      // (the drawer footer). Bring it into view rather than leaving the reader
      // to work out that there is more list under the edge.
      if (placement === "inline") menuRef.current?.scrollIntoView({ block: "nearest" });
    });

    const onDocClick = (event: MouseEvent) => {
      if (
        !triggerRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open, visibleOptions, effectiveSlug, placement]);

  const selectFormat = (slug: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, slug);
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("format", slug);
    const next = `${pathname}?${params.toString()}`;
    const label = visibleOptions.find((o) => o.slug === slug)?.display_name ?? slug;
    setAnnouncement(`Scoring format set to ${label}`);
    void saveFormatPreference(slug).catch(() => {});
    startTransition(() => {
      router.push(next);
      setOpen(false);
      triggerRef.current?.focus();
    });
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (visibleOptions.length < 2) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = (activeIndex + 1) % visibleOptions.length;
      setActiveIndex(next);
      itemRefs.current[next]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = activeIndex === 0 ? visibleOptions.length - 1 : activeIndex - 1;
      setActiveIndex(prev);
      itemRefs.current[prev]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      itemRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      const last = visibleOptions.length - 1;
      setActiveIndex(last);
      itemRefs.current[last]?.focus();
    }
  };

  // Keep the full name for accessible labels + the screen-reader
  // announcement; collapse "Superflex" → "SF" for the visible UI only.
  const currentLabel =
    visibleOptions.find((option) => option.slug === effectiveSlug)?.display_name ??
    options.find((option) => option.slug === effectiveSlug)?.display_name ??
    "Redraft PPR";
  const currentLabelShort = shortFormatName(currentLabel);

  const inline = placement === "inline";
  // Inline is the touch layout: full width, and 44px tall so the trigger and
  // every option clear the minimum tap target.
  const triggerClass = inline
    ? "flex min-h-11 w-full items-center justify-between gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-line-accent disabled:opacity-50"
    : "inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-line-accent disabled:opacity-50";
  const menuClass = inline
    ? "mt-2 w-full overflow-hidden rounded-card border border-line bg-surface-elevated"
    : "absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface-elevated shadow-2xl";
  const itemClass = inline
    ? "flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface focus:bg-surface focus:outline-none"
    : "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface focus:bg-surface focus:outline-none";

  if (visibleOptions.length === 1) {
    return (
      <span
        className={`items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink ${
          inline ? "flex min-h-11 w-full" : "inline-flex h-9"
        }`}
        aria-label={`Scoring format: ${currentLabel}`}
      >
        <span aria-hidden="true" className="text-ink-muted">Format:</span>
        <span aria-hidden="true">{currentLabelShort}</span>
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Scoring format: ${currentLabel}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={pending}
        className={triggerClass}
      >
        <span aria-hidden="true" className={inline ? "flex items-center gap-1.5" : "contents"}>
          <span className="text-ink-muted">Format:</span>
          <span>{currentLabelShort}</span>
        </span>
        <span aria-hidden="true" className="text-ink-subtle">▾</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {open && (
        <ul
          ref={menuRef}
          role="menu"
          aria-label="Choose scoring format"
          onKeyDown={onMenuKeyDown}
          className={menuClass}
        >
          {visibleOptions.map((option, index) => {
            const isSelected = option.slug === effectiveSlug;
            return (
              <li
                key={option.id}
                role="none"
                className="border-b border-line last:border-b-0"
              >
                <button
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => selectFormat(option.slug)}
                  // aria-label carries the unabbreviated name so screen
                  // readers hear "Dynasty PPR Superflex" instead of "SF".
                  aria-label={option.display_name}
                  className={`${itemClass} ${isSelected ? "text-ink" : "text-ink-muted"}`}
                >
                  <span aria-hidden="true">
                    {shortFormatName(option.display_name)}
                  </span>
                  {isSelected && (
                    <span className="text-brand-purple" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
