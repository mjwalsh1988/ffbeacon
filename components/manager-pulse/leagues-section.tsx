/**
 * Section 6.8: the league list.
 *
 * Every league-season counted in this report, so a reader can see the evidence
 * behind every other section rather than take the figures on faith.
 *
 * GROUPED BY SEASON, AS CARDS. Fifty rows of a five-column table is the
 * evidence and none of the meaning: the season is the first thing a reader
 * sorts by, and repeating it in every row costs a column to say what a heading
 * says once. Each card carries the league name, its type as a coloured chip,
 * the record as a figure AND as a win-share bar, and a result badge where
 * there is a result to report.
 *
 * THE TABLE IS STILL HERE, behind a disclosure, and that is not a courtesy: a
 * table is genuinely the better tool for comparing fifty records column by
 * column, and a screen reader's table navigation is the fastest way to do it.
 * Both renderings read the same rows, so neither can drift from the other.
 *
 * `finish` is null for most rows by design (`ManagerLeagueRow`'s own doc
 * comment: only the champion and runner-up are known). Both renderings say why
 * once, up front, rather than leaving every blank to be guessed at.
 */

import Link from "next/link";
import { ArrowUpRight, Crown, Medal, Trophy } from "lucide-react";
import { SectionFrame } from "./section-frame";
import type { ManagerLeagueCategory, ManagerLeagueRow } from "@/lib/manager-pulse/types";

const CATEGORY_LABEL: Record<ManagerLeagueCategory, string> = {
  dynasty: "Dynasty",
  redraft: "Redraft",
  "best-ball-dynasty": "Best Ball Dynasty",
  "best-ball-redraft": "Best Ball Redraft",
};

/**
 * One tint per league type, and it is decorative: the label sits in text on
 * every chip, so nothing here is carried by colour alone. Dynasty takes the
 * brand purple and redraft the brand cyan, matching how the lens switch above
 * already separates the two.
 */
