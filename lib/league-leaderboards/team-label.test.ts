import { describe, expect, it } from "vitest";
import { teamLabel } from "./team-label";
import { buildLeaderboardsShareCard } from "./share";
import type { LeaderboardsView } from "./types";

describe("teamLabel", () => {
  it("names a team by its owner's Sleeper handle", () => {
    expect(teamLabel({ ownerHandle: "mjwalsh", teamName: "Taco Tuesday" })).toBe("mjwalsh");
  });

  it("falls back to the team name for a roster with no owner", () => {
    expect(teamLabel({ ownerHandle: null, teamName: "Team 4" })).toBe("Team 4");
    expect(teamLabel({ ownerHandle: "  ", teamName: "Team 4" })).toBe("Team 4");
  });

  it("is what the share card prints for the holder", () => {
    const view = {
      season: 2026,
      settledWeeks: [1],
      week: null,
      playoffWeekStart: null,
      positions: ["WR"],
      teams: { 7: { sleeperRosterId: 7, teamName: "Taco Tuesday", ownerHandle: "mjwalsh", avatarId: null } },
      boards: {
        all: [
          {
            player: { sleeperId: "1", name: "Ace", slug: null, position: "WR", nflTeam: "KC" },
            points: 20,
            games: 1,
            perGame: 20,
            rank: 1,
            gapAbove: null,
            currentRosterId: 7,
            ownership: [],
          },
        ],
      },
      unowned: [],
      bestWeeks: [],
      benchHeroes: [],
      showsBench: true,
      topTier: { cutoffs: [], rows: [] },
      teamHighs: [{ rosterId: 7, week: 1, points: 150, playoff: false }],
      teamLows: [],
      pointsFor: [],
      weeklyHighs: [],
      games: { blowouts: [], closest: [], shootouts: [] },
      scoresFreeAgents: true,
    } satisfies LeaderboardsView;
    const card = buildLeaderboardsShareCard(view);
    expect(card.rows[0].ownerName).toBe("mjwalsh");
    expect(card.highScore?.teamName).toBe("mjwalsh");
  });
});
