"use client";

import { useId } from "react";
import { CircleDollarSign, ShieldAlert } from "lucide-react";
import type { BidView } from "./bid-view";
import type { MarketRead } from "@/lib/faab/types";

/**
 * The money in the room, spelled out. League mode only.
 *
 * The rival table says who wants him; this says who can afford him, which is
 * a different question and the one that decides whether a big bid is even
 * necessary. Every line states what the figure MEANS for the bid, because
 * "the richest rival has 100" is a useless sentence on its own in a league
 * whose budget is 100.
 */
export function MarketCard({ view, market }: { view: BidView; market: MarketRead }) {
  const headingId = `${useId()}-market`;
  const lines: string[] = [];

  if (market.richestRivalBudget === null) {
    lines.push(`You have ${market.yourBudget} FAAB left.`);
  } else if (market.everyoneAtFullBudget) {
    lines.push(
      `Every team still holds the full ${market.leagueTotalBudget ?? market.yourBudget}, you included. Nobody can be priced out yet.`,
    );
  } else if (market.richestRivalBudget > market.yourBudget) {
    lines.push(
      `You have ${market.yourBudget} FAAB and ${market.rivalsAtLeastAsRich} of the other teams can match or beat that, the richest with ${market.richestRivalBudget}.`,
    );
  } else if (market.richestRivalBudget === market.yourBudget) {
    lines.push(
      `You have ${market.yourBudget} FAAB and so does the richest rival. Nobody here can outspend anybody.`,
    );
  } else {
    lines.push(
      `You have ${market.yourBudget} FAAB and the richest rival has ${market.richestRivalBudget}, so nobody can take him past ${market.richestRivalBudget}.`,
    );
  }

  if (market.interestedRivals !== null && market.rivalsChecked !== null) {
    lines.push(
      market.interestedRivals === 0
        ? `None of the other ${market.rivalsChecked} rosters would start him.`
        : `${market.interestedRivals} of ${market.rivalsChecked} rosters would start him.`,
    );
  }

  if (view.heat && view.heat.samples > 0) {
    lines.push(
      `Your league pays ${view.heat.value.toFixed(1)} times the usual price for contested adds, measured over ${view.heat.samples} past auction${view.heat.samples === 1 ? "" : "s"}.`,
    );
  }

  if (market.aliveCount !== null) {
    lines.push(`${market.aliveCount} teams are still alive in this league.`);
  } else {
    lines.push(
      `${market.weeksLeft} regular season week${market.weeksLeft === 1 ? "" : "s"} left.`,
    );
  }

  if (view.priorsFallback) {
    lines.push(
      `Too few auctions match this exact situation, so the market read widens to ${view.priorsFallback}.`,
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <CircleDollarSign aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        The money in the room
      </h4>
      <ul role="list" className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="text-sm leading-relaxed text-ink-muted">
            {line}
          </li>
        ))}
      </ul>
      {view.availability === "rostered" && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-signal-danger"
          />
          <span>
            {view.rosteredBy} already has him here, so this is what he would be
            worth to you rather than what you can bid.
          </span>
        </p>
      )}
    </section>
  );
}
