/**
 * The Overview's taste of Leaderboards: the most recent settled week's top
 * three player games, its high team score, and its closest game, with the way
 * onward to the full section.
 *
 * The title names the week. A card that said "This week" on a Monday night
 * would be describing a week whose games are still being played.
 *
 * Built from the same view the Leaderboards page draws, scoped to one week,
 * so the card and the page cannot disagree about it.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import type { LeaderboardsView } from "@/lib/league-leaderboards/types";
import { LIST_CLASS, PlayerWeekRow } from "./leader-row";
import { GameList, TeamScoreList } from "./team-boards";

export function WeekLeadersCard({
  view,
  sleeperLeagueId,
  linkUsername,
  viewerRosterId,
  href,
}: {
  view: LeaderboardsView;
  sleeperLeagueId: string;
  linkUsername: string | null;
  viewerRosterId: number | null;
  /** The full section, opened on this same week. */
  href: string;
}) {
  if (view.week === null || view.bestWeeks.length === 0) return null;
  const week = view.week;
  const playoff = view.playoffWeekStart !== null && week >= view.playoffWeekStart;
  const high = view.teamHighs.slice(0, 1);
  const closest = view.games.closest.slice(0, 1);

  return (
    <Panel
      id="week-leaders"
      eyebrow={playoff ? "Leaderboards, playoffs" : "Leaderboards"}
      title={`Week ${week} leaders`}
      helper="Every player counts, rostered or not, scored under this league's own settings."
      glow
      action={
        <Link
          href={href as Route}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-accent bg-surface px-3.5 text-xs font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          See all leaderboards
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {/* The three games take the full width; the team figures sit side by side
          under them. A narrow third column was too tight for two team names. */}
      <div className="space-y-4">
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
            Top player games
          </h3>
          <ol role="list" aria-label={`Top player games, week ${week}`} className={LIST_CLASS}>
            {view.bestWeeks.slice(0, 3).map((item, i) => (
              <PlayerWeekRow
                key={item.player.sleeperId}
                item={item}
                rank={i + 1}
                teams={view.teams}
                viewerRosterId={viewerRosterId}
              />
            ))}
          </ol>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {high.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                High score
              </h3>
              <TeamScoreList
                label={`High score, week ${week}`}
                scores={high}
                teams={view.teams}
                viewerRosterId={viewerRosterId}
              />
            </div>
          )}
          {closest.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                Closest game
              </h3>
              <GameList
                label={`Closest game, week ${week}`}
                games={closest}
                teams={view.teams}
                viewerRosterId={viewerRosterId}
                figure="margin"
                sleeperLeagueId={sleeperLeagueId}
                linkUsername={linkUsername}
              />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
