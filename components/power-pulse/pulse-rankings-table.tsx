"use client";

/**
 * The Power Pulse rankings table.
 *
 * Sorted by Power Pulse and only by Power Pulse. That is the product decision:
 * a "power ranking" should rank teams by how likely they are to win, and letting
 * users re-sort by trade value would quietly turn it back into an asset list.
 * Trade value is not hidden though. Every row carries the team's value rank and,
 * more usefully, the gap between the two rankings. A team sitting 1st in value
 * and 6th in Power Pulse is the most interesting story in most leagues, and this
 * column is where you see it.
 *
 * Desktop shows the full row and expands in place. Mobile shows rank, team, and
 * the score, with a bottom sheet carrying every column the table drops, so no
 * data is lost at any breakpoint.
 */

import { Fragment, useId, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { ownerLine } from "@/lib/team-label";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { TeamStatusBadge } from "@/components/team-status-badge";
import type { PulseTeam } from "@/lib/league-power-pulse-data";
import type { PlayoffPhase } from "@/lib/power-pulse/playoffs";
import { PulseDetail, pct } from "./pulse-detail";
import {
  ordinal,
  pctOdds,
  phaseLine,
  playedRecordText,
  playoffFigure,
  playoffIsOdds,
  projectedRecordText,
  titleFigure,
} from "./odds-format";
import type { LeagueEmphasis } from "@/lib/league-emphasis";

/** Color ramp for the headline score. Always paired with the number itself. */
function scoreTone(score: number): {
  text: string;
  ring: string;
  glow: string;
} {
  if (score >= 70)
    return {
      text: "text-brand-cyan",
      ring: "border-brand-cyan/50",
      glow: "shadow-[0_0_28px_-14px_rgba(34,211,238,0.95)]",
    };
  if (score >= 45)
    return { text: "text-ink", ring: "border-line-accent", glow: "" };
  return {
    text: "text-brand-purple",
    ring: "border-brand-purple/50",
    glow: "shadow-[0_0_28px_-16px_rgba(168,85,247,0.9)]",
  };
}

function DivergenceChip({ team }: { team: PulseTeam }) {
  if (team.valueRank === null || team.rankDivergence === null) {
    return <span className="text-xs text-ink-subtle">No value rank</span>;
  }
  const d = team.rankDivergence;
  const even = d === 0;
  const better = d > 0;
  const cls = even
    ? "text-ink-muted"
    : better
      ? "text-signal-success"
      : "text-signal-danger";
  // The word carries the meaning; color only reinforces it.
  const word = even ? "even" : better ? `up ${d}` : `down ${Math.abs(d)}`;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-xs tabular-nums text-ink">
        {ordinal(team.valueRank)}
      </span>
      <span
        className={`font-mono text-[10px] font-semibold tabular-nums ${cls}`}
      >
        {word}
      </span>
    </span>
  );
}

