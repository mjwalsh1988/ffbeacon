import { describe, it, expect } from "vitest";
import { computeLedger, isLedgerSkip, rankDesc, type EngineInput } from "./engine";
import { MIN_WEEKS_FOR_RANK } from "./default-settings";
import type { LedgerPlayer } from "./lineup";

const PLAYERS: Map<string, LedgerPlayer> = new Map([
  ["qb", { sleeperId: "qb", name: "QB", position: "QB" }],
  ["rb1", { sleeperId: "rb1", name: "RB One", position: "RB" }],
  ["rb2", { sleeperId: "rb2", name: "RB Two", position: "RB" }],
]);

/** Two rosters, `weeksEach` weeks. Roster 1 always starts its better back. */
function input(weeksEach: number): EngineInput {
  const weeks: EngineInput["weeks"] = [];
  for (let week = 1; week <= weeksEach; week += 1) {
    weeks.push({
      week,
      sleeperRosterId: 1,
      officialPoints: 45,
      starterIds: ["qb", "rb1"],
      playerPoints: new Map([
        ["qb", 20],
        ["rb1", 25],
        ["rb2", 5],
      ]),
      opponentPoints: 30,
      ineligibleIds: new Set<string>(),
      startedIds: new Set(["qb", "rb1"]),
    });
    weeks.push({
      week,
      sleeperRosterId: 2,
      officialPoints: 25,
      // The wrong back, every week.
      starterIds: ["qb", "rb2"],
      playerPoints: new Map([
        ["qb", 20],
        ["rb1", 25],
        ["rb2", 5],
      ]),
      opponentPoints: 45,
      ineligibleIds: new Set<string>(),
      startedIds: new Set(["qb", "rb2"]),
    });
  }
  return {
    season: 2025,
    rosterPositions: ["QB", "RB", "BN"],
    rosters: [
      { sleeperRosterId: 1, teamName: "Sharp", ownerHandle: "sharp" },
      { sleeperRosterId: 2, teamName: "Asleep", ownerHandle: "asleep" },
    ],
    weeks,
    transactions: [],
    draftPicks: [],
    players: PLAYERS,
    leagueHasFaab: false,
  };
}

describe("rankDesc", () => {
  it("gives tied values the same rank and skips the next one", () => {
    expect(rankDesc([10, 8, 8, 5])).toEqual([1, 2, 2, 4]);
  });

  it("leaves a null unranked rather than putting it last", () => {
    expect(rankDesc([10, null, 5])).toEqual([1, null, 2]);
  });

  it("ranks nothing when there is nothing to rank", () => {
    expect(rankDesc([null, null])).toEqual([null, null]);
  });
});

describe("computeLedger", () => {
  it("skips rather than storing a page of zeroes when no week has settled", () => {
    const result = computeLedger({ ...input(0), weeks: [] });
    expect(isLedgerSkip(result)).toBe(true);
    if (isLedgerSkip(result)) expect(result.skipped).toMatch(/no settled weeks/);
  });

  it("skips a league with no rosters stored", () => {
    const result = computeLedger({ ...input(3), rosters: [] });
    expect(isLedgerSkip(result)).toBe(true);
  });

  it("skips a league whose starting slots cannot be graded at all", () => {
    const result = computeLedger({ ...input(3), rosterPositions: ["LB", "DB", "BN"] });
    expect(isLedgerSkip(result)).toBe(true);
    if (isLedgerSkip(result)) expect(result.skipped).toMatch(/no startable slots/);
  });

  it("ranks the manager who started the right players first", () => {
    const result = computeLedger(input(4));
    expect(isLedgerSkip(result)).toBe(false);
    if (isLedgerSkip(result)) return;

    const sharp = result.teams.find((t) => t.sleeperRosterId === 1)!;
    const asleep = result.teams.find((t) => t.sleeperRosterId === 2)!;

    expect(sharp.lineup.efficiency).toBe(1);
    expect(sharp.efficiencyRank).toBe(1);
    expect(sharp.lineup.winsLeftOnBench).toBe(0);

    // 25 of 45 available every week.
    expect(asleep.lineup.efficiency).toBeCloseTo(25 / 45, 6);
    expect(asleep.efficiencyRank).toBe(2);
    // Every loss was 25 to 45, and the right lineup scores 45, which ties
    // rather than wins. A tie is not a win, so nothing is counted.
    expect(asleep.lineup.winsLeftOnBench).toBe(0);
    expect(asleep.lineup.bestLineupRecord).toEqual({ wins: 0, losses: 0, ties: 4 });
  });

  it("counts a game the bench would have won", () => {
    const base = input(1);
    // Drop the opponent below what the right lineup would have scored.
    base.weeks[1] = { ...base.weeks[1], opponentPoints: 40 };
    base.weeks[0] = { ...base.weeks[0], officialPoints: 40, opponentPoints: 25 };
    const result = computeLedger(base);
    if (isLedgerSkip(result)) throw new Error("unexpected skip");
    const asleep = result.teams.find((t) => t.sleeperRosterId === 2)!;
    // Lost 25 to 40; the best lineup scores 45 and wins.
    expect(asleep.lineup.actualRecord).toEqual({ wins: 0, losses: 1, ties: 0 });
    expect(asleep.lineup.bestLineupRecord).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(asleep.lineup.winsLeftOnBench).toBe(1);
  });

  it("withholds the efficiency rank until there is enough of a season to be evidence", () => {
    const result = computeLedger(input(MIN_WEEKS_FOR_RANK - 1));
    if (isLedgerSkip(result)) throw new Error("unexpected skip");
    for (const team of result.teams) {
      // The ledger is still computed; only the leaderboard position is withheld.
      expect(team.lineup.efficiency).not.toBeNull();
      expect(team.efficiencyRank).toBeNull();
    }
  });

  it("ranks scoring on the official totals, so it matches the league's own standings", () => {
    const result = computeLedger(input(3));
    if (isLedgerSkip(result)) throw new Error("unexpected skip");
    expect(result.teams.find((t) => t.sleeperRosterId === 1)!.scoringRank).toBe(1);
    expect(result.teams.find((t) => t.sleeperRosterId === 2)!.scoringRank).toBe(2);
  });

  it("leaves a ledger with no moves unranked rather than ranking it last", () => {
    const result = computeLedger(input(3));
    if (isLedgerSkip(result)) throw new Error("unexpected skip");
    for (const team of result.teams) {
      expect(team.waiverRank).toBeNull();
      expect(team.tradeRank).toBeNull();
      expect(team.draftRank).toBeNull();
    }
  });

  it("reports which slots it could and could not grade", () => {
    const result = computeLedger({ ...input(3), rosterPositions: ["QB", "LB", "RB", "BN"] });
    if (isLedgerSkip(result)) throw new Error("unexpected skip");
    expect(result.gradableSlots).toEqual(["QB", "RB"]);
    expect(result.ungradableSlots).toEqual(["LB"]);
    expect(result.gradedWeeks).toEqual([1, 2, 3]);
  });
});
