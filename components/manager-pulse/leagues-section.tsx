/**
 * Section 6.8: the league list.
 *
 * Every league-season counted in this report, most recent first, so a reader
 * can see the evidence behind every other section rather than take the
 * figures on faith. One real `<table>` throughout, at every breakpoint:
 * below `sm` the type, finish and result columns hide via `sm:table-cell`,
 * but the same three values reappear as a second line inside the row header
 * cell, so nothing a desktop reader sees is missing on a phone, per the
 * project's mobile-first rule. Record stays its own always-visible column at
 * every width, so it is not duplicated in that second line.
 *
 * `finish` is null for most rows by design (`ManagerLeagueRow`'s own doc
 * comment: only the champion and runner-up are known). The caption says why
 * once, up front, rather than leaving every blank cell to be guessed at.
 */

import Link from "next/link";
import { SectionFrame } from "./section-frame";
import type { ManagerLeagueCategory, ManagerLeagueRow } from "@/lib/manager-pulse/types";

const CATEGORY_LABEL: Record<ManagerLeagueCategory, string> = {
  dynasty: "Dynasty",
  redraft: "Redraft",
  "best-ball-dynasty": "Best Ball Dynasty",
  "best-ball-redraft": "Best Ball Redraft",
};

function recordLabel(row: ManagerLeagueRow): string {
  const { wins, losses, ties } = row.record;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function resultLabel(row: ManagerLeagueRow): string {
  if (row.champion) return "Champion";
  if (row.runnerUp) return "Runner-up";
  if (row.madePlayoffs) return "Made playoffs";
  return "";
}

export function LeaguesSection({
  leagues,
  isSample,
}: {
  leagues: ManagerLeagueRow[];
  /** True on the guest sample report. Prefixes the table's caption with a
   *  disclaimer, since a `<caption>` is the first thing announced on
   *  entering table navigation, the strongest fence a table can carry. */
  isSample?: boolean;
}) {
  const rows = [...leagues].sort((a, b) => b.season - a.season);
  const sampleNote = `${leagues.length} league-season${leagues.length === 1 ? "" : "s"} counted`;

  return (
    <SectionFrame
      id="leagues"
      title="Leagues"
      eyebrow="Section 8"
      accent="purple"
      sampleNote={sampleNote}
      isSample={isSample}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No league-seasons found in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-xs leading-relaxed text-ink-subtle">
              {isSample && "Sample data. Every league and number below is invented, not a real manager. "}
              Every league-season counted in this report, most recent first. Finish is known only
              for the champion and the runner-up; every other row leaves it blank rather than
              guess a rank we do not hold.
            </caption>
            <thead className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  Season and league
                </th>
                <th scope="col" className="hidden py-2 pr-3 sm:table-cell">
                  Type
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  Record
                </th>
                <th scope="col" className="hidden py-2 pr-3 text-right sm:table-cell">
                  Finish
                </th>
                <th scope="col" className="hidden py-2 pr-3 text-right sm:table-cell">
                  Result
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((row) => {
                const key = row.leagueId ?? `${row.sleeperLeagueId}-${row.season}`;
                const result = resultLabel(row);
                const categoryLabel = CATEGORY_LABEL[row.category];

                // Shown below sm only, beside the row header, so the type,
                // finish and result columns above are never simply hidden:
                // the same three values are still reachable on a phone.
                const mobileSummary = [
                  categoryLabel,
                  row.finish !== null ? `${row.finish} finish` : null,
                  result || null,
                ]
                  .filter(Boolean)
                  .join(", ");

                const nameText = `${row.season} ${row.leagueName}`;

                return (
                  <tr key={key} className="hover:bg-surface">
                    <th scope="row" className="py-2 pr-3 text-left font-normal align-top">
                      {row.hasLeaguePulseLink ? (
                        <Link
                          href={`/leagues/${row.sleeperLeagueId}`}
                          className="inline-flex min-h-11 items-center rounded text-left font-medium text-ink transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          {nameText}
                        </Link>
                      ) : (
                        <span className="block font-medium text-ink">{nameText}</span>
                      )}
                      {/* A sibling of the link, not a child: below sm this is
                          the only place type, finish and result reach a
                          reader, and nesting it inside the link would fold it
                          into the link's own accessible name, announcing a
                          destination that is really a data summary. */}
                      <span className="mt-0.5 block text-xs text-ink-subtle sm:hidden">
                        {mobileSummary}
                      </span>
                    </th>
                    <td className="hidden py-2 pr-3 align-top text-ink-muted sm:table-cell">
                      {categoryLabel}
                    </td>
                    <td className="py-2 pr-3 text-right align-top font-mono tabular-nums text-ink">
                      {recordLabel(row)}
                    </td>
                    <td className="hidden py-2 pr-3 text-right align-top sm:table-cell">
                      {row.finish !== null ? (
                        <span className="font-mono tabular-nums text-ink-muted">{row.finish}</span>
                      ) : (
                        <span className="text-ink-subtle">
                          {"--"}
                          <span className="sr-only"> Not known</span>
                        </span>
                      )}
                    </td>
                    <td className="hidden py-2 pr-3 text-right align-top sm:table-cell">
                      {result ? (
                        <span className="text-ink-muted">{result}</span>
                      ) : (
                        <span className="text-ink-subtle">
                          {"--"}
                          <span className="sr-only"> No special result</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionFrame>
  );
}
