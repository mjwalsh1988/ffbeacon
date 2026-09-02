import { describe, it, expect } from "vitest";
import { buildLedgerHeadline, buildLedgerLeaders } from "./leaders";
import type { LedgerViewTeam } from "../league-manager-ledger-data";

function team(over: Partial<LedgerViewTeam> = {}): LedgerViewTeam {
  return {
    sleeperRosterId: 1,
    teamName: "Team",
    ownerLabel: null,
    ownerAvatarId: null,
    weeksGraded: 10,
    officialPoints: 1000,
    setPoints: 900,
    optimalPoints: 1000,
    pointsLeft: 100,
    pointsLeftPerWeek: 10,
    efficiency: 0.9,
    actualRecord: { wins: 5, losses: 5, ties: 0 },
    bestLineupRecord: { wins: 7, losses: 3, ties: 0 },
    winsLeftOnBench: 0,
    weeksWithUngradedSlots: 0,
    waiverMoves: 0,
    waiverHits: 0,
    waiverFaabSpent: null,
    waiverPointsStarted: 0,
    waiverPointsPerDollar: null,
    tradeCount: 0,
    tradePointsIn: 0,
    tradePointsOut: 0,
    tradeNet: 0,
    tradeAnyPicks: false,
    draftPicks: 0,
    draftPoints: 0,
    draftAboveBaseline: 0,
    efficiencyRank: 1,
    waiverRank: null,
    tradeRank: null,
    draftRank: null,
    scoringRank: 1,
    weeks: [],
    moves: { waivers: [], trades: [], draftBest: [], draftWorst: [] },
    ...over,
  };
}

describe("buildLedgerLeaders", () => {
  it("awards nothing at all to an empty league", () => {
    expect(buildLedgerLeaders([])).toEqual([]);
  });

  it("never hands out an award for topping a column of zeroes", () => {
    // Two teams, neither of which has traded, drafted, claimed anyone or lost a
    // game their bench would have won. Only the two lineup awards can fire.
    const ids = buildLedgerLeaders([
      team({ sleeperRosterId: 1, efficiencyRank: 1, scoringRank: 1 }),
      team({ sleeperRosterId: 2, efficiencyRank: 2, scoringRank: 2, efficiency: 0.8 }),
    ]).map((l) => l.id);
    expect(ids).toContain("sharpest");
    expect(ids).toContain("most-left");
    expect(ids).not.toContain("best-trade");
    expect(ids).not.toContain("best-draft");
    expect(ids).not.toContain("best-waivers");
    expect(ids).not.toContain("games-given-away");
  });

  it("awards games given away only when a game actually turned on it", () => {
    const none = buildLedgerLeaders([team({ winsLeftOnBench: 0 })]);
    expect(none.find((l) => l.id === "games-given-away")).toBeUndefined();

    const some = buildLedgerLeaders([team({ winsLeftOnBench: 3 })]);
    expect(some.find((l) => l.id === "games-given-away")?.value).toBe("3");
  });

  it("only calls a team carried when the two ranks really diverge", () => {
    // One place apart is noise, not a story.
    const close = buildLedgerLeaders([
      team({ sleeperRosterId: 1, efficiencyRank: 2, scoringRank: 1 }),
      team({ sleeperRosterId: 2, efficiencyRank: 1, scoringRank: 2, efficiency: 0.8 }),
    ]).map((l) => l.id);
    expect(close).not.toContain("carried");
    expect(close).not.toContain("overachiever");

    const wide = buildLedgerLeaders([
      team({ sleeperRosterId: 1, efficiencyRank: 8, scoringRank: 1 }),
      team({ sleeperRosterId: 2, efficiencyRank: 1, scoringRank: 8, efficiency: 0.8 }),
    ]).map((l) => l.id);
    expect(wide).toContain("carried");
    expect(wide).toContain("overachiever");
  });

  it("breaks a tie on roster id, so an award does not move between page loads", () => {
    const a = buildLedgerLeaders([
      team({ sleeperRosterId: 9, pointsLeft: 100 }),
      team({ sleeperRosterId: 4, pointsLeft: 100 }),
    ]);
    const b = buildLedgerLeaders([
      team({ sleeperRosterId: 4, pointsLeft: 100 }),
      team({ sleeperRosterId: 9, pointsLeft: 100 }),
    ]);
    const winner = (l: typeof a) => l.find((x) => x.id === "most-left")?.team.sleeperRosterId;
    expect(winner(a)).toBe(4);
    expect(winner(a)).toBe(winner(b));
  });
});

describe("buildLedgerHeadline", () => {
  it("totals wins and points across the league", () => {
    const headline = buildLedgerHeadline(
      [
        team({ sleeperRosterId: 1, winsLeftOnBench: 3, pointsLeft: 120.4 }),
        team({ sleeperRosterId: 2, winsLeftOnBench: 5, pointsLeft: 200.1 }),
      ],
      14,
    );
    expect(headline.winsLeftOnBench).toBe(8);
    expect(headline.pointsLeft).toBe(320.5);
    expect(headline.gradedWeeks).toBe(14);
  });

  it("averages efficiency over ranked teams only", () => {
    // The unranked team has an efficiency but not a comparable one, and letting
    // it into a headline figure would move it by an amount that says nothing.
    const headline = buildLedgerHeadline(
      [
        team({ sleeperRosterId: 1, efficiency: 0.9, efficiencyRank: 1 }),
        team({ sleeperRosterId: 2, efficiency: 0.8, efficiencyRank: 2 }),
        team({ sleeperRosterId: 3, efficiency: 0.1, efficiencyRank: null }),
      ],
      14,
    );
    expect(headline.averageEfficiency).toBeCloseTo(0.85, 6);
  });

  it("reports no average rather than a zero when nobody is ranked", () => {
    const headline = buildLedgerHeadline([team({ efficiencyRank: null })], 1);
    expect(headline.averageEfficiency).toBeNull();
  });
});
