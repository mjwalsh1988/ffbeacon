"use client";

import { useId } from "react";
import type { MarginalWeek } from "@/lib/faab/types";

/**
 * Week by week.
 *
 * A wrapping list rather than a table, so nothing is dropped on a phone, and
 * every entry carries its own words, because "W7 +4.2" read aloud is not a
 * sentence. The missing words are sr-only INSIDE the element that holds the
 * figure rather than a second hidden copy of it: a screen reader following
 * the pointer has to find the same thing the eye found.
 */
export function WeekStrip({
  weeks,
  mode,
}: {
  weeks: MarginalWeek[];
  mode: "league" | "manual";
}) {
  const headingId = `${useId()}-weeks`;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4 id={headingId} className="text-sm font-semibold text-ink">
        {mode === "league" ? "Week by week" : "His remaining schedule"}
      </h4>
      <ul role="list" className="mt-3 flex flex-wrap gap-2">
        {weeks.map((week) => {
          const good =
            mode === "league" ? week.startsForYou : week.opponentMultiplier >= 1.08;
          const tough = mode === "manual" && week.opponentMultiplier <= 0.92;
          return (
            <li
              key={week.week}
              className={`inline-flex min-h-11 min-w-[5rem] flex-col justify-center rounded-card border px-3 py-1.5 ${
                good
                  ? "border-brand-cyan/40 bg-brand-cyan/10"
                  : tough
                    ? "border-signal-danger/40 bg-signal-danger/5"
                    : "border-line bg-base/50"
              }`}
            >
              <span className="text-[11px] font-semibold text-ink-subtle">
                Week {week.week}
                {week.opponent ? ` vs ${week.opponent}` : ""}
              </span>
              <span
                className={`font-mono text-xs font-bold tabular-nums ${
                  good ? "text-brand-cyan" : tough ? "text-signal-danger" : "text-ink-subtle"
                }`}
              >
                {mode === "league" ? (
                  week.startsForYou ? (
                    <>
                      +{week.pointsAdded.toFixed(1)}
                      <span className="sr-only"> points added, he starts</span>
                    </>
                  ) : (
                    <>
                      bench
                      <span className="sr-only">, he does not crack your lineup</span>
                    </>
                  )
                ) : (
                  <>
                    {matchupWord(week.opponentMultiplier)}
                    <span className="sr-only"> matchup</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** How hard a matchup reads, for the manual week strip. */
function matchupWord(multiplier: number): string {
  if (multiplier >= 1.08) return "good";
  if (multiplier <= 0.92) return "tough";
  return "even";
}
