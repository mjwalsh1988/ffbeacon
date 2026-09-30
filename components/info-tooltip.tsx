"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { Info } from "lucide-react";

/**
 * Close an open tooltip on Escape and on a pointer press outside its trigger.
 *
 * Shared by every tooltip in this file and by the roster badges in
 * components/roster-badge.tsx, which follow the same contract. It exists so the
 * dismissal behaviour cannot drift between them: a tooltip that closes on
 * Escape in one place and traps focus in another is worse than either.
 *
 * `setOpen` comes straight from useState, so its identity is stable and the
 * effect re-subscribes only when `open` actually changes.
 *
 * ESCAPE IS CONSUMED. The listener runs in the CAPTURE phase on window and
 * stops propagation, so the Escape that closes a tooltip inside a dialog does
 * not also reach the dialog's own document-level handler and close the dialog
 * around it. One key press, one thing dismissed.
 *
 * Pass the element that holds BOTH the trigger and the bubble as `triggerRef`
 * when the bubble is hoverable, so a press on the bubble is not "outside".
 */
export function useTooltipDismiss(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  triggerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDocPointer = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDocPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDocPointer);
    };
  }, [open, setOpen, triggerRef]);
}

/** Gap kept between a bubble and the edge of the viewport, in CSS px. */
const VIEWPORT_MARGIN = 8;

/**
 * Nudges an open bubble sideways so it stays inside the viewport. A 256px
 * bubble centred on an icon near the edge of a 360px phone used to run off the
 * screen, and the half nobody could see was usually the end of the sentence.
 * The shift uses the CSS `translate` property, which composes with the
 * centring transform rather than replacing it.
 */
function useKeepOnScreen(open: boolean) {
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = bubbleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Measure where the bubble would sit with no shift applied.
    const left = rect.left - shift;
    const right = rect.right - shift;
    const vw = document.documentElement.clientWidth;
    let next = 0;
    if (right > vw - VIEWPORT_MARGIN) next = vw - VIEWPORT_MARGIN - right;
    if (left + next < VIEWPORT_MARGIN) next = VIEWPORT_MARGIN - left;
    if (next !== shift) setShift(next);
    // Runs once per open; `shift` is read, not tracked, so the nudge cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { bubbleRef, bubbleStyle: shift ? { translate: `${shift}px 0` } : undefined };
}

/**
 * The bubble is hoverable (WCAG 1.4.13): a pointer can move from the trigger
 * onto the text and read it without the bubble vanishing. The hover handlers
 * therefore sit on the wrapper that holds both, and this transparent strip
 * spans the small gap between them so the pointer never crosses dead space.
 */
