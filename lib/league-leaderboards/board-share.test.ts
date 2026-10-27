import { describe, expect, it } from "vitest";
import {
  boardImageHref,
  buildBoardShareCard,
  describeBoardShareCard,
  isShareBoard,
  PLAYER_SHARE_DEPTH,
  SHARE_BOARDS,
} from "./board-share";
import type { LeaderboardsView, PlayerLeader } from "./types";

function leader(rank: number, position: "QB" | "WR", rosterId: number | null): PlayerLeader {
  return {
    player: { sleeperId: String(rank), name: `Player ${rank}`, slug: null, position, nflTeam: "KC" },
    points: 200 - rank,
    games: 6,
    perGame: (200 - rank) / 6,
    rank,
    gapAbove: null,
    currentRosterId: rosterId,
    ownership: [],
  };
}

const teams = Object.fromEntries(
  Array.from({ length: 14 }, (_, i) => [
    i + 1,
    { sleeperRosterId: i + 1, teamName: `Team ${i + 1}`, ownerHandle: null, avatarId: null },
  ]),
);

function view(over: Partial<LeaderboardsView> = {}): LeaderboardsView {
  const all = Array.from({ length: 25 }, (_, i) => leader(i + 1, i % 2 ? "WR" : "QB", i % 3 ? 1 : null));
  return {
    season: 2026,
    settledWeeks: [1, 2, 3],
    week: null,
    playoffWeekStart: 15,
    positions: ["QB", "WR"],
    teams,
    boards: { all, QB: all.filter((l) => l.player.position === "QB") },
    unowned: [],
    bestWeeks: [
      {
        player: all[0].player,
        week: 2,
        points: 44.5,
        rosterId: 3,
        started: false,
        playoff: false,
      },
    ],
    benchHeroes: [],
    showsBench: true,
    topTier: {
      cutoffs: [{ position: "QB", slots: 1, cutoff: 14, unowned: 0 }],
      rows: [{ rosterId: 2, total: 3, byPosition: { QB: 3 }, rank: 1 }],
    },
    teamHighs: [{ rosterId: 7, week: 2, points: 160.25, playoff: false }],
    teamLows: [],
    pointsFor: Array.from({ length: 14 }, (_, i) => ({ rosterId: i + 1, value: 900 - i, rank: i + 1 })),
    weeklyHighs: [{ rosterId: 4, value: 2, rank: 1 }],
    games: {
      blowouts: [
        { week: 3, playoff: false, homeId: 1, homePoints: 150, awayId: 2, awayPoints: 80, margin: 70, combined: 230, winnerId: 1 },
      ],
      closest: [],
      shootouts: [],
    },
    scoresFreeAgents: true,
    ...over,
  };
}

describe("board share cards", () => {
  it("knows every board slug and nothing else", () => {
    for (const board of SHARE_BOARDS) expect(isShareBoard(board)).toBe(true);
    expect(isShareBoard("leaders")).toBe(false);
  });

  it("keeps the top twelve players and names the holder", () => {
    const card = buildBoardShareCard(view(), "points");
    expect(card?.kind).toBe("players");
    if (card?.kind !== "players") return;
    expect(card.entries).toHaveLength(PLAYER_SHARE_DEPTH);
    expect(card.entries[0].ownerName).toBeNull();
    expect(card.entries[1].ownerName).toBe("Team 1");
  });

  it("filters to a position, and refuses one the league does not start", () => {
    const qb = buildBoardShareCard(view(), "points", "QB");
    expect(qb?.title).toBe("QB points leaders");
    expect(describeBoardShareCard(qb!, "Test League").startsWith("Quarterback points leaders, 2026 season")).toBe(true);
    expect(qb?.entries.every((e) => "position" in e && e.position === "QB")).toBe(true);
    expect(buildBoardShareCard(view(), "points", "TE")).toBeNull();
  });

  it("keeps every team on a team list", () => {
    const card = buildBoardShareCard(view(), "points-for");
    expect(card?.entries).toHaveLength(14);
  });

  it("drops season-only lists in a week view, and bench heroes in best ball", () => {
    expect(buildBoardShareCard(view({ week: 2 }), "best-games")).toBeNull();
    expect(buildBoardShareCard(view({ week: 2 }), "weekly-highs")).toBeNull();
    expect(buildBoardShareCard(view({ showsBench: false }), "bench-heroes")).toBeNull();
  });

  it("reads each kind back as a sentence", () => {
    const games = buildBoardShareCard(view(), "best-games")!;
    expect(describeBoardShareCard(games, "Test League")).toBe(
      "Best player games, 2026 season, Test League: 1. Player 1, quarterback, 44.5 points in week 2, benched by Team 3.",
    );
    const tier = buildBoardShareCard(view(), "top-tier")!;
    expect(describeBoardShareCard(tier, "Test League")).toBe(
      "Most top players held, 2026 season, Test League: 1. Team 2, 3 top players: 3 quarterbacks.",
    );
    const blowouts = buildBoardShareCard(view(), "blowouts")!;
    expect(describeBoardShareCard(blowouts, "Test League")).toBe(
      "Biggest blowouts, 2026 season, Test League: 1. week 3, Team 1 150.0, Team 2 80.0, 70.0 point margin.",
    );
    const empty = buildBoardShareCard(view(), "closest")!;
    expect(describeBoardShareCard(empty, "Test League")).toBe(
      "Closest games, 2026 season, Test League: nothing on this board yet.",
    );
  });

  it("builds one canonical image URL per board", () => {
    expect(boardImageHref("123", "points", null)).toBe("/api/og/leaderboards/123/points");
    expect(boardImageHref("123", "points", 6, "QB")).toBe("/api/og/leaderboards/123/points?week=6&pos=QB");
    expect(boardImageHref("123", "team-highs", 6, "QB")).toBe("/api/og/leaderboards/123/team-highs?week=6");
  });
});
