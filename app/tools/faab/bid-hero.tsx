"use client";

import { Target } from "lucide-react";
import { rungsForGoal, winPercent, type BidView } from "./bid-view";
import type { GoalKey } from "@/lib/faab/types";

/**
 * The answer, in three numbers and two sentences.
 *
 * The bid is the one gradient figure on the card. The walk-away sits directly
 * under it in words rather than as a third equal column, because the
 * expensive FAAB mistake is winning an auction you should have lost, and
 * "worth up to X to you" is the sentence that stops it.
 *
 * EVERY FIGURE IS ONE TEXT NODE. No number is drawn twice, once for the eye
 * and once for the ear: a screen reader following the pointer lands on a
 * hidden twin and falls back to an ancestor, so the unit lives in the same
 * node as the figure and the spoken words are the visible ones.
 */
export function BidHero({ view, goal }: { view: BidView; goal: GoalKey }) {
  const rungs = rungsForGoal(view.ladder, goal, view.remainingBudget);
  const win = winPercent(rungs.bid);
  const overWorth = Math.max(0, rungs.bid.dollars - rungs.walkAway.dollars);
  const pctOfTotal = Math.round(rungs.bid.pct);
  const other =
    goal === "value" ? view.ladder.bidsByGoal.sure : view.ladder.bidsByGoal.value;
  const otherWin = winPercent(other);

  return (
    <div className="mt-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent forced-colors:text-ink sm:text-4xl"
          style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
        >
          Bid {rungs.bid.dollars} FAAB
        </span>
        {win !== null && (
          <span className="text-sm font-semibold text-brand-cyan">
            {win}% chance to win
          </span>
        )}
      </p>

      <p className="mt-1 text-xs text-ink-subtle">
        {pctOfTotal}% of the league&apos;s full budget. Leaves you{" "}
        {rungs.budgetAfterBid} FAAB.
      </p>

      <p className="mt-3 text-sm leading-relaxed text-ink">
        Worth up to {rungs.walkAway.dollars} FAAB to you. Above that, let him go.
      </p>

      {goal === "sure" && overWorth > 0 && (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          That is {overWorth} over his worth to you, the price of making sure.
        </p>
      )}

      {view.ladder.priceAboveWorth && (
        <p className="mt-3 flex items-start gap-2 rounded-card border border-signal-warning/40 bg-signal-warning/5 px-3 py-2.5 text-sm leading-relaxed text-ink">
          <Target aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-warning" />
          <span>
            He will likely cost more than he is worth to you. Bid{" "}
            {rungs.walkAway.dollars} and let him go above it.
          </span>
        </p>
      )}

      {/* The other goal's number, beside the recommendation rather than
          behind the toggle: a reader should be able to see what the other
          answer would be before they ask for it. */}
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {goal === "value" ? "To make sure of him: " : "The value bid instead: "}
        {other.dollars} FAAB
        {otherWin === null ? "." : `, ${otherWin}% chance to win.`}
      </p>

      {view.ladder.rivalTop && (
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          The top rival bid is most likely between {view.ladder.rivalTop.p50} and{" "}
          {view.ladder.rivalTop.p75} FAAB.
        </p>
      )}
    </div>
  );
}
