"use client";

import { useId } from "react";
import { TrendingUp } from "lucide-react";
import type { BidView } from "./bid-view";

/**
 * The measured impact, as figures rather than adjectives.
 *
 * A description list, so each figure is announced with the label that gives
 * it meaning. Nothing is drawn twice: the visible value is the spoken one,
 * and where a bare number would be ambiguous the missing words are sr-only
 * inside the same cell rather than a hidden twin beside it.
 */
export function ImpactGrid({ view }: { view: BidView }) {
  const headingId = `${useId()}-impact`;
  const m = view.marginal;
  if (!m) return null;

  const cells: Array<{ label: string; value: string; extra?: string }> = [
    {
      label: "Points a week",
      value: `+${m.netPointsPerWeek.toFixed(1)}`,
      extra:
        view.mode === "league"
          ? " added to your starting lineup"
          : " over a replacement-level starter",
    },
  ];

  if (view.mode === "league") {
    cells.push({
      label: "Weeks he starts",
      value: `${m.weeksStarting} of ${m.weeksConsidered}`,
      extra: " remaining weeks",
    });
    if (m.expectedWinsAdded !== null) {
      cells.push({
        label: "Wins added",
        value: `+${m.expectedWinsAdded.toFixed(1)}`,
        extra: " expected wins",
      });
    }
    if (m.playoffOddsBefore !== null && m.playoffOddsAfter !== null) {
      cells.push({
        label: "Playoff odds",
        value: `${m.playoffOddsBefore.toFixed(0)}% to ${m.playoffOddsAfter.toFixed(0)}%`,
      });
    }
    if (m.titleOddsBefore !== null && m.titleOddsAfter !== null) {
      cells.push({
        label: "Title odds",
        value: `${m.titleOddsBefore.toFixed(0)}% to ${m.titleOddsAfter.toFixed(0)}%`,
      });
    }
  } else {
    cells.push({
      label: "Weeks left",
      value: String(m.weeksConsidered),
      extra: " regular season weeks",
    });
    if (view.replacement) {
      cells.push({
        label: "Replacement level",
        value: `${view.replacement.pointsPerWeek.toFixed(1)} a week`,
        extra: " from the last startable player at his position",
      });
      cells.push({
        label: "Startable at",
        value: `#${view.replacement.rank}`,
        extra: " at his position, across the whole league",
      });
    }
  }

  if (view.positionalWar) {
    cells.push({
      label: "Positional WAR",
      value: `${view.positionalWar.value.toFixed(2)}`,
      extra: ` wins over replacement at ${view.positionalWar.position} rank ${view.positionalWar.positionRank} in this league`,
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
        <TrendingUp aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        {view.mode === "league"
          ? "What he adds to your team"
          : "What he adds over replacement"}
      </h4>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-card border border-line bg-base/50 p-3">
            <dt className="text-xs text-ink-subtle">{cell.label}</dt>
            <dd className="mt-1 font-mono text-sm font-bold tabular-nums text-ink">
              {cell.value}
              {cell.extra && <span className="sr-only">{cell.extra}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
