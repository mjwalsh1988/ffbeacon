import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import type { TradeReason } from "@/lib/trade-impact/types";

/**
 * Why this trade helps and why it costs, as one list.
 *
 * WHY THE COSTS ARE NEVER COLLAPSED
 *   A card that shows the upside and buries the downside is a sales pitch. There
 *   is no toggle here, no "show more", no truncated detail sentence, and no cap
 *   on how many bad reasons render. The costs sit in the same list as the gains,
 *   in the same type size, with the same amount of explanation. This is the same
 *   rule components/trade-finder-card.tsx already states about its own figures,
 *   and it matters more here because this list is the thing a reader will act
 *   on. Anyone who "simplifies" this by hiding the bad rows behind a disclosure
 *   has changed what the feature is for.
 *
 * WHY THE ORDER IS GAINS, THEN NOTES, THEN COSTS
 *   A stable partition by tone, so the answer to "is this good for me" arrives
 *   before the caveats to it. The sort is stable, so whatever ordering the
 *   reason builder chose inside a tone survives untouched, and running it over
 *   an already-grouped list is a no-op.
 *
 * WHY THE TONE PALETTE IS THE POWER PULSE ONE
 *   TradeReason is deliberately the same shape as PowerPulseDriver (see
 *   lib/trade-impact/types.ts), so it gets the same green / red / grey styling
 *   components/power-pulse/pulse-detail.tsx uses for its drivers. A reader who
 *   has already read one team's Power Pulse breakdown knows what a tone means
 *   here without being taught twice. Colour is never the signal on its own: each
 *   row carries an icon and a word ("Helps", "Costs", "Note") that a screen
 *   reader announces before the label.
 *
 * Server component: props in, markup out.
 */

type Tone = TradeReason["tone"];

const TONE: Record<
  Tone,
  { word: string; Icon: typeof ArrowUpRight; text: string; border: string; rank: number }
> = {
  good: {
    word: "Helps",
    Icon: ArrowUpRight,
    text: "text-signal-success",
    border: "border-signal-success/60",
    rank: 0,
  },
  neutral: {
    word: "Note",
    Icon: Minus,
    text: "text-ink-muted",
    border: "border-line-accent",
    rank: 1,
  },
  bad: {
    word: "Costs",
    Icon: ArrowDownRight,
    text: "text-signal-danger",
    border: "border-signal-danger/60",
    rank: 2,
  },
};

export function ReasonList({
  reasons,
  caveats,
  headingId,
}: {
  reasons: TradeReason[];
  caveats: string[];
  /** Ties this list to the heading of the panel that owns it. */
  headingId?: string;
}) {
  const ordered = reasons
    .map((reason, index) => ({ reason, index }))
    .sort(
      (a, b) =>
        TONE[a.reason.tone].rank - TONE[b.reason.tone].rank || a.index - b.index,
    )
    .map((entry) => entry.reason);

  return (
    <div>
      {ordered.length === 0 ? (
        // An empty list would read as a rendering failure. A stated conclusion
        // reads as an answer, which is what it is: the model looked and found
        // nothing that moves in either direction.
        <p className="text-sm leading-relaxed text-ink-muted">
          Nothing about this trade moves your team far enough in either direction
          to call out. The figures below are the whole story.
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="space-y-3">
          {ordered.map((reason) => {
            const tone = TONE[reason.tone];
            const Icon = tone.Icon;
            return (
              <li
                key={reason.kind + reason.label}
                className={`border-l-2 pl-3 ${tone.border}`}
              >
                <p
                  className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] ${tone.text}`}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  {tone.word}
                </p>
                <p className="mt-1 text-sm font-semibold leading-snug text-ink">
                  {reason.label}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {reason.detail}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {caveats.length > 0 && (
        <section aria-label="Worth knowing" className="mt-5">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
            <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Worth knowing
          </h4>
          <ul className="mt-2 space-y-1.5 rounded-card border border-line bg-base/50 px-3 py-2.5">
            {caveats.map((caveat) => (
              <li key={caveat} className="text-sm leading-relaxed text-ink-muted">
                {caveat}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
