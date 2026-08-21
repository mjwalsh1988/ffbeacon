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
 * TWO COLUMNS ON A DESKTOP, ONE ON A PHONE
 *   A deal fires eight or nine of these, and in a single column that is most of
 *   a screen of scrolling for a set of two-line notes. The grid is `md:` rather
 *   than `sm:` because a reason detail runs to about twenty words and a tablet
 *   half-column is where it starts wrapping to four lines. Reading order is
 *   unchanged: a grid lays items out in DOM order, so the gains still come
 *   before the notes and the costs however many columns there are.
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
  {
    word: string;
    Icon: typeof ArrowUpRight;
    text: string;
    border: string;
    card: string;
    rank: number;
  }
> = {
  good: {
    word: "Helps",
    Icon: ArrowUpRight,
    text: "text-signal-success",
    border: "border-l-signal-success",
    card: "border-signal-success/30 bg-signal-success/[0.05]",
    rank: 0,
  },
  neutral: {
    word: "Note",
    Icon: Minus,
    text: "text-ink-muted",
    border: "border-l-line-accent",
    card: "border-line bg-base/50",
    rank: 1,
  },
  bad: {
    word: "Costs",
    Icon: ArrowDownRight,
    text: "text-signal-danger",
    border: "border-l-signal-danger",
    card: "border-signal-danger/30 bg-signal-danger/[0.05]",
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
          Nothing about this trade moves your team far enough either way to call
          out. The figures below are the whole story.
        </p>
      ) : (
        <ul
          aria-labelledby={headingId}
          className="grid gap-3 md:grid-cols-2"
        >
          {ordered.map((reason) => {
            const tone = TONE[reason.tone];
            const Icon = tone.Icon;
            return (
              <li
                key={reason.kind + reason.label}
                // items-stretch by default in a grid, so two cards on one row
                // share a height and the tinted edge runs the full depth of the
                // taller one rather than stopping halfway down.
                className={`h-full rounded-card border border-l-[3px] px-3 py-2.5 ${tone.card} ${tone.border}`}
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
