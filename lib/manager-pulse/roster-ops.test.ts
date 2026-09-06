import { describe, expect, it } from "vitest";
import { computeRosterOps } from "./roster-ops";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type {
  ManagerLedgerFacts,
  ManagerLeagueSeason,
  ManagerMove,
  ManagerPulseInput,
  ManagerWeeklyMoves,
} from "./input-types";

function makeInput(overrides: Partial<ManagerPulseInput> = {}): ManagerPulseInput {
  return {
    sleeperUserId: "user-1",
    handle: "tester",
    avatarUrl: null,
    window: { seasonFrom: 2022, seasonTo: 2026 },
    settings: DEFAULT_MANAGER_PULSE_SETTINGS,
    leagueSeasons: [],
    players: {},
    handles: {},
    drafts: [],
    picks: [],
    pickObservations: [],
    moves: [],
    trades: [],
    ledgers: [],
    weeklyMoves: [],
    leagueSeasonsSkipped: 0,
    ...overrides,
  };
}

function leagueSeason(overrides: Partial<ManagerLeagueSeason> = {}): ManagerLeagueSeason {
  return {
    leagueId: null,
    sleeperLeagueId: "L1",
    season: 2025,
    leagueName: "Test League",
    avatar: null,
    category: "dynasty",
    sleeperLeagueType: 2,
    teamCount: 12,
    rosterPositions: [],
    usesFaab: true,
    faabBudget: 100,
    rosterId: 1,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: null,
    pointsAgainst: null,
    finish: null,
    championRosterId: null,
    runnerUpRosterId: null,
    playoffRosterIds: null,
    isComplete: false,
    pointsForRankByRoster: {},
    pointsAgainstRankByRoster: {},
    ...overrides,
  };
}

function ledger(overrides: Partial<ManagerLedgerFacts> = {}): ManagerLedgerFacts {
  return {
    sleeperLeagueId: "L1",
    season: 2025,
    category: "dynasty",
    weeksGraded: 10,
    lineupEfficiency: 0.9,
    waiverMoves: null,
    waiverHits: null,
    waiverFaabSpent: null,
    waiverPointsStarted: null,
    waiverPointsOnRoster: null,
    winsLeftOnBench: 1,
    bestLineupWins: 8,
    bestLineupLosses: 2,
    bestLineupTies: 0,
    efficiencyRank: null,
    scoringRank: null,
    ...overrides,
  };
}

function weekly(overrides: Partial<ManagerWeeklyMoves> = {}): ManagerWeeklyMoves {
  return {
    sleeperLeagueId: "L1",
    season: 2025,
    category: "dynasty",
    movesByWeek: {},
    lastWeekPlayed: 14,
    weeksWithIncompleteLineup: 0,
    ...overrides,
  };
}

function move(overrides: Partial<ManagerMove> = {}): ManagerMove {
  return {
    sleeperTransactionId: "t1",
    sleeperLeagueId: "L1",
    season: 2025,
    week: 1,
    category: "dynasty",
    kind: "waiver",
    createdAtMs: null,
    addedPlayerIds: [],
    droppedPlayerIds: [],
    faabSpent: null,
    faabBudget: null,
    ...overrides,
  };
}

describe("computeRosterOps: lineup efficiency (read, not computed)", () => {
  it("weights the mean by weeksGraded rather than taking a plain average", () => {
    const input = makeInput({
      ledgers: [
        ledger({ sleeperLeagueId: "A", weeksGraded: 2, lineupEfficiency: 0.5 }),
        ledger({ sleeperLeagueId: "B", weeksGraded: 18, lineupEfficiency: 0.95 }),
      ],
    });
    const result = computeRosterOps(input);

    // Weighted: (0.5*2 + 0.95*18) / 20 = 0.905. Plain mean would be 0.725.
    expect(result.lineupEfficiency.all).toBeCloseTo(0.905, 4);
    expect(result.lineupEfficiency.all).not.toBeCloseTo(0.725, 2);
  });

  it("returns null and a sample size of 0 for a lens with zero ledger rows", () => {
    const input = makeInput({
      ledgers: [ledger({ category: "dynasty" })],
    });
    const result = computeRosterOps(input);

    expect(result.lineupEfficiency.redraft).toBeNull();
    expect(result.bestLineupRecord.redraft).toBeNull();
    expect(result.winsLeftOnBench.redraft).toBeNull();
    expect(result.lineupEfficiencySampleSize.redraft).toBe(0);
  });

  it("counts sample size only for league-seasons that actually had a ledger row", () => {
    const input = makeInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1" }),
        leagueSeason({ sleeperLeagueId: "L2" }),
        leagueSeason({ sleeperLeagueId: "L3" }),
        leagueSeason({ sleeperLeagueId: "L4" }),
        leagueSeason({ sleeperLeagueId: "L5" }),
      ],
      ledgers: [
        ledger({ sleeperLeagueId: "L1" }),
        ledger({ sleeperLeagueId: "L2" }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.lineupEfficiencySampleSize.dynasty).toBe(2);
  });

  it("skips a null field on one row without dropping its contribution from another", () => {
    const input = makeInput({
      ledgers: [
        ledger({
          sleeperLeagueId: "A",
          bestLineupWins: 5,
          bestLineupLosses: 3,
          bestLineupTies: 0,
        }),
        ledger({
          sleeperLeagueId: "B",
          bestLineupWins: null,
          bestLineupLosses: 2,
          bestLineupTies: 1,
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.bestLineupRecord.all).toEqual({ wins: 5, losses: 5, ties: 1 });
  });
});

describe("computeRosterOps: moves per week", () => {
  it("excludes a league-season with a null lastWeekPlayed from both numerator and denominator", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({ sleeperLeagueId: "L1", lastWeekPlayed: null }),
        weekly({ sleeperLeagueId: "L2", lastWeekPlayed: 10 }),
      ],
      moves: [
        move({ sleeperLeagueId: "L1" }),
        move({ sleeperLeagueId: "L1" }),
        move({ sleeperLeagueId: "L1" }),
        move({ sleeperLeagueId: "L2" }),
        move({ sleeperLeagueId: "L2" }),
        move({ sleeperLeagueId: "L2" }),
        move({ sleeperLeagueId: "L2" }),
        move({ sleeperLeagueId: "L2" }),
      ],
    });
    const result = computeRosterOps(input);

    // Only L2's 5 moves over its 10 weeks should count: 0.5, not 8/10.
    expect(result.movesPerWeek.all).toBeCloseTo(0.5, 4);
  });

  it("returns null when the lens has no league-season with a known lastWeekPlayed", () => {
    const input = makeInput({
      weeklyMoves: [weekly({ lastWeekPlayed: null })],
      moves: [move()],
    });
    const result = computeRosterOps(input);

    expect(result.movesPerWeek.all).toBeNull();
  });
});

