import { describe, it, expect } from "vitest";
import { computeAffinity } from "./affinity";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type {
  ManagerDraftPick,
  ManagerLeagueSeason,
  ManagerMove,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
} from "./input-types";

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

function leagueSeason(overrides: Partial<ManagerLeagueSeason> & { sleeperLeagueId: string; season: number }): ManagerLeagueSeason {
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

function draftPick(overrides: Partial<ManagerDraftPick> & { sleeperDraftId: string; sleeperLeagueId: string; season: number }): ManagerDraftPick {
  return {
    category: "dynasty",
    pickNo: 1,
    round: 1,
    playerId: null,
    sleeperPlayerId: null,
    isKeeper: false,
    marketAdp: null,
    grade: null,
    wasRookie: null,
    ...overrides,
  };
}

function trade(overrides: Partial<ManagerTrade> & { sleeperTransactionId: string; sleeperLeagueId: string; season: number }): ManagerTrade {
  return {
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

function move(overrides: Partial<ManagerMove> & { sleeperTransactionId: string; sleeperLeagueId: string; season: number; kind: ManagerMove["kind"] }): ManagerMove {
  return {
    week: 5,
    category: "dynasty",
    createdAtMs: null,
    addedPlayerIds: [],
    droppedPlayerIds: [],
    faabSpent: null,
    faabBudget: null,
    ...overrides,
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

describe("computeAffinity", () => {
  it("weighs an early draft pick above a waiver add for the same player count", () => {
    const earlyDrafter = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1" }) },
        leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2023 })],
        picks: [
          draftPick({
            sleeperDraftId: "d1",
            sleeperLeagueId: "L1",
            season: 2023,
            playerId: "p1",
            round: 1,
          }),
        ],
      }),
    );

    const waiverAdder = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1" }) },
        leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2023 })],
        moves: [
          move({
            sleeperTransactionId: "t1",
            sleeperLeagueId: "L1",
            season: 2023,
            kind: "waiver",
            addedPlayerIds: ["p1"],
          }),
        ],
      }),
    );

    const earlyScore = earlyDrafter.favourites.find((f) => f.playerId === "p1")?.exposureScore;
    const waiverScore = waiverAdder.favourites.find((f) => f.playerId === "p1")?.exposureScore;

    expect(earlyScore).toBeGreaterThan(waiverScore ?? 0);
  });

  it("counts a player acquired twice in the same league-season once, at the higher weight", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1", leagueWideRosterRate: 0 }) },
        leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2023 })],
        picks: [
          draftPick({
            sleeperDraftId: "d1",
            sleeperLeagueId: "L1",
            season: 2023,
            playerId: "p1",
            round: 8, // late round, weight 1.5
          }),
        ],
        trades: [
          trade({
            sleeperTransactionId: "t1",
            sleeperLeagueId: "L1",
            season: 2023,
            incomingPlayerIds: ["p1"], // trade weight 2.0, higher than the late pick
          }),
        ],
      }),
    );

    const entry = result.favourites.find((f) => f.playerId === "p1");
    expect(entry?.exposureScore).toBe(2.0);
    expect(entry?.leagueSeasonsRostered).toBe(1);
  });

  it("ranks a rarely-rostered player above a universally-rostered one with the same raw exposure", () => {
    const result = computeAffinity(
      baseInput({
        players: {
          common: player({ playerId: "common", leagueWideRosterRate: 0.95 }),
          rare: player({ playerId: "rare", leagueWideRosterRate: 0.05 }),
        },
        leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2023 })],
        picks: [
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "common", round: 1 }),
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "rare", round: 1 }),
        ],
      }),
    );

    const rareIndex = result.favourites.findIndex((f) => f.playerId === "rare");
    const commonIndex = result.favourites.findIndex((f) => f.playerId === "common");
    expect(rareIndex).toBeGreaterThanOrEqual(0);
    expect(commonIndex).toBeGreaterThanOrEqual(0);
    expect(rareIndex).toBeLessThan(commonIndex);
  });

  it("excludes a player with a null leagueWideRosterRate from favourites", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1", leagueWideRosterRate: null }) },
        leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2023 })],
        picks: [draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "p1", round: 1 })],
      }),
    );

    expect(result.favourites.find((f) => f.playerId === "p1")).toBeUndefined();
    // Still counted in the sample size: exposure exists, only the ranking context is missing.
    expect(result.favouritesSampleSize).toBe(1);
  });

  it("does not list a player below minAvoidSeasons of opportunity as an avoid", () => {
    const result = computeAffinity(
      baseInput({
        players: { widelyRostered: player({ playerId: "widelyRostered", leagueWideRosterRate: 0.9 }) },
        // Manager only played 2 seasons; default minAvoidSeasons is 3.
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2025 }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2026 }),
        ],
      }),
    );

    expect(result.avoids.find((a) => a.playerId === "widelyRostered")).toBeUndefined();
  });

  it("never lists a player the manager rostered even once as an avoid", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1", leagueWideRosterRate: 0.9 }) },
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2023 }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2024 }),
          leagueSeason({ sleeperLeagueId: "L3", season: 2025 }),
        ],
        moves: [
          move({
            sleeperTransactionId: "t1",
            sleeperLeagueId: "L1",
            season: 2023,
            kind: "free_agent",
            addedPlayerIds: ["p1"],
          }),
        ],
      }),
    );

    expect(result.avoids.find((a) => a.playerId === "p1")).toBeUndefined();
  });

  it("lists a widely-rostered, never-owned player as an avoid once opportunity is met", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1", leagueWideRosterRate: 0.9 }) },
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2023 }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2024 }),
          leagueSeason({ sleeperLeagueId: "L3", season: 2025 }),
        ],
      }),
    );

    expect(result.avoids.find((a) => a.playerId === "p1")).toBeDefined();
  });

  it("excludes keepers from repeat drafts", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1" }) },
        picks: [
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "p1" }),
          draftPick({ sleeperDraftId: "d2", sleeperLeagueId: "L1", season: 2024, playerId: "p1", isKeeper: true }),
        ],
      }),
    );

    expect(result.repeatDrafts.find((r) => r.playerId === "p1")).toBeUndefined();
  });

  it("requires 2 or more distinct drafts for a repeat draft entry", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1" }), p2: player({ playerId: "p2" }) },
        picks: [
          // p1 drafted twice in the SAME draft: cannot really happen, but the
          // dedup by sleeperDraftId means it should not count as a repeat.
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "p1", pickNo: 1 }),
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "p1", pickNo: 2 }),
          // p2 drafted once, in a single draft: not a repeat either.
          draftPick({ sleeperDraftId: "d2", sleeperLeagueId: "L2", season: 2024, playerId: "p2", pickNo: 1 }),
        ],
      }),
    );

    expect(result.repeatDrafts.find((r) => r.playerId === "p1")).toBeUndefined();
    expect(result.repeatDrafts.find((r) => r.playerId === "p2")).toBeUndefined();
  });

  it("counts a player drafted across two distinct drafts as a repeat draft", () => {
    const result = computeAffinity(
      baseInput({
        players: { p1: player({ playerId: "p1" }) },
        picks: [
          draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: "p1" }),
          draftPick({ sleeperDraftId: "d2", sleeperLeagueId: "L2", season: 2024, playerId: "p1" }),
        ],
      }),
    );

    const entry = result.repeatDrafts.find((r) => r.playerId === "p1");
    expect(entry?.timesDrafted).toBe(2);
    expect(result.repeatDraftsSampleSize).toBe(2);
  });

  it("respects the display caps for favourites and avoids", () => {
    const players: Record<string, ManagerPlayerFacts> = {};
    const picks: ManagerDraftPick[] = [];
    const leagueSeasons: ManagerLeagueSeason[] = [
      leagueSeason({ sleeperLeagueId: "L1", season: 2023 }),
      leagueSeason({ sleeperLeagueId: "L2", season: 2024 }),
      leagueSeason({ sleeperLeagueId: "L3", season: 2025 }),
    ];

    // 20 favourite candidates: rostered by this manager, low leagueWideRosterRate.
    for (let i = 0; i < 20; i++) {
      const id = `fav-${i}`;
      players[id] = player({ playerId: id, leagueWideRosterRate: 0.05 });
      picks.push(draftPick({ sleeperDraftId: "d1", sleeperLeagueId: "L1", season: 2023, playerId: id, round: 1 }));
    }

    // 20 avoid candidates: never rostered, widely rostered generally.
    for (let i = 0; i < 20; i++) {
      const id = `avoid-${i}`;
      players[id] = player({ playerId: id, leagueWideRosterRate: 0.9 });
    }

    const result = computeAffinity(
      baseInput({
        players,
        picks,
        leagueSeasons,
        settings: {
          ...DEFAULT_MANAGER_PULSE_SETTINGS,
          display: { ...DEFAULT_MANAGER_PULSE_SETTINGS.display, favouritesShown: 5, avoidsShown: 3 },
        },
      }),
    );

    expect(result.favourites.length).toBe(5);
    expect(result.favouritesSampleSize).toBe(20);
    expect(result.avoids.length).toBe(3);
    expect(result.avoidsSampleSize).toBe(20);
  });
});
