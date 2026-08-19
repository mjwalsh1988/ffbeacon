"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { FormatLike } from "@/lib/format-fallback";
import { FormatToggle, type FormatOption } from "@/components/format-toggle";
import { SourceToggle, type SourceOption } from "@/components/source-toggle";
import {
  InfoTooltip,
  SOURCE_INFO_TOOLTIP,
  FORMAT_INFO_TOOLTIP,
} from "@/components/info-tooltip";

/**
 * Desktop-only popover that houses the data-source and league-format toggles
 * behind a single icon button, freeing up horizontal space in the header for
 * the primary navigation. Mobile keeps both toggles inline in the slide-out
 * drawer (see components/app-shell/app-mobile-nav.tsx), so this component
 * renders nothing there.
 *
 * The two controls inside are the exact same SourceToggle / FormatToggle used
 * everywhere else, so selection behavior, the format-fallback warnings, and the
 * screen-reader announcements are unchanged; they're just relocated.
 */
export function PreferencesMenu({
  formats,
  initialFormatSlug,
  sources,
  initialSourceSlug,
  allFormats,
  supportedFormatSlugs,
}: {
  formats: FormatOption[];
  initialFormatSlug: string | null;
  sources: SourceOption[];
  initialSourceSlug: string | null;
  allFormats: FormatLike[];
  supportedFormatSlugs: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Close on Escape and on outside pointerdown. The inner toggle menus live
  // inside this panel's DOM subtree, so interacting with them counts as
  // "inside" and never closes the popover; their own Escape handlers stop
  // propagation while open, so Escape closes the toggle menu first and this
  // popover only once no toggle menu is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Data source and league format settings"
        title="Source and format settings"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-ink-muted" />
        <span>Values</span>
        <span aria-hidden="true" className="text-ink-subtle">
          ▾
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={headingId}
          className="absolute right-0 z-40 mt-2 w-72 rounded-card border border-line bg-surface-elevated p-4 shadow-2xl shadow-black/50"
        >
          <h2
            id={headingId}
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
          >
            Value settings
          </h2>

          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Data source
                </p>
                <InfoTooltip
                  content={SOURCE_INFO_TOOLTIP}
                  placement="below"
                  align="start"
                />
              </div>
              <SourceToggle
                options={sources}
                initialSlug={initialSourceSlug}
                currentFormatSlug={initialFormatSlug}
                allFormats={allFormats}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  League format
                </p>
                <InfoTooltip
                  content={FORMAT_INFO_TOOLTIP}
                  placement="below"
                  align="start"
                />
              </div>
              <FormatToggle
                options={formats}
                initialSlug={initialFormatSlug}
                supportedFormatSlugs={supportedFormatSlugs}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
