import { describe, expect, it } from "vitest";
import { rankStandings } from "./load";
import type { RelayTeam } from "./types";

function team(
  id: number,
  wins: number,
  losses: number,
  pointsFor: number,
  ties = 0,
): RelayTeam {
  return {
    sleeperRosterId: id,
    name: `Team ${id}`,
    handle: null,
    teamName: null,
    record: { wins, losses, ties },
    pointsFor,
    standingsRank: null,
  };
}

function rank(teams: RelayTeam[]): number[] {
  const map = new Map(teams.map((t) => [t.sleeperRosterId, t]));
  rankStandings(map);
  return teams.map((t) => t.standingsRank!);
}

/**
 * The table is the rank a manager can look up in Sleeper. If this ever stops
 * matching what Sleeper shows, the writeups are back to printing a number the
 * reader will check and find wrong, which is the whole defect this exists for.
 */
describe("rankStandings", () => {
  it("orders by wins first", () => {
    expect(rank([team(1, 1, 2, 400), team(2, 3, 0, 300), team(3, 2, 1, 350)])).toEqual([3, 1, 2]);
  });

  it("breaks a tie on points scored, the way Sleeper does", () => {
    expect(rank([team(1, 2, 1, 310), team(2, 2, 1, 355)])).toEqual([2, 1]);
  });

  it("counts a tie as half a win", () => {
    // 1-0-1 is 1.5, which sits above 1-1-0 and below 2-0-0.
    expect(rank([team(1, 1, 1, 400), team(2, 1, 0, 300, 1), team(3, 2, 0, 200)])).toEqual([
      3, 2, 1,
    ]);
  });

  it("is stable when records and points are identical", () => {
    // Roster id is arbitrary but it does not move between renders, which is
    // the only property that matters here.
    expect(rank([team(7, 1, 0, 100), team(2, 1, 0, 100)])).toEqual([2, 1]);
  });

  it("ranks every team exactly once", () => {
    const teams = [team(1, 0, 1, 90), team(2, 1, 0, 120), team(3, 0, 1, 95)];
    expect([...rank(teams)].sort()).toEqual([1, 2, 3]);
  });
});
