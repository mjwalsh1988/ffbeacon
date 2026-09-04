/**
 * `ManagerReportLimits` as plain sentences: what this report could not
 * measure, and why. Only the limits that are non-zero render, so a report
 * with nothing to disclose renders nothing.
 *
 * This is not a footnote to bury at the bottom in tiny type. Every gap named
 * here is one a reader would otherwise have to infer from a missing number
 * somewhere else on the page, so it renders in normal body type at the foot
 * of the report.
 *
 * `ManagerReportLimits` carries only the counts (how many league-seasons
 * were skipped, how many have no ledger row, how many seasons have no draft
 * observations), not the caps or denominators that produced them (the
 * `maxLeaguesPerRun` setting, or the manager's total season count). The
 * sentences below are honest about only what this type carries; the
 * corresponding "X of Y seasons" framing for lineup efficiency specifically
 * lives on `RosterOpsSection`, which has that denominator to hand.
 */

import type { ManagerReportLimits } from "@/lib/manager-pulse/types";

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function limitSentences(limits: ManagerReportLimits): string[] {
  const sentences: string[] = [];

  if (limits.leagueSeasonsSkipped > 0) {
    const was = limits.leagueSeasonsSkipped === 1 ? "was" : "were";
    sentences.push(
      `${plural(limits.leagueSeasonsSkipped, "league-season")} ${was} skipped because this lookup has a limit on how many it reads.`,
    );
  }

  if (limits.leagueSeasonsWithoutLedger > 0) {
    sentences.push(
      `Lineup efficiency has no reading for ${plural(limits.leagueSeasonsWithoutLedger, "league-season")}. Those leagues have not been opened in League Pulse yet.`,
    );
  }

  if (limits.seasonsWithoutDraftObservations > 0) {
    sentences.push(
      `No per-pick draft timing yet for ${plural(limits.seasonsWithoutDraftObservations, "season")}.`,
    );
  }

  return sentences;
}

export function LimitsNote({ limits }: { limits: ManagerReportLimits }) {
  const sentences = limitSentences(limits);
  if (sentences.length === 0) return null;

  return (
    <section aria-labelledby="report-limits-heading" className="border-t border-line pt-4">
      <h2 id="report-limits-heading" className="text-sm font-semibold text-ink">
        What this report could not measure
      </h2>
      <ul className="mt-2 space-y-1.5">
        {sentences.map((sentence) => (
          <li key={sentence} className="text-sm leading-relaxed text-ink-muted">
            {sentence}
          </li>
        ))}
      </ul>
    </section>
  );
}
