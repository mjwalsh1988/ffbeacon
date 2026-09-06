import { describe, it, expect } from "vitest";
import { computeTrading, buildTendencySlice } from "./trading";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type {
  ManagerLeagueSeason,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
} from "./input-types";
import type { ManagerPulseSettings } from "./default-settings";

/* -------------------------------------------------------------------------- */
/* Fixture helpers                                                            */
/* -------------------------------------------------------------------------- */

function player(overrides: Partial<ManagerPlayerFacts> & { playerId: string }): ManagerPlayerFacts {
  return {
    sleeperId: overrides.playerId,
    name: overrides.playerId,
    position: "WR",
    age: 25,
    marketValue: { dynasty: 1000, redraft: 1000 },
    leagueWideRosterRate: 0.1,
    ...overrides,
  };
}

function leagueSeason(
  overrides: Partial<ManagerLeagueSeason> & { sleeperLeagueId: string; season: number },
): ManagerLeagueSeason {
  return {
    leagueId: null,
    leagueName: "Test League",
    avatar: null,
    category: "dynasty",
    sleeperLeagueType: 2,
    teamCount: 12,
    rosterPositions: [],
    usesFaab: false,
    faabBudget: null,
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
    isComplete: true,
    pointsForRankByRoster: {},
    pointsAgainstRankByRoster: {},
    ...overrides,
  };
}

let tradeSeq = 0;
function trade(
  overrides: Partial<ManagerTrade> & { sleeperLeagueId: string; season: number },
): ManagerTrade {
  tradeSeq += 1;
  return {
    sleeperTransactionId: `trade-${tradeSeq}`,
    week: 5,
    category: "dynasty",
    createdAtMs: null,
    counterpartyUserIds: ["other-user"],
    incomingPlayerIds: [],
    outgoingPlayerIds: [],
    incomingPickCount: 0,
    incomingPickRounds: [],
    outgoingPickRounds: [],
    outgoingPickCount: 0,
    marginPct: null,
    verdictLabel: null,
    valueIn: null,
    valueOut: null,
    hasUnpricedPick: false,
    ...overrides,
  };
}

function settingsWithSamples(overrides: Partial<ManagerPulseSettings["samples"]>): ManagerPulseSettings {
  return {
    ...DEFAULT_MANAGER_PULSE_SETTINGS,
    samples: { ...DEFAULT_MANAGER_PULSE_SETTINGS.samples, ...overrides },
  };
}

