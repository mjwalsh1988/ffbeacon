"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Target } from "lucide-react";
import { BidActions } from "./bid-actions";
import { BidHero } from "./bid-hero";
import { BidReasons } from "./bid-reasons";
import { ChoppedCard } from "./chopped-card";
import { DropOptions } from "./drop-options";
import { GoalToggle } from "./goal-toggle";
import { ImpactGrid } from "./impact-grid";
import { MarketCard } from "./market-card";
import { RivalTable } from "./rival-table";
import { SignalList } from "./signal-list";
import { WeekStrip } from "./week-strip";
import { WinChanceChart } from "./win-chance-chart";
import { CONFIDENCE_LABEL, type BidView } from "./bid-view";
import type { GoalKey, LeagueFaabReport } from "@/lib/faab/types";

export type { BidView } from "./bid-view";
export {
  copyText,
  liveMessage,
  rungsForGoal,
  shareImageHref,
  winPercent,
} from "./bid-view";

/**
 * The recommendation, for either mode.
 *
 * Both the connected-league answer and the manual one render through here, so
 * the two never drift into looking like different products. What changes
 * between them is what the figures MEAN, not how they are laid out.
 *
 * THE GOAL LIVES IN THE PARENT. There is exactly one polite live region per
 * mode and it belongs to whichever parent owns the answer, so the goal and
 * the sentence announcing it have to move together. Switching costs no server
 * call either way: `ladder.bidsByGoal` carries both numbers.
 *
 * Headings: the player's name is the card's h3 and every section inside it is
 * an h4, so a reader navigating by heading never meets an h4 with no h3 above
 * it.
 *
 * Nothing is hidden at any breakpoint. On a phone the week strip, the signals
 * and the notices sit inside one labelled disclosure; on a wide screen that
 * disclosure is open. Collapsed is not hidden: the content is in the DOM at
 * every width and reachable by keyboard.
 */
export function BidResult({
  view,
  goal,
  onGoalChange,
  onAnnounce,
  allLeaguesAction,
}: {
  view: BidView;
  goal: GoalKey;
  onGoalChange: (goal: GoalKey) => void;
  /** Hands a one-off message to the parent's polite live region. */
  onAnnounce: (message: string) => void;
  /** League mode only: the existing "check every league" control. */
  allLeaguesAction?: ReactNode;
}) {
  const ids = useId();
  const benchOnly = view.marginal?.isBenchOnly ?? false;
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  // Open from lg up, closed below it. Done here rather than in CSS because a
  // details element's open state is an attribute, and doing it during render
  // would disagree with the server's HTML. The content is in the DOM either
  // way, so a reader who never sees this run loses nothing but a click.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      if (detailsRef.current) detailsRef.current.open = query.matches;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return (
    <div className="space-y-4">
      <div
        className={`relative overflow-hidden rounded-modal border p-5 ${
          view.isDumpCandidate
            ? "border-brand-purple/40 bg-brand-purple/5"
            : benchOnly
              ? "border-line bg-base/40"
              : "border-brand-cyan/30 bg-brand-cyan/5"
        }`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full"
          style={{
            background: view.isDumpCandidate
              ? "radial-gradient(circle, rgba(168,85,247,0.20) 0%, rgba(34,211,238,0.06) 50%, transparent 75%)"
              : "radial-gradient(circle, rgba(34,211,238,0.18) 0%, rgba(168,85,247,0.06) 50%, transparent 75%)",
          }}
        />
        <div className="relative">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            {view.headline}
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-ink-subtle">
              {CONFIDENCE_LABEL[view.confidence]}
            </span>
          </p>

          <h3 className="mt-2 text-base font-semibold text-ink">
            {view.title}
            <span className="ml-2 font-normal text-ink-subtle">{view.subtitle}</span>
          </h3>

          <GoalToggle goal={goal} onChange={onGoalChange} name={`${ids}-goal`} />

          <BidHero view={view} goal={goal} />

          <p className="mt-4 text-sm leading-relaxed text-ink">{view.explanation}</p>
        </div>
      </div>

      <WinChanceChart view={view} goal={goal} />

      <BidReasons reasons={view.reasons} />

      {view.chopped && <ChoppedCard chopped={view.chopped} />}

      {view.mode === "league" && (
        <RivalTable
          rivals={view.rivals}
          notInterested={view.rivalsNotInterested}
          playerName={view.title}
        />
      )}

      {view.market && <MarketCard view={view} market={view.market} />}

      {view.marginal && !benchOnly && <ImpactGrid view={view} />}

      {view.marginal &&
        (view.marginal.dropOptions.length > 0 || view.marginal.dropNote) && (
          <DropOptions
            options={view.marginal.dropOptions}
            note={view.marginal.dropNote}
            weeksConsidered={view.marginal.weeksConsidered}
          />
        )}

      {((view.marginal?.weeks.length ?? 0) > 0 ||
        view.signals.length > 0 ||
        view.notices.length > 0) && (
        <details
          ref={detailsRef}
          className="rounded-card border border-line bg-surface/40 p-4"
        >
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            More detail
          </summary>
          <div className="mt-3 space-y-4">
            {view.marginal && view.marginal.weeks.length > 0 && (
              <WeekStrip weeks={view.marginal.weeks} mode={view.mode} />
            )}
            <SignalList signals={view.signals} />
            {view.notices.map((note) => (
              <p
                key={note}
                className="rounded-card border border-dashed border-line bg-base/40 px-4 py-3 text-sm leading-relaxed text-ink-muted"
              >
                {note}
              </p>
            ))}
          </div>
        </details>
      )}

      <BidActions
        view={view}
        goal={goal}
        onAnnounce={onAnnounce}
        allLeaguesAction={allLeaguesAction}
      />
    </div>
  );
}

/**
 * Build the view from a connected-league report.
 *
 * The win curve is not rebuilt here: it travels on the ladder, sampled by
 * lib/faab/ladder.ts, so the league chart and the manual one are drawn from
 * the same numbers produced by the same code.
 */
export function viewFromLeagueReport(report: LeagueFaabReport): BidView {
  const totalBudget =
    report.market.leagueTotalBudget ?? Math.max(1, report.market.yourBudget);

  return {
    mode: "league",
    leagueKind: report.leagueKind,
    title: report.player.name,
    subtitle: `${report.league.name}, week ${report.league.currentWeek}`,
    headline: report.headline,
    explanation: report.explanation,
    confidence: report.confidence,
    ladder: report.ladder,
    goalDefault: report.goalDefault,
    isDumpCandidate: report.isDumpCandidate,
    marginal: report.marginal,
    signals: report.signals,
    market: report.market,
    notices: report.notices,
    replacement: null,
    availability: report.availability,
    rosteredBy: report.rosteredBy,
    reasons: report.reasons,
    rivals: report.rivals,
    rivalsNotInterested: report.rivalsNotInterested,
    injuredStarters: report.injuredStarters,
    positionalWar: report.positionalWar,
    chopped: report.chopped,
    heat: report.heat,
    priorsFallback: report.priorsFallback,
    remainingBudget: report.market.yourBudget,
    totalBudget,
    sleeperId: report.player.sleeperId,
  };
}
