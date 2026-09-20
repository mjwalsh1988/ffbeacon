"use client";

import { useId } from "react";
import { ShieldAlert } from "lucide-react";
import { asPercent } from "./bid-view";
import type { ChoppedRead } from "@/lib/faab/types";

/**
 * Survival, in a league with no playoffs and no opponent.
 *
 * The whole league is the opponent: the lowest score each week is eliminated
 * and that roster goes back on waivers. So nothing here mentions playoffs, a
 * schedule or wins. The question is whether somebody scores less than you.
 *
 * A description list rather than a table: these are one team's figures, not a
 * comparison across teams, and each one is a label and a value.
 */
export function ChoppedCard({ chopped }: { chopped: ChoppedRead }) {
  const headingId = `${useId()}-chopped`;

  const rows: Array<{ term: string; detail: string }> = [
    {
      term: "Chopped this week",
      detail: `${asPercent(chopped.before.pChoppedThisWeek)}% before this claim, ${asPercent(chopped.after.pChoppedThisWeek)}% after it. You are ranked ${chopped.dangerRank} for danger this week, where 1 is the team most likely to go.`,
    },
    {
      term: "Chance you win the league",
      detail: `${asPercent(chopped.before.pWin)}% before, ${asPercent(chopped.after.pWin)}% after.`,
    },
    {
      term: "Weeks you last",
      detail: `${chopped.before.expectedWeeksAlive.toFixed(1)} before, ${chopped.after.expectedWeeksAlive.toFixed(1)} after, out of the ${Math.max(0, chopped.finalWeek - chopped.currentWeek + 1)} left to play.`,
    },
    {
      term: "Teams left",
      detail: `${chopped.aliveCount} of the ${chopped.startCount} that started, through week ${chopped.finalWeek}.${chopped.finalWeekVerified ? "" : " The final week is our best read rather than a published one."}`,
    },
    {
      term: "Money left in the league",
      detail: `${chopped.moneyLeftInLeague} FAAB across the teams still alive. You hold ${asPercent(chopped.yourShareOfMoney)}% of it, the ${ordinal(chopped.yourMoneyRank)} biggest pile.`,
    },
    {
      term: "Your pace",
      detail: `${Math.round(chopped.pace.holdPct)}% of your budget still held against a ${Math.round(chopped.pace.targetHoldPct)}% target for this week: ${paceWord(chopped.pace.status)}.`,
    },
    {
      term: "Others who would do the same job",
      detail:
        chopped.substitutes === 0
          ? "Nobody else on waivers projects close to him at his position."
          : `${chopped.substitutes} free agent${chopped.substitutes === 1 ? "" : "s"} at his position project nearly as well, so a rival who loses this one has somewhere else to spend.`,
    },
  ];

  if (chopped.releaseCutoffWeek !== null && chopped.currentWeek > chopped.releaseCutoffWeek) {
    rows.push({
      term: "Pool refills",
      detail:
        "Chopped rosters are no longer released in this league, so this is priced against the free agents already there.",
    });
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
        <ShieldAlert aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Survival
      </h4>
      <dl className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <div key={row.term}>
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
              {row.term}
            </dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-ink-muted">
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function paceWord(status: ChoppedRead["pace"]["status"]): string {
  if (status === "ahead") return "you are holding more than most do by now";
  if (status === "behind") return "you have spent faster than most do by now";
  return "about where most managers are by now";
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}
