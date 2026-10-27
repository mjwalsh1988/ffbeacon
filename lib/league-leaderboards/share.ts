/**
 * The Leaderboards share image's content, and the sentence that describes it.
 *
 * One pure function decides what goes on the card and the copy button reads
 * the same object back as a sentence, so a reader who never sees the picture
 * hears exactly what it shows. Same arrangement as the matchup share card
 * (lib/league-schedule/share-card.ts).
 */

import type { LeaderboardsView } from "./types";
import { teamLabel } from "./team-label";

export const SHARE_ROWS = 5;

export type LeaderboardsShareRow = {
  rank: number;
  name: string;
  position: string;
  nflTeam: string | null;
  sleeperId: string;
  points: number;
  /** The team holding him today, or null for a free agent. */
  ownerName: string | null;
};

export type LeaderboardsShareCard = {
  /** "Season leaders" or "Week 6 leaders". */
  title: string;
  playoff: boolean;
  rows: LeaderboardsShareRow[];
  /** The best team week in scope, or null when none has settled. */
  highScore: { teamName: string; points: number; week: number } | null;
};

export function buildLeaderboardsShareCard(view: LeaderboardsView): LeaderboardsShareCard {
  const title = view.week !== null ? `Week ${view.week} leaders` : "Season leaders";
  const playoff =
    view.week !== null && view.playoffWeekStart !== null && view.week >= view.playoffWeekStart;
  const rows = view.boards.all.slice(0, SHARE_ROWS).map((leader) => ({
    rank: leader.rank,
    name: leader.player.name,
    position: leader.player.position,
    nflTeam: leader.player.nflTeam,
    sleeperId: leader.player.sleeperId,
    points: leader.points,
    ownerName:
      leader.currentRosterId !== null ? (view.teams[leader.currentRosterId] ? teamLabel(view.teams[leader.currentRosterId]) : null) : null,
  }));
  const top = view.teamHighs[0];
  const highScore =
    top && view.teams[top.rosterId]
      ? { teamName: teamLabel(view.teams[top.rosterId]), points: top.points, week: top.week }
      : null;
  return { title, playoff, rows, highScore };
}

/** The card as a sentence, for the copy button's confirmation. */
export function describeLeaderboards(view: LeaderboardsView, leagueName: string): string {
  const card = buildLeaderboardsShareCard(view);
  if (card.rows.length === 0) return `${card.title} for ${leagueName}: nothing has settled yet.`;
  const players = card.rows
    .map(
      (r) =>
        `${r.rank}. ${r.name}, ${r.points.toFixed(1)} points, ${r.ownerName ? `on ${r.ownerName}` : "a free agent"}`,
    )
    .join("; ");
  const high = card.highScore
    ? ` High team score: ${card.highScore.teamName}, ${card.highScore.points.toFixed(1)} in week ${card.highScore.week}.`
    : "";
  return `${card.title} for ${leagueName}${card.playoff ? ", playoffs" : ""}: ${players}.${high}`;
}
