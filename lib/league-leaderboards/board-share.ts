/**
 * One share image per Leaderboards board: what goes on each card, and the
 * sentence that describes it.
 *
 * The season leaders card (./share.ts) answers "who is on top". These answer
 * the narrower questions every other list on the page asks: the best quarterback
 * this season, the biggest bench game, the closest matchup, the team that has
 * posted the week's high score most often. Each list gets its own picture.
 *
 * Pure and client-safe, same arrangement as ./share.ts: the image route draws
 * the card this builds, and the page's copy button reads the same card back as
 * a sentence, so the picture and its description cannot disagree.
 *
 * WHAT FITS. A player list keeps its top PLAYER_SHARE_DEPTH (a featured first
 * place, two smaller cards for second and third, the rest as a compact list).
 * A team list keeps every team, because the whole league is the point of
 * "most points scored", and the image grows taller rather than dropping one.
 * A game list keeps what the page keeps.
 */

import { positionHeading, positionNoun } from "@/lib/site";
import type { LeaderboardPosition, LeaderboardsView, PlayerLeader, PlayerWeekLeader } from "./types";
import { teamLabel } from "./team-label";

export const SHARE_BOARDS = [
  "points",
  "unowned",
  "best-games",
  "bench-heroes",
  "top-tier",
  "team-highs",
  "team-lows",
  "points-for",
  "weekly-highs",
  "blowouts",
  "closest",
  "shootouts",
] as const;

export type ShareBoard = (typeof SHARE_BOARDS)[number];

export function isShareBoard(value: string): value is ShareBoard {
  return (SHARE_BOARDS as readonly string[]).includes(value);
}

/** Top players on a player card: one featured, two cards, nine in the list. */
export const PLAYER_SHARE_DEPTH = 12;
/** A team card stops growing here. No Sleeper league is larger. */
export const TEAM_SHARE_DEPTH = 32;
/** The unowned list stops where the page's panel does. */
export const UNOWNED_SHARE_DEPTH = 10;

export type PlayerShareEntry = {
  rank: number;
  name: string;
  position: LeaderboardPosition;
  nflTeam: string | null;
  sleeperId: string;
  points: number;
  /** The single week, on a list of single games. */
  week: number | null;
  playoff: boolean;
  /** Who holds him today, or who held him that week on a single-game list. Null for a free agent. */
  ownerName: string | null;
  /** On a single-game list: false when the owner left him on the bench. */
  started: boolean | null;
  games: number | null;
  perGame: number | null;
};

export type TeamShareEntry = {
  rank: number;
  /** The owner's Sleeper handle (./team-label.ts), despite the field name. */
  teamName: string;
  avatarId: string | null;
  value: number;
  /** "142.6", or "3" for a count. */
  valueText: string;
  /** "points", "weeks", "top players". */
  unit: string;
  week: number | null;
  playoff: boolean;
  /** Most top players held: the count at each position. */
  breakdown: { position: LeaderboardPosition; count: number }[];
};

export type GameShareSide = { teamName: string; avatarId: string | null; points: number; won: boolean };

export type GameShareEntry = {
  rank: number;
  week: number;
  playoff: boolean;
  figure: number;
  home: GameShareSide;
  away: GameShareSide;
};

type CardBase = {
  board: ShareBoard;
  /** The title said aloud: a position spelled out ("Quarterback points leaders"). */
  spokenTitle?: string;
  /** "Season" or "Week 6". */
  scope: string;
  title: string;
  /** One line under the title. */
  subtitle: string;
  /** The week in scope is a playoff week. */
  playoff: boolean;
};

export type BoardShareCard =
  | (CardBase & { kind: "players"; entries: PlayerShareEntry[] })
  | (CardBase & { kind: "teams"; entries: TeamShareEntry[] })
  | (CardBase & { kind: "games"; figureLabel: string; entries: GameShareEntry[] });

/** The image URL for one board. Week and position only when they apply. */
export function boardImageHref(
  sleeperLeagueId: string,
  board: ShareBoard,
  week: number | null,
  position: LeaderboardPosition | null = null,
): string {
  const params = new URLSearchParams();
  if (week !== null) params.set("week", String(week));
  if (board === "points" && position) params.set("pos", position);
  const query = params.toString();
  return `/api/og/leaderboards/${sleeperLeagueId}/${board}${query ? `?${query}` : ""}`;
}

const one = (n: number) => n.toFixed(1);

