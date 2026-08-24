"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import {
  POSITION_BADGE,
  normalizePositionColor,
} from "@/lib/on-the-clock/position-colors";
import {
  TRADE_POSITION_LABEL,
  type TradePosition,
} from "@/lib/trade-finder/types";

/**
 * Name the positions you want back, and the ones you would send.
 *
 * WHY CHIPS AND NOT A MULTI-SELECT
 *   A `<select multiple>` is the shape this looks like, and it is the worst
 *   control on the platform: on a phone it is a scrolling box with no obvious
 *   way to choose two things, and with a keyboard it needs modifier-click or
 *   ctrl-space, which nobody discovers. Six toggle buttons carrying
 *   `aria-pressed` say exactly the same thing, are one press each on touch, and
 *   are already how the rest of this feature expresses a two-state control.
 *
 * WHY COLOUR IS NEVER THE SIGNAL
 *   The hue is the shared position palette (lib/on-the-clock/position-colors),
 *   so a chip here is the same colour as the tag on the asset row it produces.
 *   Which chips are ON is carried by the border, the fill, a check-weight
 *   border, and `aria-pressed`; the hue only says which position, and the
 *   position is written on the chip in words as well.
 *
 * WHY THE GROUPS ARE A LEAGUE'S OWN
 *   The page passes only the positions this league actually rosters, so a
 *   twelve-team league with no kicker slot is never offered a kicker chip that
 *   could only ever return nothing.
 *
 * Every chip's accessible name is the full position, not the abbreviation:
 * "Running back" rather than "RB", which several screen readers spell out one
 * letter at a time.
 */

export function PositionFilter({
  side,
  positions,
  selected,
  onToggle,
  onClear,
}: {
  /** Which half of the deal this row constrains. Drives icon, hue, and wording. */
  side: "in" | "out";
  /** The groups this league rosters, in display order. */
  positions: TradePosition[];
  selected: TradePosition[];
  onToggle: (position: TradePosition) => void;
  onClear: () => void;
}) {
  const incoming = side === "in";
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  const heading = incoming ? "You get" : "You give";
  const groupLabel = incoming
    ? "Positions you want to receive"
    : "Positions you are willing to send";
  const chosen = new Set(selected);

  return (
    <div role="group" aria-label={groupLabel}>
      <div className="flex items-center justify-between gap-2">
        <p
          className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] ${
            incoming ? "text-brand-cyan" : "text-brand-purple"
          }`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {heading}
        </p>
        {/* Only drawn when there is something to clear, so the row does not
            carry a dead control most of the time. Its name says which row it
            empties: a page with two of these would otherwise offer a screen
            reader two buttons called "Clear". */}
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-card px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span className="sr-only">{`Clear ${groupLabel.toLowerCase()}`}</span>
            <span aria-hidden="true">Clear</span>
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {positions.map((position) => {
          const on = chosen.has(position);
          const colorKey = normalizePositionColor(position);
          const hue = colorKey ? POSITION_BADGE[colorKey] : "text-ink-muted";
          return (
            <button
              key={position}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(position)}
              // 44px tall so it stays a real tap target on a phone, which is
              // where most of this feature is used.
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-card border px-2.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                on
                  ? incoming
                    ? "border-brand-cyan/70 bg-brand-cyan/10 text-ink"
                    : "border-brand-purple/70 bg-brand-purple/10 text-ink"
                  : "border-line bg-base/60 text-ink-muted hover:border-ink-subtle hover:text-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-extrabold tracking-[0.1em] ${hue}`}
              >
                {position}
              </span>
              <span className="sr-only">{TRADE_POSITION_LABEL[position]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
