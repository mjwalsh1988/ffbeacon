/**
 * The three numbers this page exists to put in front of a reader, above
 * everything else.
 *
 * WHAT IT SAYS: what your lineup is projected to score, what the best lineup
 * available to you would score, and the gap between them. On a settled week the
 * first becomes what you actually scored, and the gap becomes what you left on
 * your bench, which is the same question asked backwards.
 *
 * ON A SETTLED WEEK THE MIDDLE FIGURE IS THE RECAP'S, NOT THE OPTIMISER'S.
 * `optimization.optimalTotal` is measured over the slots the model can grade;
 * `recap.bestPossible` is that deficit added onto Sleeper's own official total.
 * In a league with no IDP they are the same number. In one with IDP they are
 * not, and printing the gradable-only figure directly beneath a full official
 * score would show a "best lineup" that is LOWER than what the manager actually
 * scored. Same arithmetic, same reason, as lib/manager-ledger/lineup.ts.
 *
 * WHY IT IS A `<dl>` AND NOT THREE DIVS
 *   Each figure is a term and a value, and a description list is the only
 *   structure that says so. A screen reader then reads "Projected, 118.4"
 *   rather than "118.4" with the label announced separately as unrelated text,
 *   and the browser's own list navigation works.
 *
 * NOTHING VISIBLE IS HIDDEN FROM THE ACCESSIBILITY TREE
 *   The big figures used to be drawn twice: an `aria-hidden` span with the
 *   digits, and an `sr-only` span with the same digits plus their meaning. It
 *   reads correctly line by line and it fails the moment somebody points at
 *   one, because a screen reader following the pointer finds an aria-hidden
 *   object and falls back to an ancestor. So the digits are a real text node
 *   now, and only the words that are missing from them ("points projected for
 *   the lineup you have set") are visually hidden, inside the same element.
 *
 * Server component. Presentational only.
 */

import { Flame, Target, TrendingUp } from "lucide-react";
import { ownerLine } from "@/lib/team-label";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import {
  ELEVATED_BORDER,
  ELEVATED_WASH,
  HAIRLINE_STYLE,
  fmtPoints,
  ordinal,
  recordLabel,
} from "@/components/league-schedule/format";
import type { LineupView } from "@/lib/league-lineups/types";
import { STATUS_TONE, efficiencyLabel } from "./format";

