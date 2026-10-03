"use client";

/**
 * Fantasy points allowed by position: thirty-two defenses against
 * quarterbacks, running backs, wide receivers and tight ends.
 *
 * EVERY CELL PRINTS ITS NUMBER AND ITS RANK. The tint repeats the rank (green
 * for a defense that gives up a lot to the position, red for one that gives up
 * little) and never stands in for it, so the grid reads the same in greyscale
 * and to a screen reader.
 *
 * SORTABLE BY COLUMN. Each column header is a button; aria-sort on the header
 * says which column the rows are ordered by and in which direction, and the
 * change is announced through the caption's live region.
 *
 * THE FIGURE IS RAW. It is points allowed per game to the startable players at
 * a position, this season, not adjusted for the offenses a defense has faced.
 * The projection path applies a schedule-adjusted, shrunk version of this
 * (lib/calculate-defense-splits.ts); the note under the grid says so, because
 * the two can disagree about a team in September.
 *
 * Five columns fit most phones. On the narrowest the table scrolls sideways
 * inside its own focusable region, so the last column is never clipped.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { positionNoun } from "@/lib/site";
import { MATCHUP_POSITIONS, teamNickname } from "@/lib/season-pulse/games";
import type { DefenseVsPositionRow, SeasonPosition } from "@/lib/season-pulse/types";

type SortKey = "team" | SeasonPosition;

function tint(rank: number, teams: number): string {
  if (rank <= 3) return "bg-signal-success/35";
  if (rank <= 8) return "bg-signal-success/[0.16]";
  if (rank > teams - 3) return "bg-[#F87171]/30";
  if (rank > teams - 8) return "bg-[#F87171]/[0.13]";
  return "";
}

function SortIcon({ column, sortKey, descending }: { column: SortKey; sortKey: SortKey; descending: boolean }) {
  if (column !== sortKey) return <ArrowUpDown aria-hidden="true" className="h-3 w-3 opacity-60" />;
  return descending ? (
    <ArrowDown aria-hidden="true" className="h-3 w-3" />
  ) : (
    <ArrowUp aria-hidden="true" className="h-3 w-3" />
  );
}

export function DefenseGrid({ rows, scoringLabel }: { rows: DefenseVsPositionRow[]; scoringLabel: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("team");
  const [descending, setDescending] = useState(false);
  const teams = rows.length;

  const sorted = useMemo(() => {
    const list = [...rows];
    if (sortKey === "team") {
      list.sort((a, b) => a.name.localeCompare(b.name));
      if (descending) list.reverse();
      return list;
    }
    // Rank 1 allows the most. "Descending" here means most points first.
    list.sort((a, b) => (a.cells[sortKey]?.rank ?? 99) - (b.cells[sortKey]?.rank ?? 99));
    if (!descending) list.reverse();
    return list;
  }, [rows, sortKey, descending]);

  const choose = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((d) => !d);
    } else {
      setSortKey(key);
      // A position opens on the most generous defense; team opens A to Z.
      setDescending(key !== "team");
    }
  };

  const sortWords =
    sortKey === "team"
      ? `team name, ${descending ? "Z to A" : "A to Z"}`
      : `points allowed to ${positionNoun(sortKey, "plural")}, ${descending ? "most first" : "fewest first"}`;

  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
        Points allowed by position are rebuilt after each week&apos;s games and are not available yet this season.
      </p>
    );
  }

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    key !== sortKey ? "none" : descending ? "descending" : "ascending";

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{`Sorted by ${sortWords}.`}</p>
      <div
        role="region"
        aria-label="Points allowed by position table"
        tabIndex={0}
        className="beacon-scroll overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            {`Fantasy points allowed per game by each defense to each position, ${scoringLabel} scoring, with the rank beside it where 1 allows the most.`}
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface-elevated/50 text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
              <th scope="col" aria-sort={ariaSort("team")} className="p-0 font-semibold">
                <button
                  type="button"
                  onClick={() => choose("team")}
                  className="flex min-h-11 w-full items-center gap-1 px-2 text-left uppercase tracking-[0.12em] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan sm:px-3"
                >
                  Defense
                  <SortIcon column="team" sortKey={sortKey} descending={descending} />
                </button>
              </th>
              {MATCHUP_POSITIONS.map((position) => (
                <th key={position} scope="col" aria-sort={ariaSort(position)} className="p-0 font-semibold">
                  <button
                    type="button"
                    onClick={() => choose(position)}
                    className="flex min-h-11 w-full items-center justify-end gap-1 px-2 uppercase tracking-[0.12em] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan sm:px-3"
                  >
                    {position}
                    <span className="sr-only">{`, ${positionNoun(position, "plural")}`}</span>
                    <SortIcon column={position} sortKey={sortKey} descending={descending} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {sorted.map((row) => (
              <tr key={row.team}>
                <th scope="row" className="px-2 py-1.5 text-left font-normal sm:px-3">
                  <span className="flex items-center gap-2">
                    <NflTeamLogo team={row.team} size={22} />
                    {/* The nickname from sm up, the code on a phone. One is displayed, so one is read. */}
                    <span className="text-sm font-medium text-ink sm:hidden">
                      {row.team}
                      <span className="sr-only">{`, ${teamNickname(row.name)}`}</span>
                    </span>
                    <span className="hidden text-sm font-medium text-ink sm:inline">{teamNickname(row.name)}</span>
                  </span>
                </th>
                {MATCHUP_POSITIONS.map((position) => {
                  const cell = row.cells[position];
                  return (
                    <td key={position} className="p-1 text-right">
                      {cell ? (
                        <span className={`block rounded-md px-1.5 py-1 ${tint(cell.rank, teams)}`}>
                          <span className="block font-mono text-sm font-semibold tabular-nums text-ink">
                            {cell.perGame.toFixed(1)}
                          </span>
                          <span className="block font-mono text-[10px] tabular-nums text-ink">
                            <span className="sr-only">rank </span>#{cell.rank}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-ink-subtle">n/a</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
        Points allowed per game to the startable players at each position this season, {scoringLabel} scoring. Rank 1
        allows the most, which is the softest matchup; green is soft and red is tough. These are raw figures, not
        adjusted for the offenses a defense has faced, so a hard early schedule can make a good defense look generous.
      </p>
    </div>
  );
}
