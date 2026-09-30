/**
 * Manager Pulse: what a finished report did NOT read, said in words.
 *
 * A report built from 40 of 45 league-seasons is still a useful report, but
 * only if the reader is told it is 40 of 45. The rail at the side of the page
 * already lists the gaps; this is the short version that sits above the fold,
 * so nobody has to scroll to learn the report is partial.
 *
 * Pure and client-safe: it reads the stored limits block and nothing else.
 */

import type { ManagerReportLimits } from "./types";

export type ReportCoverage = {
  /** Nothing the run set out to read was missed. */
  complete: boolean;
  /** League-seasons the run tried to read and could not. */
  failed: number;
  /** League-seasons found but left out by the per-lookup cap. */
  skipped: number;
  /** The sentence for the page, or null when coverage is complete. */
  sentence: string | null;
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * `readCount` is the number of league-seasons the report actually covers
 * (`report.counts.leagueSeasons`), so the sentence can say "40 of 45".
 */
export function describeReportCoverage(
  limits: Pick<ManagerReportLimits, "leagueSeasonsSkipped" | "leagueSeasonsFailed"> | null | undefined,
  readCount: number,
): ReportCoverage {
  const failed = Math.max(0, Math.trunc(limits?.leagueSeasonsFailed ?? 0));
  const skipped = Math.max(0, Math.trunc(limits?.leagueSeasonsSkipped ?? 0));
  if (failed === 0 && skipped === 0) {
    return { complete: true, failed, skipped, sentence: null };
  }

  const found = readCount + failed + skipped;
  const parts: string[] = [
    `This report covers ${readCount} of the ${plural(found, "league-season", "league-seasons")} we found.`,
  ];
  if (failed > 0) {
    parts.push(
      `${plural(failed, "league-season", "league-seasons")} could not be read from Sleeper this time, so nothing from ${failed === 1 ? "it" : "them"} is counted.`,
    );
  }
  if (skipped > 0) {
    parts.push(
      `${plural(skipped, "league-season was", "league-seasons were")} left out because one lookup reads a limited number.`,
    );
  }
  return { complete: false, failed, skipped, sentence: parts.join(" ") };
}
