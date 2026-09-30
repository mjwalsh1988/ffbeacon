"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";
import { saveFormatPreference } from "@/app/actions/preferences";
import { FormatNameText } from "@/components/format-name-text";

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

  // The full name drives the screen-reader announcement. The visible text
  // collapses "Superflex" to "SF", and FormatNameText keeps that abbreviation
  // in the accessible name with the full word sr-only beside it (WCAG 2.5.3).
  const currentLabel =
    visibleOptions.find((option) => option.slug === effectiveSlug)?.display_name ??
    options.find((option) => option.slug === effectiveSlug)?.display_name ??
    "Redraft PPR";

  const inline = placement === "inline";
  // Inline is the touch layout: full width, and 44px tall so the trigger and
  // every option clear the minimum tap target. The header trigger stays 36px
  // to look like its neighbours, and an invisible ::before strip 4px above and
  // below makes the part a finger can hit 44px tall.
  const triggerClass = inline
    ? "flex min-h-11 w-full items-center justify-between gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-line-accent aria-disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    : "relative inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:border-line-accent aria-disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  const menuClass = inline
    ? "mt-2 w-full overflow-hidden rounded-card border border-line bg-surface-elevated"
    : "absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface-elevated shadow-2xl";
  // The focused option gets a 2px cyan outline drawn INSIDE the row (the menu
  // clips anything outside it). A background shift alone measured 1.07:1
  // against its neighbours, which is not a focus indicator anyone can see.
  const itemClass = inline
    ? "flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface focus:bg-surface focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-brand-cyan"
    : "flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface focus:bg-surface focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-brand-cyan";

  if (visibleOptions.length === 1) {
    // Real text rather than an aria-label on a span: a label on an element
    // with no role is dropped by most screen readers, and the children were
    // hidden, so this read as nothing at all.
    return (
      <span
        className={`items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink ${
          inline ? "flex min-h-11 w-full" : "inline-flex h-9"
        }`}
      >
        <span className="text-ink-muted">
          <span className="sr-only">Scoring </span>Format:
        </span>{" "}
        <span>
          <FormatNameText displayName={currentLabel} />
        </span>
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
        // aria-disabled rather than disabled: selecting an option returns
        // focus here while the navigation is pending, and a disabled button
        // cannot take focus, so the reader was dropped on the page body.
        aria-disabled={pending || undefined}
        onClick={() => {
          if (pending) return;
          setOpen((prev) => !prev);
        }}
        className={triggerClass}
      >
        <span className={inline ? "flex items-center gap-1.5" : "contents"}>
          <span className="text-ink-muted">
            <span className="sr-only">Scoring </span>Format:
          </span>{" "}
          <span>
            <FormatNameText displayName={currentLabel} />
          </span>
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
                  // menuitemradio + aria-checked: the checkmark is decorative,
                  // so the selected state has to be announced by the role.
                  role="menuitemradio"
                  aria-checked={isSelected}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => selectFormat(option.slug)}
                  className={`${itemClass} ${isSelected ? "text-ink" : "text-ink-muted"}`}
                >
                  <span>
                    <FormatNameText displayName={option.display_name} />
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
