"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { saveSourcePreference, saveFormatPreference } from "@/app/actions/preferences";
import { pickFallbackFormat, type FormatLike } from "@/lib/format-fallback";

export type SourceOption = {
  slug: string;
  display_name: string;
  description: string | null;
  // null = supports every active format. Empty array would mean nothing.
  supported_format_slugs: string[] | null;
};

const LOCAL_STORAGE_KEY = "ffbeacon.source";
const FORMAT_LOCAL_STORAGE_KEY = "ffbeacon.format";

export function SourceToggle({
  options,
  initialSlug,
  currentFormatSlug,
  allFormats,
}: {
  options: SourceOption[];
  initialSlug: string | null;
  // The user's currently-resolved format. Used to (a) filter the source list
  // to only those that support this format, and (b) trigger a fall-through
  // when the user selects a source that doesn't support it.
  currentFormatSlug: string | null;
  // Full active format list, used by pickFallbackFormat when a source switch
  // forces a format substitution.
  allFormats: FormatLike[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Filter the source dropdown to sources that support the current format.
  // A source with supported_format_slugs===null supports everything.
  const filteredOptions = currentFormatSlug
    ? options.filter((o) =>
        o.supported_format_slugs === null
          ? true
          : o.supported_format_slugs.includes(currentFormatSlug),
      )
    : options;
  const visibleOptions = filteredOptions.length > 0 ? filteredOptions : options;

  const urlSlug = searchParams.get("source");
  const effectiveSlug =
    urlSlug ?? initialSlug ?? visibleOptions[0]?.slug ?? options[0]?.slug ?? null;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!announcement) return;
    // Hold long fallback announcements long enough for a typical screen
    // reader rate (~3 words/sec). 20+ word sentences need ~7 seconds.
    const ms = announcement.includes("Switched to") ? 7000 : 1500;
    const t = setTimeout(() => setAnnouncement(""), ms);
    return () => clearTimeout(t);
  }, [announcement]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, visibleOptions.findIndex((o) => o.slug === effectiveSlug));
    setActiveIndex(idx);
    const raf = requestAnimationFrame(() => itemRefs.current[idx]?.focus());

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
  }, [open, visibleOptions, effectiveSlug]);

  const selectSource = (slug: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, slug);
    }
    // Look up the full option (visible OR not) to inspect supported_format_slugs.
    const targetSource = options.find((o) => o.slug === slug);
    const supports = targetSource?.supported_format_slugs ?? null;
    const formatStillValid =
      !currentFormatSlug ||
      supports === null ||
      supports.includes(currentFormatSlug);

    let fallbackFormatSlug: string | null = null;
    let fallbackFormatLabel: string | null = null;
    let oldFormatLabel: string | null = null;
    if (!formatStillValid && currentFormatSlug) {
      const fallback = pickFallbackFormat(allFormats, currentFormatSlug, supports);
      if (fallback) {
        fallbackFormatSlug = fallback.slug;
        fallbackFormatLabel = fallback.display_name;
        oldFormatLabel =
          allFormats.find((f) => f.slug === currentFormatSlug)?.display_name ??
          currentFormatSlug;
      }
    }

    const params = new URLSearchParams(searchParams.toString());
    params.set("source", slug);
    if (fallbackFormatSlug) {
      params.set("format", fallbackFormatSlug);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FORMAT_LOCAL_STORAGE_KEY, fallbackFormatSlug);
      }
    }
    const next = `${pathname}?${params.toString()}`;
    const label = targetSource?.display_name ?? slug;
    setAnnouncement(
      fallbackFormatSlug
        ? `Data source set to ${label}. Switched to ${fallbackFormatLabel} because ${label} doesn't provide values for ${oldFormatLabel}.`
        : `Data source set to ${label}`,
    );
    void saveSourcePreference(slug).catch(() => {});
    if (fallbackFormatSlug) {
      void saveFormatPreference(fallbackFormatSlug).catch(() => {});
    }
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

  const currentLabel =
    visibleOptions.find((option) => option.slug === effectiveSlug)?.display_name ??
    options.find((option) => option.slug === effectiveSlug)?.display_name ??
    visibleOptions[0]?.display_name ??
    options[0]?.display_name ??
    "Unavailable";

  // If no source supports the current format, keep the control visible as a
  // static label so screen-reader users know the affordance still exists and
  // why it's disabled. Same shell as the length-1 branch.
  if (visibleOptions.length === 0) {
    return (
      <span
        className="inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink-muted"
        aria-label="No data source available for the current format"
      >
        <span aria-hidden="true" className="text-ink-muted">Source:</span>
        <span>Unavailable</span>
      </span>
    );
  }

  if (visibleOptions.length === 1) {
    return (
      <span
        className="inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink"
        aria-label={`Data source: ${currentLabel}`}
      >
        <span aria-hidden="true" className="text-ink-muted">Source:</span>
        <span>{currentLabel}</span>
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
        aria-label={`Data source: ${currentLabel}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-line-accent disabled:opacity-70"
      >
        <span aria-hidden="true" className="text-ink-muted">Source:</span>
        <span>{currentLabel}</span>
        <span aria-hidden="true" className="text-ink-subtle">▾</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {open && (
        <ul
          ref={menuRef}
          role="menu"
          aria-label="Choose data source"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-card border border-line bg-surface-elevated shadow-2xl"
        >
          {visibleOptions.map((option, index) => {
            const isSelected = option.slug === effectiveSlug;
            return (
              <li
                key={option.slug}
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
                  onClick={() => selectSource(option.slug)}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface focus:bg-surface focus:outline-none ${
                    isSelected ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{option.display_name}</span>
                    {option.description && (
                      <span className="mt-0.5 text-xs text-ink-subtle">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <span className="text-brand-purple shrink-0" aria-hidden="true">
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
