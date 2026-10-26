/**
 * The team half of Leaderboards: single-week team scores, season totals, and
 * the head to head games that stood out. Server components, plain lists.
 *
 * A game links to its own matchup page, where both lineups are, because "the
 * closest game of the year" is the first thing somebody wants to open.
 */

import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { withUsername } from "@/components/league-schedule/format";
import type {
  GameResult,
  LeaderboardTeam,
  TeamTotal,
  TeamWeekScore,
} from "@/lib/league-leaderboards/types";
import { PlayoffTag, WeekTag, pts } from "./bits";
import { LIST_CLASS, RankMark } from "./leader-row";

function TeamName({ team, viewerRosterId }: { team: LeaderboardTeam; viewerRosterId: number | null }) {
  const mine = viewerRosterId !== null && team.sleeperRosterId === viewerRosterId;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SleeperAvatar avatarId={team.avatarId} title="" size={28} />
      <span className="min-w-0 break-words text-sm font-semibold text-ink">{team.teamName}</span>
      {mine && (
        <span className="shrink-0 rounded-full bg-brand-cyan/20 px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-brand-cyan">
          Your team
        </span>
      )}
    </span>
  );
}

function rowClass(mine: boolean) {
  return `flex min-h-14 items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 ${
    mine ? "bg-brand-cyan/[0.06] shadow-[inset_3px_0_0_0_rgba(34,211,238,0.8)]" : ""
  }`;
}

/** Single-week team scores, highest or lowest first. */
export function TeamScoreList({
  label,
  scores,
  teams,
  viewerRosterId,
}: {
  label: string;
  scores: TeamWeekScore[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
}) {
  if (scores.length === 0) return null;
  return (
    <ol role="list" aria-label={label} className={LIST_CLASS}>
      {scores.map((s, i) => {
        const team = teams[s.rosterId];
        if (!team) return null;
        return (
          <li key={`${s.rosterId}-${s.week}`} className={rowClass(s.rosterId === viewerRosterId)}>
            <RankMark rank={i + 1} />
            <div className="min-w-0 flex-1">
              <TeamName team={team} viewerRosterId={viewerRosterId} />
              <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-9">
                <WeekTag week={s.week} />
                {s.playoff && <PlayoffTag />}
              </div>
            </div>
            <p className="shrink-0 font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg">
              {pts(s.points)}
              <span className="sr-only"> points</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** A season figure per team, already ranked. */
export function TeamTotalList({
  label,
  totals,
  teams,
  viewerRosterId,
  unit,
  depth,
  decimals = true,
}: {
  label: string;
  totals: TeamTotal[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  /** Spoken after the figure: "points", "weeks". */
  unit: (value: number) => string;
  depth?: number;
  decimals?: boolean;
}) {
  const rows = depth ? totals.slice(0, depth) : totals;
  if (rows.length === 0) return null;
  return (
    <ol role="list" aria-label={label} className={LIST_CLASS}>
      {rows.map((t) => {
        const team = teams[t.rosterId];
        if (!team) return null;
        return (
          <li key={t.rosterId} className={rowClass(t.rosterId === viewerRosterId)}>
            <RankMark rank={t.rank} />
            <div className="min-w-0 flex-1">
              <TeamName team={team} viewerRosterId={viewerRosterId} />
            </div>
            <p className="shrink-0 font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg">
              {decimals ? pts(t.value) : t.value}
              <span className="sr-only"> {unit(t.value)}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Head to head games. `figure` picks the number the list is about. */
export function GameList({
  label,
  games,
  teams,
  viewerRosterId,
  figure,
  sleeperLeagueId,
  linkUsername,
}: {
  label: string;
  games: GameResult[];
  teams: Record<number, LeaderboardTeam>;
  viewerRosterId: number | null;
  figure: "margin" | "combined";
  sleeperLeagueId: string;
  linkUsername: string | null;
}) {
  if (games.length === 0) return null;
  return (
    <ol role="list" aria-label={label} className={LIST_CLASS}>
      {games.map((g) => {
        const home = teams[g.homeId];
        const away = teams[g.awayId];
        if (!home || !away) return null;
        const mine = viewerRosterId !== null && (g.homeId === viewerRosterId || g.awayId === viewerRosterId);
        const href = withUsername(
          `/leagues/${sleeperLeagueId}/matchups/${g.week}/${g.homeId}`,
          linkUsername,
        ) as Route;
        const value = figure === "margin" ? g.margin : g.combined;
        const side = (team: LeaderboardTeam, points: number, won: boolean) => (
          <span className="flex min-w-0 items-center justify-between gap-2">
            <TeamName team={team} viewerRosterId={viewerRosterId} />
            <span
              className={`shrink-0 font-mono text-sm tabular-nums ${won ? "font-bold text-ink" : "text-ink-muted"}`}
            >
              {pts(points)}
              {won && <span className="sr-only">, won</span>}
            </span>
          </span>
        );
        return (
          <li key={`${g.week}-${g.homeId}`}>
            <Link
              href={href}
              className={`group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan sm:px-4 ${
                mine ? "bg-brand-cyan/[0.06] shadow-[inset_3px_0_0_0_rgba(34,211,238,0.8)]" : ""
              }`}
            >
              {/* The figure leads in its own column from sm up. On a phone it
                  moves to the line under the two teams, so the team names get
                  the whole width. Only one of the two is ever displayed. */}
              <div className="hidden w-14 shrink-0 text-center sm:block">
                <p className="font-mono text-lg font-black tabular-nums leading-none text-ink">
                  {pts(value)}
                </p>
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  {figure === "margin" ? "point margin" : "total"}
                  <span className="sr-only">, </span>
                </p>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                {side(home, g.homePoints, g.winnerId === g.homeId)}
                <span className="sr-only">versus</span>
                {side(away, g.awayPoints, g.winnerId === g.awayId)}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-baseline gap-1 rounded-full bg-ink/[0.07] px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-ink sm:hidden">
                    {pts(value)}
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                      {figure === "margin" ? "point margin" : "total"}
                    </span>
                  </span>
                  <WeekTag week={g.week} />
                  {g.playoff && <PlayoffTag />}
                </div>
              </div>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan"
              />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
