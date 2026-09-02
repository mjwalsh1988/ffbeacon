"use client";

/**
 * The Decisions leaderboard.
 *
 * Ordered by lineup efficiency and only by lineup efficiency. That is the
 * product decision, and it is the same one the Power Pulse table makes for its
 * own headline: a page about how well a manager has played their roster should
 * rank by exactly that, and letting a reader re-sort by points scored would
 * quietly turn it back into a standings table, which the league already has.
 *
 * Nothing is hidden by the ordering. Every row carries the team's SCORING rank
 * next to its EFFICIENCY rank, and the gap between them is the most interesting
 * number in most leagues: first in scoring and last in efficiency is a manager
 * being carried by a roster, and the reverse is a manager getting everything
 * there was to get.
 *
 * NO DATA IS HIDDEN AT ANY BREAKPOINT. Desktop drops columns as the viewport
 * narrows and expands the full ledger in place; mobile opens the identical
 * ledger in a bottom sheet from the team button. Both render the same
 * `LedgerDetail`, so there is one implementation of the numbers and two ways
 * in.
 */

import { Fragment, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { LedgerViewTeam } from "@/lib/league-manager-ledger-data";
import { LedgerDetail } from "./ledger-detail";
import { games, pct, pts, record, summarySentence } from "./format";

/**
 * Colour for the efficiency figure. Always paired with the number itself, and
 * with a rank in the accessible name, so colour is never the only carrier.
 */
function efficiencyTone(value: number | null): string {
  if (value === null) return "text-ink-subtle";
  if (value >= 0.9) return "text-brand-cyan";
  if (value >= 0.82) return "text-ink";
  return "text-brand-purple";
}

/** The efficiency rank against the scoring rank, as a word rather than an arrow. */
function GapCell({ team, total }: { team: LedgerViewTeam; total: number }) {
  if (team.efficiencyRank === null || team.scoringRank === null) {
    return (
      <span className="text-xs text-ink-subtle">
        <span aria-hidden="true">--</span>
        <span className="sr-only">Not ranked</span>
      </span>
    );
  }
  // Positive means the manager ranks better on decisions than the roster ranks
  // on production, so they are getting more out of less.
  const gap = team.scoringRank - team.efficiencyRank;
  const cls =
    gap === 0 ? "text-ink-muted" : gap > 0 ? "text-signal-success" : "text-signal-danger";
  const word = gap === 0 ? "even" : gap > 0 ? `up ${gap}` : `down ${Math.abs(gap)}`;
  // "up 3" on its own says nothing about what moved or in which direction, so
  // the ear gets the whole claim and the eye gets the shorthand.
  const spoken =
    gap === 0
      ? "the same rank on decisions as on points"
      : gap > 0
        ? `${gap} place${gap === 1 ? "" : "s"} better on decisions than on points`
        : `${Math.abs(gap)} place${Math.abs(gap) === 1 ? "" : "s"} worse on decisions than on points`;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-xs tabular-nums text-ink">
        <span aria-hidden="true">{team.scoringRank}</span>
        <span className="sr-only">
          {team.scoringRank} of {total} on points scored
        </span>
      </span>
      <span className={`font-mono text-[10px] font-semibold tabular-nums ${cls}`}>
        <span aria-hidden="true">{word}</span>
        <span className="sr-only">{spoken}</span>
      </span>
    </span>
  );
}

function TeamIdentity({ team }: { team: LedgerViewTeam }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {/* Decorative: the team name is rendered immediately beside it, and
          ImageWithFallback treats an empty alt as exactly that. Passing the
          name here would announce it twice on every row. */}
      <SleeperAvatar avatarId={team.ownerAvatarId} title="" size={28} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{team.teamName}</span>
        {team.ownerLabel ? (
          <span className="block truncate text-xs text-ink-subtle">{team.ownerLabel}</span>
        ) : null}
      </span>
    </span>
  );
}

