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
 * The code is ONE real text node, read by everyone, and only the missing
 * words ride beside it as sr-only inside the same element (the Lineups rule):
 * an aria-hidden code with an sr-only twin goes silent when a screen reader
 * follows the pointer onto it. normal-case keeps the noun from being exposed
 * in capitals and read as an initialism. Colour is never the only signal.
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
      {position.toUpperCase()}
      {noun && noun.toUpperCase() !== position.toUpperCase() ? (
        <span className="sr-only normal-case"> ({noun})</span>
      ) : null}
    </span>
  );
}
