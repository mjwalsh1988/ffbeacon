import { Trophy, Flag, Coins } from "lucide-react";
import { ordinal } from "@/lib/league-team-status";
import { formatValue } from "@/lib/format-value";
import {
  describeStandingFigure,
  hasValueFigure,
  type FigureInput,
} from "@/lib/team-standing-figure";
import { BeaconValueIcon, BEACON_SOURCE_SLUG } from "@/components/beacon-value-icon";

/**
 * The figure that sits beside the Competitor / Mid Tier / Rebuilder tag on a
 * league row. Which number belongs to which tag, and how it is worded, is
 * decided in lib/team-standing-figure.ts; this file is how it looks.
 *
 * It is a pill, deliberately, built to the same recipe as TeamStatusBadge:
 * icon, filled background, bright border, soft glow in the pill's own colour.
 * A bare line of grey text under a tag reads as a caption that fell off
 * something, and the eye skips it. Two pills side by side read as one unit of
 * information, which is what they are.
 *
 * Top three by projected finish take gold, silver, or bronze with a trophy.
 * Fourth and below take a neutral pill with a finish-line flag, because a medal
 * for 9th is a joke at the reader's expense.
 *
 * Colour is never the only signal: the ordinal is spelled out inside every
 * pill, the icon differs between a medal and a plain finish, and the
 * screen-reader sentence names the measure being quoted.
 */

/** Border, fill, text, and glow per placement. One string per tone so a tone is
 *  one thing to change rather than four. Written out in full because Tailwind
 *  only generates classes it can see literally in the source. */
const MEDAL_TONE: Record<number, string> = {
  1: "border-[#F5C518]/60 bg-[#F5C518]/15 text-[#F5C518] shadow-[0_0_18px_-7px_rgba(245,197,24,0.9)]",
  2: "border-[#C7CDD6]/60 bg-[#C7CDD6]/15 text-[#C7CDD6] shadow-[0_0_18px_-7px_rgba(199,205,214,0.9)]",
  3: "border-[#CE8946]/60 bg-[#CE8946]/15 text-[#CE8946] shadow-[0_0_18px_-7px_rgba(206,137,70,0.9)]",
};

const PLAIN_TONE = "border-line-accent bg-base/70 text-ink-muted";

/** Rebuilder value pill. Purple, matching the Rebuilder tag it sits beside. */
const VALUE_TONE =
  "border-brand-purple/50 bg-brand-purple/10 text-ink shadow-[0_0_18px_-9px_rgba(168,85,247,0.8)]";

const SIZE = {
  sm: { pill: "gap-1 px-2 py-0.5 text-[10px]", icon: "h-3 w-3" },
  md: { pill: "gap-1.5 px-2.5 py-1 text-[11px]", icon: "h-3.5 w-3.5" },
} as const;

export function TeamStandingFigure({
  size = "md",
  className = "",
  sourceSlug,
  ...input
}: FigureInput & {
  /** Active source slug, so the FF Beacon mark appears only next to FF Beacon's
   *  own values, which is the one thing that mark means. */
  sourceSlug: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const dims = SIZE[size];
  const sentence = describeStandingFigure(input);
  if (!sentence) return null;

  const base = `inline-flex items-center whitespace-nowrap rounded-full border font-bold tracking-tight ${dims.pill}`;

  if (hasValueFigure(input)) {
    return (
      <span
        title={sentence}
        aria-label={sentence}
        className={`${base} ${VALUE_TONE} ${className}`}
      >
        {/* Coins, not the finish-line flag the other pill uses. The icon is the
            first thing read at a glance, and a flag here would say "finish" on
            the one pill that has nothing to do with finishing. */}
        {sourceSlug === BEACON_SOURCE_SLUG ? (
          <BeaconValueIcon />
        ) : (
          <Coins aria-hidden="true" className={`${dims.icon} shrink-0`} />
        )}
        {/* Value, then its rank in parentheses: "98,808 (3rd)". The rank used to
            sit behind a rule and spell out "by value", which cost most of the
            pill's width in a 13.5rem column. What the ordinal measures is
            carried by the coins mark, the purple tone that matches the Rebuilder
            tag beside it, and the hover and screen-reader sentence, which still
            says "ranked 3rd of 12 by roster value" in full. */}
        <span aria-hidden="true" className="font-mono tabular-nums">
          {formatValue(input.totalValue)}
          {input.valueRank != null && (
            <span className="font-normal text-ink-muted">
              {" "}
              ({ordinal(input.valueRank)})
            </span>
          )}
        </span>
      </span>
    );
  }

  if (input.projectedSeed == null) return null;
  const medal = MEDAL_TONE[input.projectedSeed];

  return (
    <span
      title={sentence}
      aria-label={sentence}
      className={`${base} ${medal ?? PLAIN_TONE} ${className}`}
    >
      {medal ? (
        <Trophy aria-hidden="true" className={`${dims.icon} shrink-0`} />
      ) : (
        <Flag aria-hidden="true" className={`${dims.icon} shrink-0`} />
      )}
      {/* Placement only. The row already says how many teams are in the league,
          so repeating the denominator in a pill this size just crowds it. The
          spoken sentence keeps the "of 12", because it is heard on its own with
          none of that surrounding context. */}
      <span aria-hidden="true">
        Proj{" "}
        <span className="font-mono tabular-nums">
          {ordinal(input.projectedSeed)}
        </span>
      </span>
    </span>
  );
}
