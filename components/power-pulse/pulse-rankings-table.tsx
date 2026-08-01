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

import { Fragment, useState } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/bottom-sheet";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseTeam } from "@/lib/league-power-pulse-data";
import { PulseDetail, ordinal, pct } from "./pulse-detail";

/** Colour ramp for the headline score. Always paired with the number itself. */
function scoreTone(score: number): { text: string; ring: string; glow: string } {
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
    return <span className="text-xs text-ink-subtle">--</span>;
  }
  const d = team.rankDivergence;
  const even = d === 0;
  const better = d > 0;
  const cls = even
    ? "text-ink-muted"
    : better
      ? "text-signal-success"
      : "text-signal-danger";
  // The word carries the meaning; colour only reinforces it.
  const word = even ? "even" : better ? `up ${d}` : `down ${Math.abs(d)}`;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-mono text-xs tabular-nums text-ink">
        {ordinal(team.valueRank)}
      </span>
      <span className={`font-mono text-[10px] font-semibold tabular-nums ${cls}`}>
        {word}
      </span>
    </span>
  );
}

export function PulseRankingsTable({
  teams,
  sleeperLeagueId,
  searchedUsername,
  valueLabel,
}: {
  teams: PulseTeam[];
  sleeperLeagueId: string;
  searchedUsername: string | null;
  /** e.g. "Dynasty PPR Superflex via FF Beacon". Shown in the value header. */
  valueLabel: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheetTeam, setSheetTeam] = useState<PulseTeam | null>(null);
  const teamCount = teams.length;

  const hrefFor = (team: PulseTeam) => {
    const qs = new URLSearchParams({
      tab: "teams",
      roster: String(team.sleeperRosterId),
    });
    if (searchedUsername) qs.set("username", searchedUsername);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Power Pulse rankings, ordered by Power Pulse score. Columns: rank,
            team, Power Pulse score, trade value rank with the difference between
            the two rankings, projected record, playoff odds, and lineup
            efficiency. Activate a team to open its full breakdown.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-px whitespace-nowrap px-2 py-3 text-center">
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
                className="hidden px-3 py-3 text-right md:table-cell"
                title={valueLabel ?? undefined}
              >
                Value rank
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
                Proj.
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                Playoffs
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center lg:table-cell">
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
                      {team.pulseRank ?? "--"}
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
                        <TeamIdentity team={team} />
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
                        aria-label={`Power Pulse ${team.powerPulse} out of 99`}
                      >
                        {team.powerPulse}
                      </span>
                    </td>

                    <td className="hidden px-3 py-2.5 text-right md:table-cell">
                      <DivergenceChip team={team} />
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {team.projectedWins !== null
                        ? `${team.projectedWins.toFixed(1)}-${(team.projectedLosses ?? 0).toFixed(1)}`
                        : "--"}
                    </td>

                    <td className="hidden px-3 py-2.5 text-center md:table-cell">
                      <PlayoffCell odds={team.playoffOdds} />
                    </td>

                    <td className="hidden px-3 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted lg:table-cell">
                      {team.lineupEfficiency === null ? "--" : pct(team.lineupEfficiency)}
                    </td>

                    <td className="w-px px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : team.rosterRowId)}
                        aria-expanded={isOpen}
                        aria-controls={detailId}
                        aria-label={`${isOpen ? "Hide" : "Show"} the full breakdown for ${team.teamName}`}
                        className="hidden h-9 w-9 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:inline-flex"
                      >
                        <Chevron open={isOpen} />
                      </button>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="hidden md:table-row">
                      <td colSpan={8} id={detailId} className="bg-base/40 px-5 py-5">
                        <PulseDetail
                          team={team}
                          teamCount={teamCount}
                          teamHref={hrefFor(team)}
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

      <BottomSheet
        open={sheetTeam !== null}
        onClose={() => setSheetTeam(null)}
        label={sheetTeam ? `${sheetTeam.teamName} Power Pulse breakdown` : "Team breakdown"}
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
                <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                  {sheetTeam.teamName}
                </h2>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">
                  {sheetTeam.pulseRank !== null
                    ? `${ordinal(sheetTeam.pulseRank)} of ${teamCount}`
                    : "unranked"}
                  {sheetTeam.valueRank !== null && (
                    <>
                      <span className="mx-1.5 text-ink-subtle">and</span>
                      {ordinal(sheetTeam.valueRank)} by value
                    </>
                  )}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-card border px-3 py-2 font-mono text-xl font-extrabold tabular-nums ${scoreTone(sheetTeam.powerPulse).text} ${scoreTone(sheetTeam.powerPulse).ring}`}
                aria-label={`Power Pulse ${sheetTeam.powerPulse} out of 99`}
              >
                {sheetTeam.powerPulse}
              </span>
            </header>
            <div className="pt-4">
              <PulseDetail
                team={sheetTeam}
                teamCount={teamCount}
                teamHref={hrefFor(sheetTeam)}
                onNavigate={() => setSheetTeam(null)}
              />
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function TeamIdentity({ team }: { team: PulseTeam }) {
  return (
    <>
      <SleeperAvatar
        avatarId={team.ownerAvatarId}
        initial={team.teamName.charAt(0)}
        title={team.teamName}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{team.teamName}</span>
        {team.ownerHandle && (
          <span className="block truncate text-[11px] text-ink-subtle">
            @{team.ownerHandle}
          </span>
        )}
      </span>
    </>
  );
}

function PlayoffCell({ odds }: { odds: number | null }) {
  if (odds === null) return <span className="text-xs text-ink-subtle">--</span>;
  const percent = Math.round(odds * 100);
  const tone =
    percent >= 60 ? "text-signal-success" : percent >= 25 ? "text-ink" : "text-ink-subtle";
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <span className={`font-mono text-xs font-bold tabular-nums ${tone}`}>{percent}%</span>
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