/**
 * The card for one board, or null when the page does not show that board in
 * this scope (single games and weekly highs are season lists, bench heroes do
 * not exist in best ball, and a position must be one this league starts).
 * An empty list is a card with no entries; the route says so in words.
 */
export function buildBoardShareCard(
  view: LeaderboardsView,
  board: ShareBoard,
  position: LeaderboardPosition | null = null,
): BoardShareCard | null {
  const isWeek = view.week !== null;
  const playoff = isWeek && view.playoffWeekStart !== null && view.week! >= view.playoffWeekStart;
  const base = { board, scope: isWeek ? `Week ${view.week}` : `${view.season} season`, playoff };
  const teamName = (rosterId: number | null) =>
    rosterId !== null && view.teams[rosterId] ? teamLabel(view.teams[rosterId]) : null;
  const team = (rosterId: number) => view.teams[rosterId];

  const leaders = (list: PlayerLeader[]): PlayerShareEntry[] =>
    list.slice(0, PLAYER_SHARE_DEPTH).map((l) => ({
      rank: l.rank,
      name: l.player.name,
      position: l.player.position,
      nflTeam: l.player.nflTeam,
      sleeperId: l.player.sleeperId,
      points: l.points,
      week: null,
      playoff: false,
      ownerName: teamName(l.currentRosterId),
      started: null,
      games: l.games,
      perGame: l.perGame,
    }));

  const singleGames = (list: PlayerWeekLeader[]): PlayerShareEntry[] =>
    list.slice(0, PLAYER_SHARE_DEPTH).map((g, i) => ({
      rank: i + 1,
      name: g.player.name,
      position: g.player.position,
      nflTeam: g.player.nflTeam,
      sleeperId: g.player.sleeperId,
      points: g.points,
      week: g.week,
      playoff: g.playoff,
      ownerName: teamName(g.rosterId),
      started: g.rosterId !== null ? g.started : null,
      games: null,
      perGame: null,
    }));

  const teamEntry = (
    rosterId: number,
    rank: number,
    value: number,
    unit: string,
    extra: Partial<TeamShareEntry> = {},
    decimals = true,
  ): TeamShareEntry | null => {
    const t = team(rosterId);
    if (!t) return null;
    return {
      rank,
      teamName: teamLabel(t),
      avatarId: t.avatarId,
      value,
      valueText: decimals ? one(value) : String(value),
      unit,
      week: null,
      playoff: false,
      breakdown: [],
      ...extra,
    };
  };
  const present = <T,>(list: (T | null)[]): T[] => list.filter((x): x is T => x !== null);

  switch (board) {
    case "points": {
      if (position && !view.positions.includes(position)) return null;
      const list = position ? (view.boards[position] ?? []) : view.boards.all;
      return {
        ...base,
        kind: "players",
        title: position ? `${position} points leaders` : "Points leaders",
        spokenTitle: position ? `${positionHeading(position, "singular")} points leaders` : "Points leaders",
        subtitle: position
          ? `Every ${positionNoun(position)} who played, rostered or not`
          : "Every player who played, rostered or not",
        entries: leaders(list),
      };
    }
    case "unowned":
      return {
        ...base,
        kind: "players",
        title: "Best players nobody owns",
        subtitle: "The top scorers on no roster today",
        entries: leaders(view.unowned.slice(0, UNOWNED_SHARE_DEPTH)),
      };
    case "best-games":
      if (isWeek) return null;
      return {
        ...base,
        kind: "players",
        title: "Best player games",
        subtitle: "The biggest one-week scores, and whose team each landed on",
        entries: singleGames(view.bestWeeks),
      };
    case "bench-heroes":
      if (!view.showsBench) return null;
      return {
        ...base,
        kind: "players",
        title: "Bench heroes",
        subtitle: "The biggest games that did not count",
        entries: singleGames(view.benchHeroes),
      };
    case "top-tier": {
      const cut = view.topTier.cutoffs.map((c) => `${c.position} top ${c.cutoff}`).join(", ");
      return {
        ...base,
        kind: "teams",
        title: "Most top players held",
        subtitle: cut ? `Counted on today's rosters: ${cut}` : "No position has a starting slot of its own",
        entries: view.topTier.cutoffs.length === 0
          ? []
          : present(
              view.topTier.rows.slice(0, TEAM_SHARE_DEPTH).map((r) =>
                teamEntry(r.rosterId, r.rank, r.total, r.total === 1 ? "top player" : "top players", {
                  breakdown: view.positions
                    .filter((p) => (r.byPosition[p] ?? 0) > 0)
                    .map((p) => ({ position: p, count: r.byPosition[p]! })),
                }, false),
              ),
            ),
      };
    }
    case "team-highs":
    case "team-lows": {
      const list = board === "team-highs" ? view.teamHighs : view.teamLows;
      return {
        ...base,
        kind: "teams",
        title: board === "team-highs" ? "Highest team scores" : "Lowest team scores",
        subtitle: board === "team-highs" ? "The best single weeks" : "The quietest single weeks",
        entries: present(
          list.map((s, i) => teamEntry(s.rosterId, i + 1, s.points, "points", { week: s.week, playoff: s.playoff })),
        ),
      };
    }
    case "points-for":
      return {
        ...base,
        kind: "teams",
        title: "Most points scored",
        subtitle: "Total points, playoff weeks included",
        entries: present(
          view.pointsFor.slice(0, TEAM_SHARE_DEPTH).map((t) => teamEntry(t.rosterId, t.rank, t.value, "points")),
        ),
      };
    case "weekly-highs":
      if (isWeek) return null;
      return {
        ...base,
        kind: "teams",
        title: "Weekly high scores",
        subtitle: "Weeks each team posted the league's top score",
        entries: present(
          view.weeklyHighs
            .slice(0, TEAM_SHARE_DEPTH)
            .map((t) => teamEntry(t.rosterId, t.rank, t.value, t.value === 1 ? "week" : "weeks", {}, false)),
        ),
      };
    case "blowouts":
    case "closest":
    case "shootouts": {
      const list = view.games[board];
      const figure = board === "shootouts" ? "combined" : "margin";
      return {
        ...base,
        kind: "games",
        title: board === "blowouts" ? "Biggest blowouts" : board === "closest" ? "Closest games" : "Most combined points",
        subtitle:
          board === "blowouts"
            ? "The widest margins of victory"
            : board === "closest"
              ? "The narrowest margins"
              : "The highest-scoring matchups",
        figureLabel: figure === "margin" ? "margin" : "combined",
        entries: present(
          list.map((g, i) => {
            const home = team(g.homeId);
            const away = team(g.awayId);
            if (!home || !away) return null;
            return {
              rank: i + 1,
              week: g.week,
              playoff: g.playoff,
              figure: figure === "margin" ? g.margin : g.combined,
              home: { teamName: teamLabel(home), avatarId: home.avatarId, points: g.homePoints, won: g.winnerId === g.homeId },
              away: { teamName: teamLabel(away), avatarId: away.avatarId, points: g.awayPoints, won: g.winnerId === g.awayId },
            };
          }),
        ),
      };
    }
  }
}