function bridgeClass(placement: InfoTooltipPlacement, gap: "1.5" | "2"): string {
  if (placement === "above") {
    return gap === "2"
      ? "before:absolute before:inset-x-0 before:top-full before:h-2 before:content-['']"
      : "before:absolute before:inset-x-0 before:top-full before:h-1.5 before:content-['']";
  }
  return gap === "2"
    ? "before:absolute before:inset-x-0 before:bottom-full before:h-2 before:content-['']"
    : "before:absolute before:inset-x-0 before:bottom-full before:h-1.5 before:content-['']";
}

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
 *   - Mouse hover (pointerType=mouse) opens and closes, over the trigger AND
 *     the bubble, so the pointer can move onto the text (WCAG 1.4.13).
 *   - Keyboard focus opens; blur closes.
 *   - Touch tap toggles via onClick (mouse-only pointer guards the
 *     hover handlers so iOS doesn't open-then-close on a single tap).
 *   - Escape and outside-click both close. Escape is consumed, so it does
 *     not also close a dialog the tooltip sits in.
 *   - The bubble is nudged sideways to stay on screen at 360px.
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
  const wrapperRef = useRef<HTMLSpanElement>(null);
  useTooltipDismiss(open, setOpen, wrapperRef);
  const { bubbleRef, bubbleStyle } = useKeepOnScreen(open);

  const alignClass =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const placementClass =
    placement === "above" ? "bottom-full mb-2" : "top-full mt-2";

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label ?? content}
        onClick={() => setOpen((p) => !p)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // The icon stays 28px so it sits in a line of text; the invisible
        // ::before reaches 8px past every edge, making the target 44px.
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors before:absolute before:-inset-2 before:content-[''] hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Info aria-hidden="true" className="h-4 w-4" />
      </button>
      {open && (
        <span
          ref={bubbleRef}
          aria-hidden="true"
          role="presentation"
          style={bubbleStyle}
          className={`absolute z-50 w-64 max-w-[calc(100vw-1rem)] rounded-card border border-line bg-surface-elevated/95 px-3 py-2 text-xs leading-relaxed text-ink shadow-2xl backdrop-blur ${bridgeClass(placement, "2")} ${alignClass} ${placementClass}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * The same tooltip, but the TRIGGER IS THE VALUE rather than an info icon.
 *
 * For dense table cells where a full sentence would wreck the column widths.
 * The cell shows a short chip like "(+28)" and the whole explanation lives on
 * hover, on keyboard focus, and on tap.
 *
 * ACCESSIBILITY, and why there is no live region here. The full sentence is the
 * button's aria-label, so a screen reader announces it the moment the control
 * takes focus, whether or not the visual bubble is painted. That is the same
 * contract InfoTooltip above uses. Adding an aria-live announcement on open
 * would make the same sentence speak twice, once from the label and once from
 * the region, which is worse than saying it once at the right moment.
 *
 * The visual bubble is aria-hidden for exactly that reason.
 *
 * Color is never the only channel: the sign is inside the chip text and the
 * direction is stated in words in the label.
 */
export function ValueTooltip({
  short,
  content,
  className = "",
  placement = "above",
  align = "center",
  compact = false,
}: {
  /** The compact visible text, e.g. "(+28)". */
  short: string;
  /** The full explanation. Becomes the accessible name. */
  content: string;
  /** Color classes for the compact text. */
  className?: string;
  placement?: InfoTooltipPlacement;
  align?: InfoTooltipAlign;
  /**
   * Drop the 44px minimum height for a dense stacked table cell, where a full
   * target would double the row height. The trigger is still a real focusable
   * button with the whole sentence as its accessible name, so it is reachable
   * by keyboard and by screen reader either way; only the pointer target
   * shrinks. Use sparingly.
   */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  useTooltipDismiss(open, setOpen, wrapperRef);
  const { bubbleRef, bubbleStyle } = useKeepOnScreen(open);

  const alignClass =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const placementClass =
    placement === "above" ? "bottom-full mb-1.5" : "top-full mt-1.5";

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={content}
        onClick={() => setOpen((p) => !p)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex items-center rounded font-mono text-xs font-semibold leading-tight tabular-nums underline decoration-dotted decoration-from-font underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-cyan ${
          compact ? "" : "min-h-11"
        } ${className}`}
      >
        {short}
      </button>
      {open && (
        <span
          ref={bubbleRef}
          aria-hidden="true"
          role="presentation"
          style={bubbleStyle}
          className={`absolute z-50 w-56 max-w-[calc(100vw-1rem)] rounded-card border border-line bg-surface-elevated/95 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-2xl backdrop-blur ${bridgeClass(placement, "1.5")} ${alignClass} ${placementClass}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/**
 * Shared color coding for a signed figure in a dense cell. Bright green when
 * the number is in the reader's favour, bright red when it is against them,
 * grey when it is inside the neutral band. Always paired with a sign in the
 * text and a sentence in the label, so this is decoration.
 */
export const VALUE_TONE = {
  good: "text-emerald-400 hover:text-emerald-300",
  bad: "text-rose-400 hover:text-rose-300",
  neutral: "text-ink-muted hover:text-ink",
} as const;

export type ValueTone = keyof typeof VALUE_TONE;

// Centralized tooltip copy so the desktop header and the navigation drawer stay
// in sync. Keep these layperson-friendly and one short sentence each.
export const SOURCE_INFO_TOOLTIP =
  "Pick which fantasy ranking site we should pull player values from across the app.";
export const FORMAT_INFO_TOOLTIP =
  "Pick your league's scoring format so the values match how your league actually plays.";
