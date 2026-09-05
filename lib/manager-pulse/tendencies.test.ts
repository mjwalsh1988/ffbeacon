import { describe, expect, it } from "vitest";
import { buildTendency, tendencySamples, pickTendencySlice } from "./tendencies";
import { computeFootprint } from "./engine";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { ManagerPulseSettings } from "./default-settings";
import type {
  ManagerDraftPick,
  ManagerLeagueSeason,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
} from "./input-types";

/* -------------------------------------------------------------------------- */
/* Fixture helpers, matching the convention every sibling test file uses      */
/* -------------------------------------------------------------------------- */

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

function leagueSeason(
  overrides: Partial<ManagerLeagueSeason> & { sleeperLeagueId: string; season: number },
): ManagerLeagueSeason {
  return {
    leagueId: null,
    leagueName: "Test League",
    category: "dynasty",
    sleeperLeagueType: 2,
    teamCount: 12,
    rosterPositions: [],
    usesFaab: false,
    faabBudget: null,
    rosterId: 1,
    wins: 5,
    losses: 5,
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

let pickSeq = 0;
function pick(
  overrides: Partial<ManagerDraftPick> & { sleeperLeagueId: string; season: number },
): ManagerDraftPick {
  pickSeq += 1;
  return {
    sleeperDraftId: "d1",
    pickNo: pickSeq,
    round: 1,
    playerId: null,
    sleeperPlayerId: null,
    isKeeper: false,
    marketAdp: null,
    grade: null,
    wasRookie: null,
    category: "dynasty",
    ...overrides,
  };
}

function settingsWith(overrides: Partial<ManagerPulseSettings["samples"]>): ManagerPulseSettings {
  return {
    ...DEFAULT_MANAGER_PULSE_SETTINGS,
    samples: { ...DEFAULT_MANAGER_PULSE_SETTINGS.samples, ...overrides },
  };
}

/* -------------------------------------------------------------------------- */
/* An unseen lens is null, never an empty slice                              */
/* -------------------------------------------------------------------------- */

describe("buildTendency", () => {
  it("an unseen lens (no trades, no league-seasons) produces a null slice", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" })],
      trades: [],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(tendency.dynasty).not.toBeNull();
    expect(tendency.redraft).toBeNull();
  });

  it("a lens with league-seasons but zero trades is a real slice, not null", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" })],
      trades: [],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(tendency.dynasty).not.toBeNull();
    expect(tendency.dynasty!.tradeCount).toBe(0);
  });

  /* -------------------------------------------------------------------------- */
  /* Sample counts match trading.ts's own                                      */
  /* -------------------------------------------------------------------------- */

  it("tendencySamples matches the graded-trade sample sizes trading.ts computed", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2024, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
      ],
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2024, category: "dynasty", marginPct: -0.05 }),
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: 0.02 }),
        // Ungraded: counts toward tradeCount but not the graded sample.
        trade({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", marginPct: null }),
        trade({ sleeperLeagueId: "L2", season: 2025, category: "redraft", marginPct: 0.1 }),
      ],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(tendency.dynasty).not.toBeNull();
    expect(tendency.dynasty!.tradeCount).toBe(3);
    expect(tendency.dynasty!.sampleSize).toBe(2); // graded trades only
    expect(tendency.redraft).not.toBeNull();
    expect(tendency.redraft!.tradeCount).toBe(1);
    expect(tendency.redraft!.sampleSize).toBe(1);

    expect(tendencySamples(tendency)).toEqual({ dynasty: 2, redraft: 1 });
  });

  it("an absent slice contributes a real 0 to tendencySamples, never null", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" })],
      trades: [],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(tendency.redraft).toBeNull();
    expect(tendencySamples(tendency)).toEqual({ dynasty: 0, redraft: 0 });
  });

  /* -------------------------------------------------------------------------- */
  /* Favourites and avoids are passed through, not recomputed                  */
  /* -------------------------------------------------------------------------- */

  it("passes report.affinity's favourite and avoid player ids through unchanged, to both lenses", () => {
    const input = baseInput({
      settings: settingsWith({ minAvoidSeasons: 1 }),
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2024, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
      ],
      players: {
        fav1: player({ playerId: "fav1", leagueWideRosterRate: 0.1 }),
        avoidme: player({ playerId: "avoidme", leagueWideRosterRate: 0.9 }),
      },
      picks: [
        pick({
          sleeperLeagueId: "L1",
          season: 2024,
          category: "dynasty",
          playerId: "fav1",
          round: 1,
        }),
      ],
      trades: [
        trade({ sleeperLeagueId: "L1", season: 2024, category: "dynasty", marginPct: -0.05 }),
        trade({ sleeperLeagueId: "L2", season: 2025, category: "redraft", marginPct: 0.1 }),
      ],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(report.affinity.favourites.map((f) => f.playerId)).toContain("fav1");
    expect(report.affinity.avoids.map((a) => a.playerId)).toContain("avoidme");

    expect(tendency.dynasty).not.toBeNull();
    expect(tendency.redraft).not.toBeNull();
    expect(tendency.dynasty!.favouritePlayerIds).toEqual(
      report.affinity.favourites.map((f) => f.playerId),
    );
    expect(tendency.dynasty!.avoidPlayerIds).toEqual(report.affinity.avoids.map((a) => a.playerId));
    // The SAME lists on both lenses: affinity is pooled across dynasty and
    // redraft on purpose (its own file header explains why), so there is
    // only ever one favourites/avoids list to pass through.
    expect(tendency.redraft!.favouritePlayerIds).toEqual(tendency.dynasty!.favouritePlayerIds);
    expect(tendency.redraft!.avoidPlayerIds).toEqual(tendency.dynasty!.avoidPlayerIds);
  });

  /* -------------------------------------------------------------------------- */
  /* overall block                                                              */
  /* -------------------------------------------------------------------------- */

  it("builds overall from the report's poolable figures", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty", wins: 8, losses: 2 }),
      ],
    });
    const report = computeFootprint(input, "2026-01-01T00:00:00.000Z");
    const tendency = buildTendency(input, report);

    expect(tendency.sleeperUserId).toBe(input.sleeperUserId);
    expect(tendency.seasonsCovered).toBe(report.identity.seasonsCovered);
    expect(tendency.overall.leagueSeasons).toBe(report.counts.leagueSeasons);
    expect(tendency.overall.winRate).toBe(report.results.winRate.all);
    expect(tendency.overall.lineupEfficiency).toBe(report.rosterOps.lineupEfficiency.all);
  });
});

describe("pickTendencySlice re-export", () => {
  it("is the same function types.ts exports", () => {
    expect(typeof pickTendencySlice).toBe("function");
  });
});
