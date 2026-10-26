import { describe, expect, it } from "vitest";
import { buildLeaderboardsShareCard, describeLeaderboards } from "./share";
import type { LeaderboardsView, PlayerLeader } from "./types";

function leader(rank: number, name: string, points: number, rosterId: number | null): PlayerLeader {
  return {
    player: { sleeperId: String(rank), name, slug: null, position: "WR", nflTeam: "KC" },
    points,
    games: 6,
    perGame: points / 6,
    rank,
    gapAbove: null,
    currentRosterId: rosterId,
    ownership: [],
  };
}

function view(over: Partial<LeaderboardsView> = {}): LeaderboardsView {
  return {
    season: 2026,
    settledWeeks: [1, 2, 3],
    week: null,
    playoffWeekStart: 15,
    positions: ["WR"],
    teams: { 7: { sleeperRosterId: 7, teamName: "Night Owls", ownerHandle: null, avatarId: null } },
    boards: { all: [leader(1, "Ace Receiver", 120.5, 7), leader(2, "Free Runner", 99, null)] },
    unowned: [],
    bestWeeks: [],
    benchHeroes: [],
    showsBench: true,
    topTier: { cutoffs: [], rows: [] },
    teamHighs: [{ rosterId: 7, week: 2, points: 160.25, playoff: false }],
    teamLows: [],
    pointsFor: [],
    weeklyHighs: [],
    games: { blowouts: [], closest: [], shootouts: [] },
    scoresFreeAgents: true,
    ...over,
  };
}

describe("leaderboards share card", () => {
  it("names the holder of each player, or says free agent", () => {
    const card = buildLeaderboardsShareCard(view());
    expect(card.title).toBe("Season leaders");
    expect(card.rows.map((r) => r.ownerName)).toEqual(["Night Owls", null]);
    expect(card.highScore).toEqual({ teamName: "Night Owls", points: 160.25, week: 2 });
  });

  it("reads the card back as a sentence", () => {
    expect(describeLeaderboards(view(), "Test League")).toBe(
      "Season leaders for Test League: 1. Ace Receiver, 120.5 points, on Night Owls; 2. Free Runner, 99.0 points, a free agent. High team score: Night Owls, 160.3 in week 2.",
    );
  });

  it("marks a playoff week", () => {
    const card = buildLeaderboardsShareCard(view({ week: 16 }));
    expect(card.title).toBe("Week 16 leaders");
    expect(card.playoff).toBe(true);
  });
});