export function LedgerTable({ teams }: { teams: LedgerViewTeam[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sheetTeam, setSheetTeam] = useState<LedgerViewTeam | null>(null);
  const sheetHeadingId = useId();
  const total = teams.length;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Managers ordered by the share of their own points each one started. Columns:
            rank, team, share started, points left on the bench, record, the record their
            best lineup would have produced, losses the bench would have won, and their rank
            on points scored with the gap between the two ranks. Activate the details button
            at the end of a row, or the team name on a narrow screen, to open a full
            ledger.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-px whitespace-nowrap px-2 py-3 text-center">
                {/* "#" is announced as "number sign" or "pound", which is not
                    what this column is. */}
                <span aria-hidden="true">#</span>
                <span className="sr-only">Rank</span>
              </th>
              <th scope="col" className="px-3 py-3">
                Team
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                Started
              </th>
              <th scope="col" className="hidden px-3 py-3 text-right md:table-cell">
                Left behind
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
                Record
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
                Best lineup
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                Wins left
              </th>
              <th scope="col" className="hidden px-3 py-3 text-right md:table-cell">
                Points rank
              </th>
              <th scope="col" className="w-px px-2 py-3">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {teams.map((team) => {
              const isOpen = expanded === team.sleeperRosterId;
              const detailId = `ledger-detail-${team.sleeperRosterId}`;
              const summaryId = `ledger-summary-${team.sleeperRosterId}`;
              const summary = summarySentence({
                teamName: team.teamName,
                efficiency: team.efficiency,
                efficiencyRank: team.efficiencyRank,
                scoringRank: team.scoringRank,
                winsLeftOnBench: team.winsLeftOnBench,
                total,
              });

              return (
                <Fragment key={team.sleeperRosterId}>
                  <tr className="hover:bg-surface">
                    <td className="w-px whitespace-nowrap px-2 py-2.5 text-center font-mono text-sm font-bold tabular-nums text-ink-muted">
                      {team.efficiencyRank ?? (
                        <>
                          {/* Two hyphens are swallowed at the default
                              punctuation level, so the cell would announce as
                              empty. "Not measured" and "nothing there" are the
                              distinction this whole page exists to keep. */}
                          <span aria-hidden="true">--</span>
                          <span className="sr-only">Not ranked</span>
                        </>
                      )}
                    </td>

                    {/* The row header. Without scope="row" a reader moving
                        down the "Wins left" column in table navigation mode
                        hears a number with no team attached to it, and has to
                        arrow back to column two on every row to find out whose
                        it is. */}
                    <th scope="row" className="px-3 py-2.5 text-left font-normal">
                      {/* Mobile opens the sheet; desktop toggles the row below.
                          Both reach the same ledger, so neither width loses a
                          figure the other has. */}
                      {/* The one-sentence read on this manager, built from the
                          same figures the row shows. Not painted: sighted
                          readers have the columns, and repeating them as prose
                          on every row would bury the table.
                          
                          aria-hidden AND sr-only together, which looks
                          contradictory and is not. sr-only alone left it as
                          live text in the accessibility tree, so a reader going
                          down the table in browse mode heard the whole
                          paragraph, then heard the button announce it AGAIN as
                          its description: twice per row, twelve times over.
                          aria-describedby resolves text out of a hidden
                          element, which is exactly what the attribute is for,
                          so it is still announced once when a control takes
                          focus and never as part of the row. */}
                      <span id={summaryId} aria-hidden="true" className="sr-only">
                        {summary}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSheetTeam(team)}
                        aria-haspopup="dialog"
                        aria-label={`Open the decision ledger for ${team.teamName}`}
                        aria-describedby={summaryId}
                        className="flex min-h-11 w-full items-center text-left transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:hidden"
                      >
                        <TeamIdentity team={team} />
                      </button>
                      <span className="hidden md:flex">
                        <TeamIdentity team={team} />
                      </span>
                    </th>

                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`font-mono text-base font-extrabold tabular-nums ${efficiencyTone(team.efficiency)}`}
                      >
                        {pct(team.efficiency)}
                      </span>
                    </td>

                    <td className="hidden px-3 py-2.5 text-right font-mono text-xs tabular-nums text-ink-muted md:table-cell">
                      {pts(team.pointsLeft)}
                      {team.pointsLeftPerWeek === null ? null : (
                        <span className="block text-[10px] text-ink-subtle">
                          {pts(team.pointsLeftPerWeek)}
                          <span aria-hidden="true">/wk</span>
                          <span className="sr-only"> per week</span>
                        </span>
                      )}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {record(team.actualRecord)}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink lg:table-cell">
                      {record(team.bestLineupRecord)}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center md:table-cell">
                      <span
                        className={`font-mono text-sm font-bold tabular-nums ${
                          team.winsLeftOnBench > 0 ? "text-brand-purple" : "text-ink-muted"
                        }`}
                      >
                        {/* The bare number for the eye, the same number inside a
                            sentence for the ear. Not both to both, or a screen
                            reader hears "three, three games lost". */}
                        <span aria-hidden="true">{team.winsLeftOnBench}</span>
                        <span className="sr-only">
                          {games(team.winsLeftOnBench)} lost that the bench would have won
                        </span>
                      </span>
                    </td>

                    <td className="hidden px-3 py-2.5 text-right md:table-cell">
                      <GapCell team={team} total={total} />
                    </td>

                    <td className="w-px px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : team.sleeperRosterId)}
                        aria-expanded={isOpen}
                        aria-controls={detailId}
                        aria-label={
                          isOpen
                            ? `Hide the decision ledger for ${team.teamName}`
                            : `Show the decision ledger for ${team.teamName}`
                        }
                        aria-describedby={summaryId}
                        className="hidden h-11 w-11 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:inline-flex"
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>

                  {/* The expanded row is always present in the DOM so
                      aria-controls always resolves to something. It is emptied
                      rather than merely hidden, so a closed ledger costs
                      nothing to render. */}
                  <tr id={detailId} className={isOpen ? "hidden md:table-row" : "hidden"}>
                    <td colSpan={9} className="border-t border-line-accent bg-surface px-3 pb-4">
                      {isOpen ? (
                        <>
                          {/* The h3 the Panel's h2 and the detail's own
                              sections need between them. Visually hidden
                              because the row above it already names the team;
                              present so the outline does not skip a level. */}
                          <h3 className="sr-only">
                            Decision ledger for {team.teamName}
                          </h3>
                          <LedgerDetail
                            team={team}
                            teamCount={total}
                            headingLevel={4}
                          />
                        </>
                      ) : null}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <BottomSheet
        open={sheetTeam !== null}
        onClose={() => setSheetTeam(null)}
        label={sheetTeam ? `Decision ledger for ${sheetTeam.teamName}` : "Decision ledger"}
        labelledBy={sheetHeadingId}
      >
        {sheetTeam ? (
          <div className="space-y-3">
            <div>
              <h3 id={sheetHeadingId} className="text-base font-semibold text-ink">
                {sheetTeam.teamName}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {summarySentence({
                  teamName: sheetTeam.teamName,
                  efficiency: sheetTeam.efficiency,
                  efficiencyRank: sheetTeam.efficiencyRank,
                  scoringRank: sheetTeam.scoringRank,
                  winsLeftOnBench: sheetTeam.winsLeftOnBench,
                  total,
                })}
              </p>
            </div>
            <LedgerDetail team={sheetTeam} teamCount={total} headingLevel={4} />
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