const CATEGORY_CHIP: Record<ManagerLeagueCategory, string> = {
  dynasty: "bg-brand-purple/15 text-brand-purple",
  redraft: "bg-brand-cyan/15 text-brand-cyan",
  "best-ball-dynasty": "bg-brand-purple/10 text-brand-purple/90",
  "best-ball-redraft": "bg-brand-cyan/10 text-brand-cyan/90",
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

/** Win share, for the record bar. Null where nothing has been played. */
function winShare(row: ManagerLeagueRow): number | null {
  const { wins, losses, ties } = row.record;
  const played = wins + losses + ties;
  if (played === 0) return null;
  return (wins + ties / 2) / played;
}

export function LeaguesSection({
  leagues,
  totalLeagueSeasons,
  isSample,
}: {
  leagues: ManagerLeagueRow[];
  /**
   * League-seasons this report actually counted, which is not the same as the
   * number of rows shown: `display.leagueRowsShown` caps the list. The note
   * used to read "50 league-seasons counted" on a report built from 60, which
   * contradicts the figure at the top of the page.
   */
  totalLeagueSeasons?: number;
  /** True on the guest sample report. Prefixes the table's caption with a
   *  disclaimer, since a `<caption>` is the first thing announced on
   *  entering table navigation, the strongest fence a table can carry. */
  isSample?: boolean;
}) {
  const rows = [...leagues].sort((a, b) => b.season - a.season);
  const total = totalLeagueSeasons ?? leagues.length;
  const sampleNote =
    total > leagues.length
      ? `Showing ${leagues.length} of ${total} league-seasons counted`
      : `${total} league-season${total === 1 ? "" : "s"} counted`;

  // Newest season first, and each season's leagues alphabetical inside it, so
  // a reader returning to the same report finds the same league in the same
  // place rather than wherever the sync happened to write it.
  const seasons = [...new Set(rows.map((row) => row.season))].sort((a, b) => b - a);

  return (
    <SectionFrame
      id="leagues"
      title="Leagues"
      accent="purple"
      sampleNote={sampleNote}
      isSample={isSample}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No league-seasons found in this window.</p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-ink-subtle">
            {isSample &&
              "Sample data. Every league and number below is invented, not a real manager. "}
            Every league-season counted in this report, newest first. A finish is known only for
            the champion and the runner-up; every other card leaves it out rather than guess a
            rank we do not hold.
          </p>

          {/* THE INNER SCROLL STARTS AT `sm`, NOT ON A PHONE. A capped, scrollable
              box nested inside page scroll is a trap on touch: a finger that
              lands on the list scrolls the list instead of the page, and the
              reader cannot tell which one they are moving. On a phone the list
              simply extends the page. */}
          <div className="beacon-scroll space-y-4 sm:max-h-[36rem] sm:overflow-y-auto sm:pr-1">
            {seasons.map((season) => {
              const inSeason = rows
                .filter((row) => row.season === season)
                .sort((a, b) => a.leagueName.localeCompare(b.leagueName));
              return (
                <section key={season} aria-labelledby={`mp-leagues-${season}`}>
                  {/* Sticky inside the scroll box: with fifty cards scrolling
                      past, a season heading that scrolls away with them leaves
                      a reader unable to say which year they are looking at. */}
                  <h3
                    id={`mp-leagues-${season}`}
                    className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-surface/95 px-1 py-1.5 text-sm font-bold text-ink backdrop-blur"
                  >
                    {season}
                    <span className="text-[11px] font-medium text-ink-subtle">
                      {inSeason.length} league{inSeason.length === 1 ? "" : "s"}
                    </span>
                  </h3>
                  <ul className="mt-1.5 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {inSeason.map((row) => (
                      <LeagueCard
                        key={row.leagueId ?? `${row.sleeperLeagueId}-${row.season}`}
                        row={row}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
              <span className="group-open:hidden">View these as a table</span>
              <span className="hidden group-open:inline">Hide the table</span>
            </summary>
            <div className="beacon-scroll mt-2 max-h-[32rem] overflow-auto">
              <LeaguesTable rows={rows} isSample={isSample} />
            </div>
          </details>
        </>
      )}
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------- card */

function ResultBadge({ row }: { row: ManagerLeagueRow }) {
  const label = resultLabel(row);
  if (!label) return null;

  const Icon = row.champion ? Trophy : row.runnerUp ? Medal : Crown;
  const tone = row.champion
    ? "border-signal-warning/50 bg-signal-warning/10 text-signal-warning"
    : row.runnerUp
      ? "border-ink-subtle/40 bg-ink-subtle/10 text-ink"
      : "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

function LeagueCard({ row }: { row: ManagerLeagueRow }) {
  const share = winShare(row);
  const categoryLabel = CATEGORY_LABEL[row.category];
  const nameText = row.leagueName;

  return (
    <li className="flex flex-col rounded-card border border-line bg-base/40 px-3 py-2.5 transition-colors hover:border-brand-cyan/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {row.hasLeaguePulseLink ? (
            <Link
              href={`/leagues/${row.sleeperLeagueId}`}
              className="inline-flex min-h-11 items-center gap-1 text-left text-sm font-semibold text-ink transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="line-clamp-2">{nameText}</span>
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            </Link>
          ) : (
            <p className="line-clamp-2 text-sm font-semibold text-ink">{nameText}</p>
          )}
        </div>
        <p className="shrink-0 text-right font-mono text-xl font-extrabold leading-none tabular-nums text-ink">
          {recordLabel(row)}
        </p>
      </div>

      {/* The record drawn as a win share. aria-hidden: the record above it is
          the same information as text, and the sentence below names the
          percentage. */}
      {share !== null && (
        <span
          aria-hidden="true"
          className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-signal-warning/25"
        >
          <span
            className="block h-full rounded-full bg-signal-success"
            style={{ width: `${Math.round(share * 100)}%` }}
          />
        </span>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CATEGORY_CHIP[row.category]}`}
        >
          {categoryLabel}
        </span>
        {row.finish !== null && (
          <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
            Finished {row.finish}
          </span>
        )}
        <ResultBadge row={row} />
        {share === null && (
          <span className="text-[10px] text-ink-subtle">Not played yet</span>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ table */

/**
 * The same rows, as a real table, for column-by-column comparison.
 *
 * Below `sm` the type, finish and result columns hide via `sm:table-cell`, and
 * the same three values reappear as a second line inside the row header cell,
 * so nothing a desktop reader sees is missing on a phone, per the project's
 * mobile-first rule. Record stays its own always-visible column at every
 * width, so it is not duplicated in that second line.
 */
function LeaguesTable({ rows, isSample }: { rows: ManagerLeagueRow[]; isSample?: boolean }) {
  return (
    <table className="w-full text-left text-sm">
      <caption className="mb-2 text-left text-xs leading-relaxed text-ink-subtle">
        {isSample && "Sample data. Every league and number below is invented, not a real manager. "}
        Every league-season counted in this report, most recent first. Finish is known only for the
        champion and the runner-up; every other row leaves it blank rather than guess a rank we do
        not hold.
      </caption>
      <thead className="sticky top-0 z-10 border-b border-line bg-surface text-left text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
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

          // Shown below sm only, beside the row header, so the type, finish and
          // result columns above are never simply hidden: the same three values
          // are still reachable on a phone.
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
              <th scope="row" className="py-2 pr-3 text-left align-top font-normal">
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
                {/* A sibling of the link, not a child: below sm this is the only
                    place type, finish and result reach a reader, and nesting it
                    inside the link would fold it into the link's own accessible
                    name, announcing a destination that is really a data
                    summary. */}
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
  );
}