/** The card as a sentence, for the copy button's confirmation. */
export function describeBoardShareCard(card: BoardShareCard, leagueName: string): string {
  const head = `${card.spokenTitle ?? card.title}, ${card.scope.toLowerCase()}${card.playoff ? ", playoffs" : ""}, ${leagueName}`;
  if (card.entries.length === 0) return `${head}: nothing on this board yet.`;
  let items: string[];
  if (card.kind === "players") {
    items = card.entries.map((e) => {
      const owner = e.ownerName
        ? e.week !== null
          ? `${e.started === false ? "benched by" : "for"} ${e.ownerName}`
          : `on ${e.ownerName}`
        : "a free agent";
      const when = e.week !== null ? ` in week ${e.week}${e.playoff ? ", playoffs" : ""}` : "";
      return `${e.rank}. ${e.name}, ${positionNoun(e.position)}, ${one(e.points)} points${when}, ${owner}`;
    });
  } else if (card.kind === "teams") {
    items = card.entries.map((e) => {
      const when = e.week !== null ? ` in week ${e.week}${e.playoff ? ", playoffs" : ""}` : "";
      const breakdown =
        e.breakdown.length > 0
          ? `: ${e.breakdown.map((b) => `${b.count} ${positionNoun(b.position, b.count === 1 ? "singular" : "plural")}`).join(", ")}`
          : "";
      return `${e.rank}. ${e.teamName}, ${e.valueText} ${e.unit}${when}${breakdown}`;
    });
  } else {
    items = card.entries.map(
      (e) =>
        `${e.rank}. week ${e.week}${e.playoff ? ", playoffs" : ""}, ${e.home.teamName} ${one(e.home.points)}, ${e.away.teamName} ${one(e.away.points)}, ${one(e.figure)} ${card.figureLabel === "margin" ? "point margin" : "combined"}`,
    );
  }
  return `${head}: ${items.join("; ")}.`;
}