function baseInput(overrides: Partial<ManagerPulseInput> = {}): ManagerPulseInput {
  return {
    sleeperUserId: "user-1",
    handle: "TestManager",
    avatarUrl: null,
    window: { seasonFrom: 2023, seasonTo: 2026 },
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

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("computeTrading", () => {
  it("counts a null-margin trade in tradeCount but excludes it from the mean", () => {
    const settings = settingsWithSamples({ minTradesForMargin: 1 });
    const input = baseInput({
      settings,
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: null }),
      ],
    });

    const result = computeTrading(input);

    expect(result.tradeCount.dynasty).toBe(2);
    expect(result.avgValueMarginSampleSize.dynasty).toBe(1);
    expect(result.avgValueMargin.dynasty).toBeCloseTo(0.1);
  });

  it("computes dynasty and redraft margins separately with no combined field", () => {
    const settings = settingsWithSamples({ minTradesForMargin: 1 });
    const input = baseInput({
      settings,
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.2 }),
        trade({ sleeperLeagueId: "L2", season: 2025, category: "redraft", marginPct: -0.1 }),
      ],
    });

    const result = computeTrading(input);

    expect(result.avgValueMargin.dynasty).toBeCloseTo(0.2);
    expect(result.avgValueMargin.redraft).toBeCloseTo(-0.1);
    expect("all" in result.avgValueMargin).toBe(false);
    expect("all" in result.verdictDistribution).toBe(false);
    expect("all" in result.positionAppetite).toBe(false);
    expect("all" in result.picksTraded).toBe(false);
    expect("all" in result.mostTradedWith).toBe(false);
    expect("all" in result.overpays).toBe(false);
    expect("all" in result.tradesWithUnpricedPicks).toBe(false);

    // tradeCount and tradesPerSeason ARE poolable, so they DO carry "all".
    expect("all" in result.tradeCount).toBe(true);
    expect("all" in result.tradesPerSeason).toBe(true);
  });

  it("prices a dynasty trade with dynasty values and never reads the redraft value for it", () => {
    const settings = settingsWithSamples({ minTradesForPositionLean: 1 });
    const players: Record<string, ManagerPlayerFacts> = {
      p1: player({ playerId: "p1", position: "RB", marketValue: { dynasty: 500, redraft: 9999 } }),
    };
    const input = baseInput({
      settings,
      players,
      trades: [
        trade({
          sleeperLeagueId: "L1",
          season: 2025,
          category: "dynasty",
          incomingPlayerIds: ["p1"],
        }),
      ],
    });

    const result = computeTrading(input);

    expect(result.positionAppetite.dynasty).toEqual({ RB: 500 });
  });

  it("returns a null margin below minTradesForMargin while the count stays real", () => {
    const settings = settingsWithSamples({ minTradesForMargin: 5 });
    const input = baseInput({
      settings,
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: -0.2 }),
      ],
    });

    const result = computeTrading(input);

    expect(result.avgValueMargin.dynasty).toBeNull();
    expect(result.avgValueMarginSampleSize.dynasty).toBe(2);
  });

  it("returns a null ageLean for a redraft-only manager", () => {
    const settings = settingsWithSamples({ minTradesForAgeLean: 1 });
    const input = baseInput({
      settings,
      trades: [
        trade({
          sleeperLeagueId: "L1",
          season: 2025,
          category: "redraft",
          incomingPlayerIds: ["p1"],
        }),
      ],
      players: { p1: player({ playerId: "p1" }) },
    });

    const result = computeTrading(input);

    expect(result.ageLean).toBeNull();
    expect(result.ageLeanSampleSize).toBe(0);
  });

  it("makes ageLean positive when buying a 22-year-old and selling a 30-year-old", () => {
    const settings = settingsWithSamples({ minTradesForAgeLean: 1 });
    const players: Record<string, ManagerPlayerFacts> = {
      young: player({ playerId: "young", age: 22, marketValue: { dynasty: 1000, redraft: 1000 } }),
      old: player({ playerId: "old", age: 30, marketValue: { dynasty: 1000, redraft: 1000 } }),
    };
    const input = baseInput({
      settings,
      players,
      trades: [
        trade({
          sleeperLeagueId: "L1",
          season: 2025,
          category: "dynasty",
          incomingPlayerIds: ["young"],
          outgoingPlayerIds: ["old"],
        }),
      ],
    });

    const result = computeTrading(input);

    expect(result.ageLean).not.toBeNull();
    expect(result.ageLean as number).toBeGreaterThan(0);
  });

  it("excludes a player with a null age from ageLean rather than treating him as the reference age", () => {
    const settings = settingsWithSamples({ minTradesForAgeLean: 1 });
    const players: Record<string, ManagerPlayerFacts> = {
      unknownAge: player({ playerId: "unknownAge", age: null, marketValue: { dynasty: 1000, redraft: 1000 } }),
      old: player({ playerId: "old", age: 30, marketValue: { dynasty: 1000, redraft: 1000 } }),
    };
    const input = baseInput({
      settings,
      players,
      trades: [
        trade({
          sleeperLeagueId: "L1",
          season: 2025,
          category: "dynasty",
          incomingPlayerIds: ["unknownAge"],
          outgoingPlayerIds: ["old"],
        }),
      ],
    });

    const result = computeTrading(input);

    // Only the outgoing 30-year-old contributes: selling someone older than
    // the reference age is a positive (youth-buying) contribution on its own,
    // and the null-age incoming player must not be treated as if he were 26.
    // numerator = -(1000 * (26 - 30)) = 4000, totalValueMoved = 1000, so the
    // lean is 4, not the ~0 it would be if the null-age player were folded in
    // at the reference age.
    expect(result.ageLean).not.toBeNull();
    expect(result.ageLean as number).toBeCloseTo(4);
  });

  describe("overpays", () => {
    it("emits nothing below minOverpaySample", () => {
      const settings = settingsWithSamples({ minOverpaySample: 3 });
      const players: Record<string, ManagerPlayerFacts> = {
        rb1: player({ playerId: "rb1", position: "RB" }),
      };
      const input = baseInput({
        settings,
        players,
        trades: [
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: -0.3,
          }),
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: -0.25,
          }),
        ],
      });

      const result = computeTrading(input);

      expect(result.overpays.dynasty).toEqual([]);
    });

    it("emits an entry at the floor with a negative mean margin", () => {
      const settings = settingsWithSamples({ minOverpaySample: 2 });
      const players: Record<string, ManagerPlayerFacts> = {
        rb1: player({ playerId: "rb1", position: "RB" }),
      };
      const input = baseInput({
        settings,
        players,
        trades: [
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: -0.3,
          }),
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: -0.25,
          }),
        ],
      });

      const result = computeTrading(input);

      expect(result.overpays.dynasty!.length).toBeGreaterThan(0);
      const positionEntry = result.overpays.dynasty!.find((e) => e.subject === "RB");
      expect(positionEntry).toBeDefined();
      expect(positionEntry!.avgMarginPct).toBeLessThan(0);
      expect(positionEntry!.sampleSize).toBe(2);
    });

    it("emits nothing at the floor with a positive mean margin", () => {
      const settings = settingsWithSamples({ minOverpaySample: 2 });
      const players: Record<string, ManagerPlayerFacts> = {
        rb1: player({ playerId: "rb1", position: "RB" }),
      };
      const input = baseInput({
        settings,
        players,
        trades: [
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: 0.3,
          }),
          trade({
            sleeperLeagueId: "L1",
            season: 2025,
            category: "dynasty",
            incomingPlayerIds: ["rb1"],
            marginPct: 0.25,
          }),
        ],
      });

      const result = computeTrading(input);

      expect(result.overpays.dynasty).toEqual([]);
    });
  });

  it("keeps a mostTradedWith counterparty with no handle rather than dropping them", () => {
    const input = baseInput({
      trades: [
        trade({
          sleeperLeagueId: "L1",
          season: 2025,
          category: "dynasty",
          counterpartyUserIds: ["unknown-user"],
        }),
      ],
      handles: {},
    });

    const result = computeTrading(input);

    expect(result.mostTradedWith.dynasty).toHaveLength(1);
    expect(result.mostTradedWith.dynasty![0]).toMatchObject({
      sleeperUserId: "unknown-user",
      handle: null,
      tradeCount: 1,
    });
  });
});