export function LineupSummary({ view }: { view: LineupView }) {
  const { optimization, recap } = view;
  const showsResults = view.weekStatus.showsResults;
  const settled = view.isFinal;

  // A LIVE WEEK SHOWS ITS LIVE TOTAL OR NOTHING. Falling through to
  // `optimization.setTotal` put a projection under the word "Scored", because
  // `grade()` builds that total from projections until the week settles.
  const headline = settled
    ? view.actualTotal
    : showsResults
      ? view.liveTotal
      : optimization.setTotal;
  const headlineTerm = settled ? "Scored" : showsResults ? "Scored so far" : "Your lineup";
  const headlineWords = settled
    ? "points scored by the lineup you set"
    : showsResults
      ? "points on the board so far from the lineup you set"
      : "points projected for the lineup you have set";

  const best = settled && recap?.bestPossible != null ? recap.bestPossible : optimization.optimalTotal;
  const bestTerm = settled ? "Best you had" : "Best lineup";
  const bestWords = settled
    ? "points the best legal lineup out of the same roster would have scored"
    : "points the best legal lineup is worth";

  const gap = optimization.pointsLeftOnBench;
  const gapTerm = settled ? "Left on your bench" : "Available on your bench";
  const gapWords = settled
    ? "points your bench would have added"
    : "more points the best legal lineup is projected to score";

  const efficiency = efficiencyLabel(
    settled && recap?.efficiency != null ? recap.efficiency : optimization.efficiency,
  );

  return (
    <section
      aria-labelledby="lineup-summary-title"
      className={`relative overflow-hidden rounded-modal border p-5 sm:p-6 ${ELEVATED_BORDER}`}
      style={ELEVATED_WASH}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={HAIRLINE_STYLE}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {/* Decorative beside the team name, which is the accessible name for
              this whole block, so the alt is empty rather than a duplicate. */}
          <span className="shrink-0">
            <SleeperAvatar avatarId={view.ownerAvatarId} title="" size={40} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
              Week {view.week}, {view.weekStatus.label.toLowerCase()}
            </p>
            <h2
              id="lineup-summary-title"
              className="mt-0.5 truncate text-2xl font-bold tracking-tight text-ink sm:text-3xl"
            >
              {view.teamName}
            </h2>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {recordLabel(view.record)}
              {ownerLine(view.teamName, view.ownerHandle)
                ? `, ${ownerLine(view.teamName, view.ownerHandle)}`
                : ""}
              {view.pulseRank !== null
                ? `, ${ordinal(view.pulseRank)} by Power Pulse`
                : ""}
            </p>
          </div>
        </div>

        {/* The goal chip. Colour is paired with the word, and the reason rides
            along as a visually hidden sentence rather than a title attribute,
            which touch and most screen readers never surface. */}
        {view.status && (
          <p
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${STATUS_TONE[view.status.key]}`}
          >
            <Target aria-hidden="true" className="h-3.5 w-3.5" />
            {view.status.label}
            <span className="sr-only">. {view.status.reason}</span>
          </p>
        )}
      </div>

      {/* THE NUMBERS. Three columns from sm up, stacked on a phone, and nothing
          is dropped at any width: the labels shorten by never having been long
          in the first place. */}
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <Figure
          term={headlineTerm}
          value={headline}
          words={headlineWords}
          icon={<TrendingUp aria-hidden="true" className="h-4 w-4" />}
          emphasis
        />
        <Figure
          term={bestTerm}
          value={best}
          words={bestWords}
          icon={<Target aria-hidden="true" className="h-4 w-4" />}
        />
        <Figure
          term={gapTerm}
          value={gap}
          words={gapWords}
          icon={<Flame aria-hidden="true" className="h-4 w-4" />}
          // A gap of zero is a real, good answer and the only figure here that
          // gets a tone of its own: nothing on the bench beats what is starting.
          tone={gap !== null && gap < 0.05 ? "good" : gap !== null && gap >= 1 ? "warn" : "plain"}
        />
      </dl>

      {efficiency !== null && (
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">{efficiency}</span> of the points your
          roster {settled ? "produced were" : "can produce are"} in your lineup.
          {settled
            ? optimization.moves.length === 0
              ? " Nothing on your bench would have scored more than what you started."
              : ` ${optimization.moves.length} ${optimization.moves.length === 1 ? "change" : "changes"} would have closed the gap.`
            : optimization.moves.length === 0
              ? " Nothing on your bench beats what you are starting."
              : // "below" only when the optimiser is actually rendered. It is
              // hidden mid-week (page.tsx), and pointing a reader at a panel
              // that is not there is worse for a non-visual reader, who cannot
              // see the absence.
              ` ${optimization.moves.length} ${optimization.moves.length === 1 ? "change" : "changes"} would close the gap.`}
        </p>
      )}

      {view.usedRosterFallback && (
        <p className="mt-3 rounded-card border border-line bg-base/50 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
          Sleeper has not published a matchup for week {view.week} yet, so this is the
          lineup your roster is set to right now.
        </p>
      )}
    </section>
  );
}

function Figure({
  term,
  value,
  words,
  icon,
  emphasis = false,
  tone = "plain",
}: {
  term: string;
  value: number | null;
  /** The spoken form: the unit and the meaning, since the digits alone are not a sentence. */
  words: string;
  icon: React.ReactNode;
  emphasis?: boolean;
  tone?: "plain" | "good" | "warn";
}) {
  const figureTone =
    tone === "good"
      ? "text-brand-cyan"
      : tone === "warn"
        ? "text-brand-purple"
        : emphasis
          ? "text-ink"
          : "text-ink";

  return (
    <div
      className={`rounded-card border px-4 py-3 ${
        emphasis ? "border-line-accent bg-base/60" : "border-line bg-base/40"
      }`}
    >
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        <span className="text-brand-cyan">{icon}</span>
        {term}
      </dt>
      <dd className="mt-1">
        {value === null ? (
          <span className="text-[13px] text-ink-subtle">Not available</span>
        ) : (
          <span
            className={`block font-mono tabular-nums ${figureTone} ${
              emphasis ? "text-3xl font-extrabold sm:text-4xl" : "text-2xl font-bold sm:text-3xl"
            }`}
          >
            {fmtPoints(value)}
            <span className="sr-only"> {words}</span>
          </span>
        )}
      </dd>
    </div>
  );
}