export function PulseRankingsTable({
  teams,
  sleeperLeagueId,
  linkUsername,
  valueLabel,
  emphasis,
}: {
  teams: PulseTeam[];
  sleeperLeagueId: string;
  linkUsername: string | null;
  /** e.g. "Dynasty PPR Superflex via FF Beacon". Shown in the value header. */
  valueLabel: string | null;
  /**
   * What the asset-value column is called in this league, and why.
   *
   * The ordering does not change: this table leads with Power Pulse in every
   * league because who wins games is the question everywhere. What changes is
   * the NAME. In a dynasty league the value column is a standing a reader is
   * genuinely managing; in a redraft league it is what a player would fetch in a
   * trade, and calling it a rank invites a reader to treat it as a second
   * scoreboard that nobody in that league is keeping.
   */
  emphasis: LeagueEmphasis;
}) {
  // A chopped league answers different questions in the same two columns:
  // there is no record to project and no bracket to reach, so "Proj." becomes
  // the weeks a roster is expected to last and "Playoffs" becomes the chance
  // of going out this week. Read off the rows rather than passed down, so the
  // header can never describe a column the cells beneath it are not filling.
  const chopped = teams.some((t) => t.chopped);
  // Before, during or after the playoffs. It changes what the Title and
  // Playoffs columns say: odds, then alive or out, then the final place.
  const phase = teams.find((t) => t.playoff)?.playoff?.phase ?? null;
  const regular = phase === null || phase === "regular";
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheetTeam, setSheetTeam] = useState<PulseTeam | null>(null);
  const sheetHeadingId = useId();
  const teamCount = teams.length;

  // This table is the only component on the tab holding every team, so it is
  // where the roster-id to handle lookup belongs. The expanded detail uses it
  // to name upcoming opponents the same way the rows themselves are named.
  const handleByRoster = new Map<number, string | null>(
    teams.map((t) => [t.sleeperRosterId, t.ownerHandle]),
  );

  const hrefFor = (team: PulseTeam) => {
    const qs = new URLSearchParams({
      tab: "teams",
      roster: String(team.sleeperRosterId),
    });
    if (linkUsername) qs.set("username", linkUsername);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  };

  return (
    <>
      {/* The hint sits here as its own sentence rather than inside the caption.
          Appended to a column enumeration it read as a fragment with no verb,
          and in a redraft league it closed with a second, contradictory claim
          about how the table is ordered. */}
      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        {emphasis.valueHint}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Power Pulse rankings, ordered by Power Pulse score. Columns: rank,
            team, Power Pulse score, outlook (competing, mid-table, or
            rebuilding), {emphasis.winsFirst ? "leverage" : "value"} rank with
            the difference between the two rankings,{" "}
            {chopped
              ? "weeks expected to last, chance of being chopped this week, chance of being the last team standing,"
              : regular
                ? "projected record, title odds, playoff odds,"
                : "record, result, seed,"}{" "}
            and lineup efficiency. Activate a team to open its full breakdown.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th
                scope="col"
                className="w-px whitespace-nowrap px-2 py-3 text-center"
              >
                #
              </th>
              <th scope="col" className="px-3 py-3">
                Team
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                Pulse
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-left md:table-cell"
              >
                Outlook
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-right md:table-cell"
                title={valueLabel ?? undefined}
              >
                {emphasis.winsFirst ? "Leverage rank" : "Value rank"}
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-center lg:table-cell"
              >
                {chopped ? "Weeks left" : regular ? "Proj." : "Record"}
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-center md:table-cell"
              >
                {chopped
                  ? "Chop risk"
                  : regular
                    ? "Playoffs"
                    : "Seed"}
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-center md:table-cell"
              >
                {chopped
                  ? "Last standing"
                  : phase === "complete"
                    ? "Result"
                    : phase === "playoffs"
                      ? "Bracket odds"
                      : "Title"}
              </th>
              <th
                scope="col"
                className="hidden px-3 py-3 text-center lg:table-cell"
              >
                Lineup
              </th>
              <th scope="col" className="w-px px-2 py-3">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {teams.map((team) => {
              const tone = scoreTone(team.powerPulse);
              const isOpen = expanded === team.rosterRowId;
              const detailId = `pulse-detail-${team.rosterRowId}`;
              return (
                <Fragment key={team.rosterRowId}>
                  <tr className="hover:bg-surface">
                    <td className="w-px whitespace-nowrap px-2 py-2.5 text-center font-mono text-sm font-bold tabular-nums text-ink-muted">
                      {team.pulseRank ?? "Unranked"}
                    </td>

                    <td className="px-3 py-2.5">
                      {/* Mobile: open the sheet. Desktop: go to the roster. */}
                      <button
                        type="button"
                        onClick={() => setSheetTeam(team)}
                        aria-haspopup="dialog"
                        aria-label={`Open the Power Pulse breakdown for ${team.teamName}, ranked ${team.pulseRank ?? "unranked"} of ${teamCount} with a Power Pulse of ${team.powerPulse}`}
                        className="flex w-full min-h-11 items-center gap-2.5 text-left transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:hidden"
                      >
                        <TeamIdentity
                          team={team}
                          oddsLine={mobileOddsLine(team, phase)}
                        />
                      </button>
                      <Link
                        href={hrefFor(team)}
                        className="hidden items-center gap-2.5 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:flex"
                      >
                        <TeamIdentity team={team} />
                      </Link>
                    </td>

                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-card border font-mono text-base font-extrabold tabular-nums ${tone.text} ${tone.ring} ${tone.glow}`}
                      >
                        {/* Real text plus the missing words sr-only in the
                            same element: an aria-label on a span is dropped. */}
                        {team.powerPulse}
                        <span className="sr-only"> out of 99</span>
                      </span>
                    </td>

                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {team.status ? (
                        <TeamStatusBadge
                          status={team.status}
                          size="sm"
                          compact
                        />
                      ) : (
                        <span className="text-xs text-ink-subtle">No outlook</span>
                      )}
                    </td>

                    <td className="hidden px-3 py-2.5 text-right md:table-cell">
                      <DivergenceChip team={team} />
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {chopped
                        ? team.expectedWeeksAlive !== null
                          ? team.expectedWeeksAlive.toFixed(1)
                          : "No projection"
                        : regular
                          ? projectedRecordText(team.projectedRecord)
                          : playedRecordText(team.record)}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center md:table-cell">
                      {chopped ? (
                        <ChopRiskCell odds={team.chopOddsThisWeek} />
                      ) : (
                        <PlayoffCell
                          text={playoffFigure(team, phase)}
                          odds={playoffIsOdds(team, phase) ? team.playoffOdds : null}
                        />
                      )}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center md:table-cell">
                      <TitleCell
                        text={titleFigure(team, phase)}
                        odds={chopped ? team.surviveAllOdds : team.titleOdds}
                        asOdds={chopped || phase === null || phase === "regular" || team.playoff?.status === "alive"}
                      />
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {team.lineupEfficiency === null
                        ? "No lineup data"
                        : pct(team.lineupEfficiency)}
                    </td>

                    <td className="w-px px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded(isOpen ? null : team.rosterRowId)
                        }
                        aria-expanded={isOpen}
                        // The detail row exists only while open, so point at
                        // it only then; a reference to a missing id is broken.
                        aria-controls={isOpen ? detailId : undefined}
                        aria-label={`${isOpen ? "Hide" : "Show"} the full breakdown for ${team.teamName}`}
                        className="hidden h-9 w-9 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:inline-flex"
                      >
                        <Chevron open={isOpen} />
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="hidden md:table-row">
                      <td
                        colSpan={10}
                        id={detailId}
                        className="bg-base/40 px-5 py-5"
                      >
                        <PulseDetail
                          team={team}
                          teamCount={teamCount}
                          teamHref={hrefFor(team)}
                          handleByRoster={handleByRoster}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        {phaseLine(phase, chopped)}
      </p>
      <details className="mt-2 rounded-card border border-line bg-base/40 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          What the columns mean
        </summary>
        <dl className="space-y-2 pb-2 text-xs leading-relaxed text-ink-muted">
          <div>
            <dt className="inline font-semibold text-ink">Pulse: </dt>
            <dd className="inline">
              A score from 1 to 99 for how well the team is expected to play from here.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-ink">Proj.: </dt>
            <dd className="inline">
              The final record averaged over simulated seasons, so it lands on fractions.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-ink">Lineup: </dt>
            <dd className="inline">
              The share of the best possible lineup&apos;s points the set lineup earns.
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-ink">Starter reliability: </dt>
            <dd className="inline">
              How far its starters run above or below their projections (in the team breakdown).
            </dd>
          </div>
        </dl>
      </details>

      <BottomSheet
        open={sheetTeam !== null}
        onClose={() => setSheetTeam(null)}
        label={
          sheetTeam
            ? `${sheetTeam.teamName} Power Pulse breakdown`
            : "Team breakdown"
        }
        labelledBy={sheetTeam ? sheetHeadingId : undefined}
        showClose={false}
      >
        {sheetTeam && (
          <div className="px-5 pb-6 pt-4">
            <header className="flex items-start gap-3 border-b border-line pb-4">
              <SleeperAvatar
                avatarId={sheetTeam.ownerAvatarId}
                initial={sheetTeam.teamName.charAt(0)}
                title={sheetTeam.teamName}
                size={48}
              />
              <div className="min-w-0 flex-1">
                <h2
                  id={sheetHeadingId}
                  className="truncate text-lg font-semibold tracking-tight text-ink"
                >
                  {sheetTeam.teamName}
                </h2>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">
                  {sheetTeam.pulseRank !== null
                    ? `${ordinal(sheetTeam.pulseRank)} of ${teamCount}`
                    : "unranked"}
                  {sheetTeam.valueRank !== null && (
                    <>
                      <span className="mx-1.5 text-ink-subtle">and</span>
                      {ordinal(sheetTeam.valueRank)} by{" "}
                      {emphasis.winsFirst ? "leverage" : "value"}
                    </>
                  )}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-card border px-3 py-2 font-mono text-xl font-extrabold tabular-nums ${scoreTone(sheetTeam.powerPulse).text} ${scoreTone(sheetTeam.powerPulse).ring}`}
              >
                <span className="sr-only">Power Pulse </span>
                {sheetTeam.powerPulse}
                <span className="sr-only"> out of 99</span>
              </span>
              {/* The first focusable element in the sheet, so it can be
                  dismissed without tabbing through the whole breakdown. Esc and
                  a backdrop tap already closed it; neither is discoverable, and
                  this sheet only ever opens on a phone, where there is no Esc
                  key to reach for. */}
              <button
                type="button"
                onClick={() => setSheetTeam(null)}
                aria-label={`Close the ${sheetTeam.teamName} breakdown`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>
            {sheetTeam.status && (
              <div className="mt-4 rounded-card border border-line bg-base px-4 py-3">
                <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                  Outlook
                </span>
                <span className="mt-1.5 block">
                  <TeamStatusBadge status={sheetTeam.status} />
                </span>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  {sheetTeam.status.reason}
                </p>
              </div>
            )}
            <div className="pt-4">
              <PulseDetail
                team={sheetTeam}
                teamCount={teamCount}
                teamHref={hrefFor(sheetTeam)}
                onNavigate={() => setSheetTeam(null)}
                handleByRoster={handleByRoster}
              />
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

/**
 * The odds a phone reader sees without opening the sheet. Below md the Title and
 * Playoffs columns are hidden, so the same two figures ride under the team.
 */
function mobileOddsLine(team: PulseTeam, phase: PlayoffPhase | null): string {
  if (team.chopped) {
    return `Last standing ${titleFigure(team, phase)}, chopped this week ${pctOdds(team.chopOddsThisWeek)}`;
  }
  if (phase === "playoffs" || phase === "complete") {
    return `${playoffFigure(team, phase)}. ${titleFigure(team, phase)}`;
  }
  return `Title ${titleFigure(team, phase)}, playoffs ${playoffFigure(team, phase)}`;
}

function TeamIdentity({
  team,
  oddsLine,
}: {
  team: PulseTeam;
  /** A short line of odds under the name. Shown only where the odds columns are not. */
  oddsLine?: string;
}) {
  return (
    <>
      <SleeperAvatar
        avatarId={team.ownerAvatarId}
        initial={team.teamName.charAt(0)}
        title={team.teamName}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {team.teamName}
        </span>
        {ownerLine(team.teamName, team.ownerHandle) && (
          <span className="block truncate text-[11px] text-ink-subtle">
            {ownerLine(team.teamName, team.ownerHandle)}
          </span>
        )}
        {oddsLine && (
          <span className="block font-mono text-[11px] tabular-nums text-ink-muted">
            {oddsLine}
          </span>
        )}
      </span>
    </>
  );
}

/** The Playoffs column: odds with a bar before the bracket, words after. */
function PlayoffCell({ text, odds }: { text: string; odds: number | null }) {
  if (odds === null) {
    return <span className="text-xs font-semibold text-ink-muted">{text}</span>;
  }
  const percent = Math.round(odds * 100);
  const tone =
    percent >= 60
      ? "text-signal-success"
      : percent >= 25
        ? "text-ink"
        : "text-ink-subtle";
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className={`font-mono text-xs font-bold tabular-nums ${tone}`}>
        {text}
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-12 overflow-hidden rounded-full bg-base"
      >
        <span
          className="block h-full rounded-full bg-beacon"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
    </span>
  );
}

/**
 * The Title column, a row figure: odds with a bar while a title is still
 * possible, and a word (champion, eliminated, final place) once it is not.
 */
function TitleCell({
  text,
  odds,
  asOdds,
}: {
  text: string;
  odds: number | null;
  asOdds: boolean;
}) {
  if (!asOdds || odds === null) {
    return <span className="text-xs font-semibold text-ink-muted">{text}</span>;
  }
  const percent = Math.round(odds * 100);
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className="font-mono text-base font-extrabold tabular-nums text-brand-cyan">
        {text}
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-12 overflow-hidden rounded-full bg-base"
      >
        <span
          className="block h-full rounded-full bg-brand-purple"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
    </span>
  );
}

/**
 * The chance of being the lowest score in the league this week.
 *
 * The same cell as PlayoffCell and the opposite reading: there, more is
 * better. Here a high number is the bad one, so the tone runs the other way
 * and the bar fills toward danger. Neither is carried by color alone: the
 * number is the number, and the column header says which question it answers.
 */
function ChopRiskCell({ odds }: { odds: number | null }) {
  if (odds === null) return <span className="text-xs text-ink-subtle">No odds yet</span>;
  const percent = Math.round(odds * 100);
  const tone =
    percent >= 20
      ? "text-signal-danger"
      : percent >= 8
        ? "text-ink"
        : "text-ink-subtle";
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className={`font-mono text-xs font-bold tabular-nums ${tone}`}>
        {pctOdds(odds)}
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-12 overflow-hidden rounded-full bg-base"
      >
        <span
          className="block h-full rounded-full bg-brand-purple"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