describe("computeRosterOps: move shape", () => {
  it("reads front-loaded when most moves land in the first half", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: { 1: 8, 10: 2 },
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.moveShape.all).toBe("front-loaded");
  });

  it("reads faded when most moves land in the back half", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: { 1: 2, 10: 8 },
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.moveShape.all).toBe("faded");
  });

  it("reads steady when moves split evenly across the season", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: { 1: 5, 10: 5 },
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.moveShape.all).toBe("steady");
  });

  it("returns null below the minimum move floor", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: { 1: 3, 10: 2 },
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.moveShape.all).toBeNull();
  });
});

describe("computeRosterOps: waivers and FAAB", () => {
  it("divides waiver claims by distinct league-seasons in the lens", () => {
    const input = makeInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1" }),
        leagueSeason({ sleeperLeagueId: "L2" }),
      ],
      moves: [
        move({ sleeperLeagueId: "L1", kind: "waiver" }),
        move({ sleeperLeagueId: "L1", kind: "waiver" }),
        move({ sleeperLeagueId: "L2", kind: "waiver" }),
        move({ sleeperLeagueId: "L2", kind: "trade" }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.waiverClaimsPerSeason.all).toBeCloseTo(1.5, 4);
  });

  it("returns null avgFaabBidShare, not zero, for a lens with no FAAB league", () => {
    const input = makeInput({
      leagueSeasons: [leagueSeason({ usesFaab: false, faabBudget: null })],
      moves: [move({ kind: "waiver", faabSpent: 0, faabBudget: 0 })],
    });
    const result = computeRosterOps(input);

    expect(result.avgFaabBidShare.all).toBeNull();
    expect(result.avgFaabBidShare.all).not.toBe(0);
  });

  it("averages bid share over qualifying waiver moves in a FAAB league", () => {
    const input = makeInput({
      leagueSeasons: [leagueSeason({ usesFaab: true, faabBudget: 100 })],
      moves: [
        move({ kind: "waiver", faabSpent: 10, faabBudget: 100 }),
        move({ kind: "waiver", faabSpent: 30, faabBudget: 100 }),
        // Not qualifying: missing faabSpent.
        move({ kind: "waiver", faabSpent: null, faabBudget: 100 }),
        // Not qualifying: not a waiver move.
        move({ kind: "trade", faabSpent: 50, faabBudget: 100 }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.avgFaabBidShare.all).toBeCloseTo(0.2, 4);
  });

  it("always returns null waiverPointsProduced, since the input carries no per-claim scoring", () => {
    const input = makeInput({
      leagueSeasons: [leagueSeason()],
      moves: [move({ kind: "waiver" })],
    });
    const result = computeRosterOps(input);

    expect(result.waiverPointsProduced.all).toBeNull();
    expect(result.waiverPointsProduced.dynasty).toBeNull();
    expect(result.waiverPointsProduced.redraft).toBeNull();
  });
});

describe("computeRosterOps: abandonment", () => {
  it("does not count a long quiet run that ends with a complete lineup", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: {}, // every week is quiet
          weeksWithIncompleteLineup: 0,
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.abandonmentCount.all).toBe(0);
  });

  it("counts a league-season with both a quiet run and an incomplete lineup", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          lastWeekPlayed: 14,
          movesByWeek: {},
          weeksWithIncompleteLineup: 2,
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.abandonmentCount.all).toBe(1);
  });

  it("returns 0 for a lens with league-seasons but none qualifying", () => {
    const input = makeInput({
      weeklyMoves: [
        weekly({
          sleeperLeagueId: "L1",
          lastWeekPlayed: 14,
          movesByWeek: { 14: 1 }, // moved in the final week, no quiet run
          weeksWithIncompleteLineup: 3,
        }),
        weekly({
          sleeperLeagueId: "L2",
          lastWeekPlayed: 14,
          movesByWeek: {},
          weeksWithIncompleteLineup: 0, // quiet, but lineup was always complete
        }),
      ],
    });
    const result = computeRosterOps(input);

    expect(result.abandonmentCount.all).toBe(0);
  });

  it("returns null for an empty lens", () => {
    const input = makeInput({
      weeklyMoves: [weekly({ category: "dynasty" })],
    });
    const result = computeRosterOps(input);

    expect(result.abandonmentCount.redraft).toBeNull();
  });
});
