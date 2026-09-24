import { positionNoun } from "@/lib/site";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  positionColorKey,
} from "@/lib/on-the-clock/position-colors";

/**
 * A small position tag in the position's own hue (plan R-22), with the
 * position spelled out for a screen reader ("linebacker", not "LB").
 *
 * The code is drawn for the eye and the noun is the text a screen reader
 * reads, both inside the one element, so pointing at the chip finds a real
 * text node rather than falling back to an ancestor. Colour is never the only
 * signal: the code is always printed.
 */
export function PositionChip({
  position,
  className = "",
}: {
  position: string | null | undefined;
  className?: string;
}) {
  if (!position) return null;
  const key = positionColorKey(position);
  const tone = key ? POSITION_BADGE[key] : POSITION_BADGE_FALLBACK;
  const noun = positionNoun(position);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone} ${className}`}
    >
      <span aria-hidden="true">{position.toUpperCase()}</span>
      <span className="sr-only">{noun}</span>
    </span>
  );
}
