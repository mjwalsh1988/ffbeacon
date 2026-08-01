"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

/**
 * Site-wide accessible info tooltip primitive.
 *
 * Use this everywhere a UI control benefits from a short, hover/focus
 * triggered explanation (filters, toggles, advanced settings, ambiguous
 * column headers, etc). Pass the explanation in via `content` and the
 * component handles all the accessibility wiring for you.
 *
 * Usage:
 *   <InfoTooltip content="Pick your league's scoring format..." />
 *   <InfoTooltip content="..." placement="above" align="end" />
 *
 * Behavior contract:
 * - The trigger is a real <button> with the full tooltip sentence as
 *   its aria-label, so screen readers announce the whole explanation
 *   on focus regardless of whether the visual tooltip is on screen.
 * - The visual tooltip itself is aria-hidden, purely for sighted
 *   users, so SR users don't hear the content twice.
 *
 * Open/close behavior:
 *   - Mouse hover (pointerType=mouse) opens and closes.
 *   - Keyboard focus opens; blur closes.
 *   - Touch tap toggles via onClick (mouse-only pointer guards the
 *     hover handlers so iOS doesn't open-then-close on a single tap).
 *   - Escape and outside-click both close.
 */
export type InfoTooltipPlacement = "below" | "above";
export type InfoTooltipAlign = "start" | "center" | "end";

export function InfoTooltip({
  content,
  label,
  placement = "below",
  align = "center",
}: {
  content: string;
  // Optional explicit aria-label. Defaults to `content` so the full
  // sentence is the accessible name.
  label?: string;
  placement?: InfoTooltipPlacement;
  align?: InfoTooltipAlign;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onDocPointer = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDocPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer);
    };
  }, [open]);

  const alignClass =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const placementClass =
    placement === "above" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label ?? content}
        onClick={() => setOpen((p) => !p)}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Info aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <span
          aria-hidden="true"
          role="presentation"
          className={`pointer-events-none absolute z-50 w-64 rounded-card border border-line bg-surface-elevated/95 px-3 py-2 text-xs leading-relaxed text-ink shadow-2xl backdrop-blur ${alignClass} ${placementClass}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// Centralized tooltip copy so the desktop header and mobile menu stay
// in sync. Keep these layperson-friendly and one short sentence each.
export const SOURCE_INFO_TOOLTIP =
  "Pick which fantasy ranking site we should pull player values from across the app.";
export const FORMAT_INFO_TOOLTIP =
  "Pick your league's scoring format so the values match how your league actually plays.";