describe("buildTendencySlice", () => {
  it("returns null for a lens with zero trades and zero league-seasons", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
      ],
      trades: [],
    });

    const result = buildTendencySlice(input, "redraft", [], []);

    expect(result).toBeNull();
  });

  it("returns a real slice with tradeCount 0 for a lens with league-seasons but no trades", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "redraft" }),
      ],
      trades: [],
    });

    const result = buildTendencySlice(input, "redraft", [], []);

    expect(result).not.toBeNull();
    expect(result!.tradeCount).toBe(0);
  });

  it("bands confidence low, medium and high off the graded trade count", () => {
    const settings: ManagerPulseSettings = {
      ...DEFAULT_MANAGER_PULSE_SETTINGS,
      tendency: {
        ...DEFAULT_MANAGER_PULSE_SETTINGS.tendency,
        confidenceLowMax: 1,
        confidenceMediumMax: 2,
      },
    };

    const lowInput = baseInput({
      settings,
      trades: [trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 })],
    });
    const mediumInput = baseInput({
      settings,
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
      ],
    });
    const highInput = baseInput({
      settings,
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.1 }),
      ],
    });

    expect(buildTendencySlice(lowInput, "dynasty", [], [])!.confidence).toBe("low");
    expect(buildTendencySlice(mediumInput, "dynasty", [], [])!.confidence).toBe("medium");
    expect(buildTendencySlice(highInput, "dynasty", [], [])!.confidence).toBe("high");
  });

  it("carries the passed-in favourite and avoid id lists through unchanged", () => {
    const input = baseInput({
      trades: [trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" })],
    });

    const result = buildTendencySlice(input, "dynasty", ["fav-1"], ["avoid-1"]);

    expect(result!.favouritePlayerIds).toEqual(["fav-1"]);
    expect(result!.avoidPlayerIds).toEqual(["avoid-1"]);
  });
});
