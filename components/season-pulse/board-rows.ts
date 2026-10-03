/**
 * Turns the season board into the rows the client leaders board takes.
 *
 * The board a server holds carries every player's stat totals, which the
 * leaders table never draws. Dropping them here keeps them out of the page's
 * flight payload: on the full board that is several hundred rows of numbers
 * nobody on that screen can see.
 *
 * Not a client module, so a server page can call it.
 */

import type { BoardPlayer } from "@/lib/season-pulse/types";
import type { BoardRow } from "./leaders-board";

export function toBoardRows(players: readonly BoardPlayer[]): BoardRow[] {
  return players.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    position: p.position,
    team: p.team,
    sleeperId: p.sleeperId,
    weeks: p.weeks,
    weekRanks: p.weekRanks,
    total: p.total,
    games: p.games,
    perGame: p.perGame,
    rank: p.rank,
    perGameRank: p.perGameRank,
    starterWeeks: p.starterWeeks,
    best: p.best,
    worst: p.worst,
  }));
}
