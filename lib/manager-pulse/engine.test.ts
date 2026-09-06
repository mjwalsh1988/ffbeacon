import { describe, expect, it } from "vitest";
import { computeFootprint, computeSection } from "./engine";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type {
  ManagerDraftFacts,
  ManagerLedgerFacts,
  ManagerLeagueSeason,
  ManagerPickObservation,
  ManagerPulseInput,
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
    avatar: null,
    category: "dynasty",
    sleeperLeagueType: 2,
    teamCount: 12,
    rosterPositions: [],
    usesFaab: false,
    faabBudget: null,
    rosterId: 1,
    wins: 1,
    losses: 1,
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

function ledger(
  overrides: Partial<ManagerLedgerFacts> & { sleeperLeagueId: string; season: number },
): ManagerLedgerFacts {
  return {
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

function draft(
  overrides: Partial<ManagerDraftFacts> & { sleeperDraftId: string; season: number },
): ManagerDraftFacts {
  return {
    sleeperLeagueId: "L1",
    category: "dynasty",
    draftType: "snake",
    rounds: 12,
    teams: 12,
    pickTimerSeconds: 90,
    startedAtMs: null,
    lastPickedAtMs: null,
    totalPicks: 0,
    isStartup: null,
    ...overrides,
  };
}

function observation(
  overrides: Partial<ManagerPickObservation> & { sleeperDraftId: string },
): ManagerPickObservation {
  return {
    pickNo: 1,
    firstSeenAtMs: 0,
    observationGapMs: 45_000,
    wasAutopick: null,
    ...overrides,
  };
}

const GENERATED_AT = "2026-09-04T12:00:00.000Z";

/* -------------------------------------------------------------------------- */
/* computeFootprint                                                           */
/* -------------------------------------------------------------------------- */

describe("computeFootprint", () => {
  it("is pure: the same input and generatedAt always produce the same output", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025 })],
    });
    const a = computeFootprint(input, GENERATED_AT);
    const b = computeFootprint(input, GENERATED_AT);
    expect(a).toEqual(b);
  });

  it("produces a report with every section present", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
      ],
    });

    const report = computeFootprint(input, GENERATED_AT);

    expect(report.identity).toBeDefined();
    expect(report.results).toBeDefined();
    expect(report.drafting).toBeDefined();
    expect(report.affinity).toBeDefined();
    expect(report.trading).toBeDefined();
    expect(report.rosterOps).toBeDefined();
    expect(report.narrative).toBeDefined();
    expect(Array.isArray(report.narrative.sentences)).toBe(true);
    expect(Array.isArray(report.leagues)).toBe(true);
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.modelVersion).toBe(input.settings.modelVersion);
    expect(report.window).toEqual(input.window);
  });

  it("stamps identity from the input, not from a clock", () => {
    const input = baseInput({
      sleeperUserId: "u-42",
      handle: "SomeHandle",
      avatarUrl: "https://example.test/a.png",
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2024 }),
        leagueSeason({ sleeperLeagueId: "L1", season: 2025 }),
      ],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.identity.sleeperUserId).toBe("u-42");
    expect(report.identity.handle).toBe("SomeHandle");
    expect(report.identity.avatarUrl).toBe("https://example.test/a.png");
    expect(report.identity.seasonsCovered).toBe(2);
    expect(report.identity.leagueSeasonsFound).toBe(2);
    expect(report.identity.firstSeasonSeen).toBe(2024);
  });

  it("firstSeasonSeen is null with no league-seasons", () => {
    const report = computeFootprint(baseInput(), GENERATED_AT);
    expect(report.identity.firstSeasonSeen).toBeNull();
    expect(report.identity.leagueSeasonsFound).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* counts and defaultLens                                                    */
  /* ------------------------------------------------------------------------ */

  it("splits counts into dynasty and redraft via lensForCategory, folding best ball in", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "best-ball-dynasty" }),
        leagueSeason({ sleeperLeagueId: "L3", season: 2025, category: "redraft" }),
        leagueSeason({ sleeperLeagueId: "L4", season: 2025, category: "best-ball-redraft" }),
        leagueSeason({ sleeperLeagueId: "L5", season: 2025, category: "redraft" }),
      ],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.counts.leagueSeasons).toBe(5);
    expect(report.counts.dynasty).toBe(2); // dynasty + best-ball-dynasty
    expect(report.counts.redraft).toBe(3); // redraft + best-ball-redraft + redraft
  });

  it("also splits the identity header into the raw four buckets, unfolded", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "best-ball-dynasty" }),
        leagueSeason({ sleeperLeagueId: "L3", season: 2025, category: "redraft" }),
        leagueSeason({ sleeperLeagueId: "L4", season: 2025, category: "best-ball-redraft" }),
      ],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.identity.splits).toEqual({
      dynasty: 1,
      redraft: 1,
      bestBallDynasty: 1,
      bestBallRedraft: 1,
    });
  });

  it("defaults the lens to whichever bucket holds more league-seasons", () => {
    const dynastyHeavy = computeFootprint(
      baseInput({
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "dynasty" }),
          leagueSeason({ sleeperLeagueId: "L3", season: 2025, category: "redraft" }),
        ],
      }),
      GENERATED_AT,
    );
    expect(dynastyHeavy.defaultLens).toBe("dynasty");

    const redraftHeavy = computeFootprint(
      baseInput({
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "redraft" }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
          leagueSeason({ sleeperLeagueId: "L3", season: 2025, category: "dynasty" }),
        ],
      }),
      GENERATED_AT,
    );
    expect(redraftHeavy.defaultLens).toBe("redraft");
  });

  it("defaults to all on a tie, zero league-seasons included", () => {
    expect(computeFootprint(baseInput(), GENERATED_AT).defaultLens).toBe("all");

    const tied = computeFootprint(
      baseInput({
        leagueSeasons: [
          leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
          leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
        ],
      }),
      GENERATED_AT,
    );
    expect(tied.defaultLens).toBe("all");
  });

  /* ------------------------------------------------------------------------ */
  /* limits                                                                     */
  /* ------------------------------------------------------------------------ */

  it("passes leagueSeasonsSkipped straight through", () => {
    const report = computeFootprint(baseInput({ leagueSeasonsSkipped: 7 }), GENERATED_AT);
    expect(report.limits.leagueSeasonsSkipped).toBe(7);
  });

  it("counts league-seasons with no matching ledger row", () => {
    const input = baseInput({
      leagueSeasons: [
        leagueSeason({ sleeperLeagueId: "L1", season: 2025 }),
        leagueSeason({ sleeperLeagueId: "L2", season: 2025 }),
        leagueSeason({ sleeperLeagueId: "L3", season: 2024 }),
      ],
      ledgers: [
        // Only L1/2025 has a ledger row. L2/2025 and L3/2024 do not.
        ledger({ sleeperLeagueId: "L1", season: 2025 }),
      ],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.limits.leagueSeasonsWithoutLedger).toBe(2);
  });

  it("a ledger row for a different season does not count as covering this one", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025 })],
      ledgers: [ledger({ sleeperLeagueId: "L1", season: 2024 })],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.limits.leagueSeasonsWithoutLedger).toBe(1);
  });

  it("counts seasons with a draft but zero pick observations for any of that season's drafts", () => {
    const input = baseInput({
      drafts: [
        draft({ sleeperDraftId: "d-2024", season: 2024 }),
        draft({ sleeperDraftId: "d-2025-a", season: 2025 }),
        draft({ sleeperDraftId: "d-2025-b", season: 2025 }),
      ],
      pickObservations: [
        // Only one of the two 2025 drafts was ever observed, which is
        // enough to clear that season; 2024 has none at all.
        observation({ sleeperDraftId: "d-2025-a" }),
      ],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.limits.seasonsWithoutDraftObservations).toBe(1);
  });

  it("a season with no draft at all does not count toward the observations gap", () => {
    const input = baseInput({
      leagueSeasons: [leagueSeason({ sleeperLeagueId: "L1", season: 2025 })],
      drafts: [],
      pickObservations: [],
    });
    const report = computeFootprint(input, GENERATED_AT);
    expect(report.limits.seasonsWithoutDraftObservations).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* computeSection                                                             */
/* -------------------------------------------------------------------------- */

describe("computeSection", () => {
  const input = baseInput({
    leagueSeasons: [
      leagueSeason({ sleeperLeagueId: "L1", season: 2025, category: "dynasty" }),
      leagueSeason({ sleeperLeagueId: "L2", season: 2025, category: "redraft" }),
    ],
  });
  const full = computeFootprint(input, GENERATED_AT);

  it("identity matches the full report's identity", () => {
    expect(computeSection(input, "identity")).toEqual(full.identity);
  });

  it("results matches the full report's results", () => {
    expect(computeSection(input, "results")).toEqual(full.results);
  });

  it("drafting matches the full report's drafting", () => {
    expect(computeSection(input, "drafting")).toEqual(full.drafting);
  });

  it("affinity matches the full report's affinity", () => {
    expect(computeSection(input, "affinity")).toEqual(full.affinity);
  });

  it("trading matches the full report's trading", () => {
    expect(computeSection(input, "trading")).toEqual(full.trading);
  });

  it("rosterOps matches the full report's rosterOps", () => {
    expect(computeSection(input, "rosterOps")).toEqual(full.rosterOps);
  });

  it("leagues matches the full report's leagues", () => {
    expect(computeSection(input, "leagues")).toEqual(full.leagues);
  });

  it("narrative is a real ManagerNarrative shape, independent of the generatedAt placeholder", () => {
    const section = computeSection(input, "narrative") as { sentences: unknown[] };
    expect(Array.isArray(section.sentences)).toBe(true);
    // generatedAt never feeds a narrative template, so the section computed
    // without a real timestamp matches the one computed with one.
    expect(section).toEqual(full.narrative);
  });
});
