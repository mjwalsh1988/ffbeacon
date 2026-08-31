"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Scissors, Star } from "lucide-react";
import { useTooltipDismiss } from "@/components/info-tooltip";

/**
 * The small mark beside a player's name on a roster: a star for a player who is
 * top of their position, a pair of scissors for one of the roster's cut
 * candidates. Rendered by the League Pulse team card and by the On The Clock
 * rosters tab, from the rules and the copy in lib/roster-badges.ts.
 *
 * ONE BADGE PER ROW, EVER. `dropCandidateIds` refuses to name a player who is
 * top of their position, so the two marks cannot both apply. That is what makes
 * the wide pointer target below safe.
 *
 * ACCESSIBILITY, and it follows the contract in components/info-tooltip.tsx
 * exactly. The trigger is a real button whose accessible name is the WHOLE
 * explanation, so a screen reader hears what the mark means the moment the
 * control takes focus, whether or not the visual bubble is painted. The bubble
 * itself is aria-hidden, so nobody hears the sentence twice, and there is no
 * live region for the same reason.
 *
 * THE POINTER TARGET IS 44px AND THE ICON IS NOT. A roster row is about 38px
 * tall and the name beside it needs every pixel of width it can get, so a 44px
 * BOX would either double the height of the card or truncate every name on a
 * phone. The button instead carries a 44 by 44 overlay pinned to its centre and
 * taken out of flow, so the target meets the minimum while the row keeps its
 * density. The overlay reaches about 3px into the row above and below; with one
 * badge per row and at most one badge in that band, there is nothing there for
 * it to steal a tap from.
 *
 * THE BUBBLE IS FIXED, NOT ABSOLUTE, AND THAT IS NOT A STYLE CHOICE. The
 * League Pulse position column is `overflow-hidden` (it clips its own rounded
 * corners), and a 240px bubble inside a 180px column would be cut off at both
 * edges. Fixed positioning escapes every ancestor, and measuring the trigger
 * lets the bubble be clamped inside the viewport, which an absolutely
 * positioned one could not be: near the left edge of a phone it would have
 * hung off the page and given the body a horizontal scrollbar.
 */

export type RosterBadgeKind = "top" | "drop";

const TONE: Record<RosterBadgeKind, string> = {
  // Cyan reads as strength across the draft room and the league views. The
  // star is filled so it is a shape at 14px rather than a smudge.
  top: "text-brand-cyan hover:text-brand-cyan/80",
  // Amber reads as caution, which is the right weight: a cut candidate is a
  // suggestion to look, not a verdict. Never the only channel, the icon shape
  // differs and the whole sentence is the button's accessible name.
  drop: "text-signal-warning hover:text-signal-warning/80",
};

const BUBBLE_WIDTH = 240;
const VIEWPORT_MARGIN = 8;
/** Below this much room overhead, the bubble drops under the badge instead. */
const ROOM_ABOVE = 132;

type BubblePosition = {
  left: number;
  top: number;
  width: number;
  above: boolean;
};

export function RosterBadge({
  kind,
  content,
}: {
  kind: RosterBadgeKind;
  /** The full sentence, from topBadgeLabel / dropBadgeLabel. */
  content: string;
}) {
  const [bubble, setBubble] = useState<BubblePosition | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useTooltipDismiss(open, setOpen, buttonRef);

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(
      BUBBLE_WIDTH,
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const centered = r.left + r.width / 2 - width / 2;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, centered),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const above = r.top > ROOM_ABOVE;
    setBubble({ left, top: above ? r.top - 6 : r.bottom + 6, width, above });
    setOpen(true);
  }, []);

  // A fixed bubble does not travel with the page, so a scroll closes it rather
  // than leaving it stranded beside a row that has moved on.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const Icon = kind === "top" ? Star : Scissors;

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={content}
      onClick={() => (open ? setOpen(false) : place())}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") place();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setOpen(false);
      }}
      onFocus={place}
      onBlur={() => setOpen(false)}
      className={`relative z-10 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-cyan ${TONE[kind]}`}
    >
      <Icon
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill={kind === "top" ? "currentColor" : "none"}
      />
      {open && bubble && (
        <span
          aria-hidden="true"
          role="presentation"
          style={{
            left: bubble.left,
            top: bubble.top,
            width: bubble.width,
            transform: bubble.above ? "translateY(-100%)" : undefined,
          }}
          className="pointer-events-none fixed z-50 rounded-card border border-line bg-surface-elevated/95 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-2xl backdrop-blur"
        >
          {content}
        </span>
      )}
    </button>
  );
}
