"use client";

/**
 * The Decisions leaderboard.
 *
 * Ordered by lineup efficiency and only by lineup efficiency. That is the
 * product decision, and it is the same one the Power Pulse table makes for its
 * own headline: a page about how well a manager has played their roster should
 * rank by exactly that, and letting a reader re-sort by points scored would
 * quietly turn it back into a standings table, which the league already has.
 * A best ball league has no lineup decisions, so its rows follow points rank
 * and the lineup columns are left out rather than shown empty.
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
 *
 * EVERY FIGURE IS ONE TEXT NODE. A null prints as words, never as a dash with
 * an sr-only twin.
 */

import { Fragment, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { LedgerViewTeam } from "@/lib/league-manager-ledger-data";
import { LedgerDetail } from "./ledger-detail";
import { pct, pts, record, summarySentence, type LedgerWords } from "./format";

/**
 * Color for the efficiency figure. Always paired with the number itself, and
 * with a rank in the row, so color is never the only carrier.
 */
function efficiencyTone(value: number | null): string {
  if (value === null) return "text-ink-subtle";
  if (value >= 0.9) return "text-brand-cyan";
  if (value >= 0.82) return "text-ink";
  return "text-brand-purple";
}

/** The points rank, and how the decisions rank compares, as words. */
function GapCell({
  team,
  total,
  gradesLineups,
}: {
  team: LedgerViewTeam;
  total: number;
  gradesLineups: boolean;
}) {
  if (team.scoringRank === null) {
    return <span className="text-xs text-ink-subtle">Not ranked</span>;
  }
  const rank = (
    <span className="font-mono text-xs tabular-nums text-ink">
      {`${team.scoringRank} of ${total}`}
    </span>
  );
  if (!gradesLineups || team.efficiencyRank === null) {
    return <span className="inline-flex flex-col items-end leading-tight">{rank}</span>;
  }
  // Positive means the manager ranks better on decisions than the roster ranks
  // on points, so they are getting more out of less.
  const gap = team.scoringRank - team.efficiencyRank;
  const cls =
    gap === 0 ? "text-ink-muted" : gap > 0 ? "text-signal-success" : "text-signal-danger";
  const word =
    gap === 0
      ? "same on decisions"
      : gap > 0
        ? `${gap} better on decisions`
        : `${Math.abs(gap)} worse on decisions`;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      {rank}
      <span className={`text-[10px] font-semibold ${cls}`}>{word}</span>
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

export function LedgerTable({
  teams,
  words,
}: {
  teams: LedgerViewTeam[];
  words: LedgerWords;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [sheetTeam, setSheetTeam] = useState<LedgerViewTeam | null>(null);
  const sheetHeadingId = useId();
  const total = teams.length;
  const lineups = words.gradesLineups;
  // Rank, team, points rank, details, plus the lineup columns where they apply.
  const columnCount = lineups ? 9 : 6;

  const summaryOf = (team: LedgerViewTeam) =>
    summarySentence({
      teamName: team.teamName,
      efficiency: team.efficiency,
      efficiencyRank: team.efficiencyRank,
      scoringRank: team.scoringRank,
      winsLeftOnBench: team.winsLeftOnBench,
      total,
      words,
    });

  return (
    <>
      {lineups ? (
        <dl className="mb-3 grid gap-1 text-xs leading-relaxed text-ink-muted sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold text-ink">Started: </dt>
            <dd className="inline">the share of their roster&apos;s points they started.</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-ink">Left behind: </dt>
            <dd className="inline">points their best lineup would have added.</dd>
          </div>
        </dl>
      ) : (
        <p className="mb-3 text-xs leading-relaxed text-ink-muted">
          Best ball sets every lineup itself, so teams are ordered by points.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {lineups
              ? `Managers ordered by the share of their own points each one started. Columns: rank, team, share started, points left on the bench, ${words.recordLabel.toLowerCase()}, the same with their best lineup, ${words.winsLeftLabel.toLowerCase()}, and their rank on points scored. Activate the details button at the end of a row, or the team name on a narrow screen, to open a full ledger.`
              : `Teams ordered by points scored. Columns: rank, team, ${words.recordLabel.toLowerCase()}, waiver points started, and points rank. Activate the details button at the end of a row, or the team name on a narrow screen, to open a full ledger.`}
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-px whitespace-nowrap px-2 py-3 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3">
                Team
              </th>
              {lineups ? (
                <>
                  <th scope="col" className="px-3 py-3 text-center">
                    Started
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-right md:table-cell">
                    Left behind
                  </th>
                </>
              ) : null}
              <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
                {words.recordLabel}
              </th>
              {lineups ? (
                <>
                  <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
                    {words.bestRecordLabel}
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                    {words.winsLeftLabel}
                  </th>
                </>
              ) : (
                <th scope="col" className="hidden px-3 py-3 text-right md:table-cell">
                  Waiver points
                </th>
              )}
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
              const rowRank = lineups ? team.efficiencyRank : team.scoringRank;

              return (
                <Fragment key={team.sleeperRosterId}>
                  <tr className="hover:bg-surface">
                    <td className="w-px whitespace-nowrap px-2 py-2.5 text-center font-mono text-sm font-bold tabular-nums text-ink-muted">
                      {rowRank === null ? (
                        <span className="font-sans text-[10px] font-normal">Not ranked</span>
                      ) : (
                        rowRank
                      )}
                    </td>

                    {/* The row header. Without scope="row" a reader moving
                        down a column in table navigation mode hears a number
                        with no team attached to it. */}
                    <th scope="row" className="px-3 py-2.5 text-left font-normal">
                      {/* The one-sentence read on this manager, built from the
                          same figures the row shows. Hidden from the tree and
                          used only as the buttons' description, so it is heard
                          once when a control takes focus and never as part of
                          the row. */}
                      <span id={summaryId} aria-hidden="true" className="sr-only">
                        {summaryOf(team)}
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

                    {lineups ? (
                      <>
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
                              {`${pts(team.pointsLeftPerWeek)} a week`}
                            </span>
                          )}
                        </td>
                      </>
                    ) : null}

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {record(team.actualRecord)}
                    </td>

                    {lineups ? (
                      <>
                        <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink lg:table-cell">
                          {record(team.bestLineupRecord)}
                        </td>

                        <td className="hidden px-3 py-2.5 text-center md:table-cell">
                          <span
                            className={`font-mono text-sm font-bold tabular-nums ${
                              team.winsLeftOnBench > 0 ? "text-brand-purple" : "text-ink-muted"
                            }`}
                          >
                            {team.winsLeftOnBench}
                          </span>
                        </td>
                      </>
                    ) : (
                      <td className="hidden px-3 py-2.5 text-right font-mono text-xs tabular-nums text-ink-muted md:table-cell">
                        {pts(team.waiverPointsStarted)}
                      </td>
                    )}

                    <td className="hidden px-3 py-2.5 text-right md:table-cell">
                      <GapCell team={team} total={total} gradesLineups={lineups} />
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
                    <td colSpan={columnCount} className="border-t border-line-accent bg-surface px-3 pb-4">
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
                            words={words}
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
                {summaryOf(sheetTeam)}
              </p>
            </div>
            <LedgerDetail team={sheetTeam} teamCount={total} words={words} headingLevel={4} />
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
