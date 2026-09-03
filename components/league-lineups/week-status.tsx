/**
 * The state of the week, said four ways at once.
 *
 * A reader arriving on this page has to know, before they read a single
 * number, whether they are looking at a forecast or a result. Getting that
 * across is not a chip in a corner: the same fact is carried by the icon, the
 * word, the border down the left edge and the sentence underneath, so no single
 * channel is load bearing.
 *
 * COLOUR IS NEVER THE SIGNAL. The tint reinforces a word that is already there,
 * which is the rule every other League Pulse surface follows. Remove the colour
 * and the panel still says "Final" beside a tick.
 *
 * THE EDGE MATCHES THE SCHEDULES BOARD. Purple for a week still to come, cyan
 * for one in progress, flat grey for one that is done, exactly as
 * `stateEdgeClass` in components/league-schedule/format.ts paints a matchup
 * card. Two pages in the same section using two colour languages for the same
 * three states is the kind of thing nobody reports and everybody feels.
 *
 * Server component. Presentational only.
 */

import { CalendarClock, CheckCircle2, CircleDashed, Radio } from "lucide-react";
import type { WeekPhase, WeekStatus } from "@/lib/league-lineups/status";

type Tone = {
  icon: React.ReactNode;
  /** The left edge, the border and the wash. Reinforcement, never the message. */
  edge: string;
  chip: string;
  glow: string;
};

const TONES: Record<WeekPhase, Tone> = {
  upcoming: {
    icon: <CalendarClock aria-hidden="true" className="h-5 w-5" />,
    edge: "border-l-4 border-l-brand-purple",
    // #C084FC rather than brand-purple for the LABEL. The chip is 11px bold,
    // nowhere near the large-text allowance, and #A855F7 measures about 3.8:1
    // once the banner's own purple glow lightens the ground under it. This is
    // 5.6:1 on the same ground. The border and fill are unchanged.
    chip: "border-brand-purple/50 bg-brand-purple/10 text-[#C084FC]",
    glow: "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 60%)",
  },
  live: {
    icon: <Radio aria-hidden="true" className="h-5 w-5" />,
    edge: "border-l-4 border-l-brand-cyan",
    chip: "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan",
    glow: "radial-gradient(ellipse at 0% 0%, rgba(34, 211, 238, 0.16) 0%, transparent 60%)",
  },
  final: {
    icon: <CheckCircle2 aria-hidden="true" className="h-5 w-5" />,
    edge: "border-l-4 border-l-line-accent",
    chip: "border-line-accent bg-base/60 text-ink",
    glow: "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 60%)",
  },
  unsettled: {
    icon: <CircleDashed aria-hidden="true" className="h-5 w-5" />,
    edge: "border-l-4 border-l-signal-warning",
    chip: "border-signal-warning/50 bg-signal-warning/10 text-signal-warning",
    glow: "radial-gradient(ellipse at 0% 0%, rgba(245, 158, 11, 0.12) 0%, transparent 60%)",
  },
};

/**
 * The banner over the whole page.
 *
 * The week number is a REAL `h2`, and the section is labelled by it. It was a
 * styled span first, which meant heading navigation skipped the page's whole
 * orienting statement: a reader pressing H went from "Lineups" straight to the
 * team name, past the one element that says whether these are forecasts or
 * results.
 */
export function WeekStatusBanner({
  status,
  week,
  season,
  headingId = "lineup-week-status",
}: {
  status: WeekStatus;
  week: number;
  season: number;
  headingId?: string;
}) {
  const tone = TONES[status.phase];

  return (
    <section
      aria-labelledby={headingId}
      className={`relative overflow-hidden rounded-modal border border-line bg-surface/70 p-4 sm:p-5 ${tone.edge}`}
      style={{ backgroundImage: tone.glow }}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 shrink-0 rounded-full border p-2 ${tone.chip}`}>{tone.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* A HEADING, not a span. This is the page's orienting statement,
                and a reader pressing H went straight past it from "Lineups" to
                the team name, missing the one element that says whether these
                are forecasts or results. */}
            <h2
              id={headingId}
              className="text-sm font-bold uppercase tracking-[0.14em] text-ink"
            >
              Week {week}
              <span className="sr-only">, {season} season</span>
            </h2>
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${tone.chip}`}
            >
              {status.label}
            </span>
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{status.blurb}</p>
        </div>
      </div>
    </section>
  );
}
