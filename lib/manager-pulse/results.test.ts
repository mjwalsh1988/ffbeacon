import { describe, it, expect } from "vitest";
import { computeResults, computeLeagueRows } from "./results";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { ManagerLeagueSeason, ManagerPulseInput } from "./input-types";

/** A minimal, fully-specified league-season. Override only what a test cares about. */
function season(overrides: Partial<ManagerLeagueSeason>): ManagerLeagueSeason {
  return {
    leagueId: null,
    sleeperLeagueId: "sleeper-league",
    season: 2025,
    leagueName: "Test League",
    avatar: null,
    category: "redraft",
    sleeperLeagueType: 0,
    teamCount: 10,
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
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
    isComplete: false,
    pointsForRankByRoster: {},
    pointsAgainstRankByRoster: {},
    ...overrides,
  };
}

/** A minimal, fully-specified input. Override only leagueSeasons and settings. */
function baseInput(overrides: Partial<ManagerPulseInput>): ManagerPulseInput {
  return {
    sleeperUserId: "user-1",
    handle: "tester",
    avatarUrl: null,
    window: { seasonFrom: 2022, seasonTo: 2025 },
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

/** Settings with the rate floor lowered to 1, for tests isolating a single season. */
const NO_FLOOR_SETTINGS = {
  ...DEFAULT_MANAGER_PULSE_SETTINGS,
  samples: { ...DEFAULT_MANAGER_PULSE_SETTINGS.samples, minLeagueSeasonsForRate: 1 },
};

describe("computeResults", () => {
  it("splits dynasty and redraft, and pools both under all", () => {
    const input = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ category: "dynasty", wins: 5, losses: 3, ties: 0 }),
        season({ category: "dynasty", wins: 6, losses: 2, ties: 0 }),
        season({ category: "redraft", wins: 1, losses: 7, ties: 0 }),
        season({ category: "redraft", wins: 2, losses: 6, ties: 0 }),
        season({ category: "redraft", wins: 3, losses: 5, ties: 0 }),
      ],
    });
    const results = computeResults(input);

    expect(results.sampleSize.dynasty).toBe(2);
    expect(results.sampleSize.redraft).toBe(3);
    expect(results.sampleSize.all).toBe(5);

    expect(results.record.dynasty).toEqual({ wins: 11, losses: 5, ties: 0 });
    expect(results.record.redraft).toEqual({ wins: 6, losses: 18, ties: 0 });
    expect(results.record.all).toEqual({ wins: 17, losses: 23, ties: 0 });
  });

  it("gives a 3rd of 10 and a 3rd of 14 different finish percentiles", () => {
    const inputTen = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [season({ teamCount: 10, finish: 3 })],
    });
    const inputFourteen = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [season({ teamCount: 14, finish: 3 })],
    });

    const tenTeam = computeResults(inputTen).avgFinishPercentile.redraft;
    const fourteenTeam = computeResults(inputFourteen).avgFinishPercentile.redraft;

    expect(tenTeam).toBeCloseTo(7 / 9, 4);
    expect(fourteenTeam).toBeCloseTo(11 / 13, 4);
    expect(tenTeam).not.toBe(fourteenTeam);
  });

  it("excludes a null finish from the percentile mean rather than treating it as mid-table", () => {
    const input = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ teamCount: 10, finish: 1 }), // percentile 1
        season({ teamCount: 10, finish: null }), // must be excluded, not averaged as 0.5
      ],
    });
    const results = computeResults(input);
    // If the null season were counted as mid-table this would land near 0.75,
    // not exactly 1.
    expect(results.avgFinishPercentile.redraft).toBe(1);
  });

  it("keeps a null bracket out of both the playoff numerator and denominator", () => {
    const unknownOnly = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [season({ rosterId: 1, playoffRosterIds: null })],
    });
    expect(computeResults(unknownOnly).playoffRate.redraft).toBeNull();

    const mixed = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ rosterId: 1, playoffRosterIds: null }),
        season({ rosterId: 1, playoffRosterIds: [2, 3] }), // missed the bracket
      ],
    });
    // Denominator is 1 (the known season only), not 2, so the rate is 0/1,
    // never blended with the unknown season as if it were a miss.
    expect(computeResults(mixed).playoffRate.redraft).toBe(0);
  });

  it("never infers a championship from the best record", () => {
    const input = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ rosterId: 1, wins: 13, losses: 1, championRosterId: 2 }),
      ],
    });
    expect(computeResults(input).championships.redraft).toBe(0);
  });

  it("returns null on every field for an empty lens, never zero", () => {
    const input = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [season({ category: "redraft" })],
    });
    const results = computeResults(input);

    expect(results.sampleSize.dynasty).toBeNull();
    expect(results.record.dynasty).toBeNull();
    expect(results.winRate.dynasty).toBeNull();
    expect(results.championships.dynasty).toBeNull();
    expect(results.runnerUps.dynasty).toBeNull();
    expect(results.playoffRate.dynasty).toBeNull();
    expect(results.lastPlaceFinishes.dynasty).toBeNull();
    expect(results.avgFinishPercentile.dynasty).toBeNull();
    expect(results.pointsForRank.dynasty).toBeNull();
    expect(results.pointsAgainstRank.dynasty).toBeNull();
  });

  it("nulls rates below the sample floor but still reports real counts", () => {
    // Default floor is 3; this lens has 2 league-seasons.
    const input = baseInput({
      leagueSeasons: [
        season({ rosterId: 1, wins: 10, losses: 3, championRosterId: 1, finish: 1, teamCount: 10 }),
        season({ rosterId: 1, wins: 4, losses: 9, finish: 8, teamCount: 10 }),
      ],
    });
    const results = computeResults(input);

    expect(results.sampleSize.redraft).toBe(2);
    expect(results.winRate.redraft).toBeNull();
    expect(results.avgFinishPercentile.redraft).toBeNull();

    // Counts are never gated by the rate floor.
    expect(results.championships.redraft).toBe(1);
    expect(results.runnerUps.redraft).toBe(0);
    expect(results.lastPlaceFinishes.redraft).toBe(0);
  });

  it("counts a tie as half a win", () => {
    const input = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [season({ wins: 1, losses: 1, ties: 2 })],
    });
    // (1 + 2 * 0.5) / 4 = 0.5
    expect(computeResults(input).winRate.redraft).toBe(0.5);
  });

  it("normalizes points-for rank 0 (worst) to 1 (best)", () => {
    const best = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ rosterId: 1, teamCount: 10, pointsForRankByRoster: { 1: 1, 2: 5 } }),
      ],
    });
    const worst = baseInput({
      settings: NO_FLOOR_SETTINGS,
      leagueSeasons: [
        season({ rosterId: 1, teamCount: 10, pointsForRankByRoster: { 1: 10, 2: 5 } }),
      ],
    });
    expect(computeResults(best).pointsForRank.redraft).toBe(1);
    expect(computeResults(worst).pointsForRank.redraft).toBe(0);
  });
});

describe("computeLeagueRows", () => {
  it("sorts most recent season first, then by league name, and caps at the display setting", () => {
    const input = baseInput({
      settings: {
        ...DEFAULT_MANAGER_PULSE_SETTINGS,
        display: { ...DEFAULT_MANAGER_PULSE_SETTINGS.display, leagueRowsShown: 3 },
      },
      leagueSeasons: [
        season({ sleeperLeagueId: "a", season: 2022, leagueName: "Zebra League" }),
        season({ sleeperLeagueId: "b", season: 2025, leagueName: "Bravo League" }),
        season({ sleeperLeagueId: "c", season: 2025, leagueName: "Alpha League" }),
        season({ sleeperLeagueId: "d", season: 2024, leagueName: "Middle League" }),
        season({ sleeperLeagueId: "e", season: 2023, leagueName: "Older League" }),
      ],
    });
    const rows = computeLeagueRows(input);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.sleeperLeagueId)).toEqual(["c", "b", "d"]);
  });

  it("fills lens, champion, runnerUp, madePlayoffs and the league pulse link flag", () => {
    const input = baseInput({
      leagueSeasons: [
        season({
          leagueId: "internal-1",
          category: "dynasty",
          rosterId: 1,
          championRosterId: 1,
          runnerUpRosterId: 4,
          playoffRosterIds: [1, 2, 3, 4],
        }),
        season({
          leagueId: null,
          category: "redraft",
          rosterId: 2,
          championRosterId: 9,
          runnerUpRosterId: null,
          playoffRosterIds: [1, 3],
        }),
      ],
    });
    const rows = computeLeagueRows(input);

    const dynastyRow = rows.find((r) => r.category === "dynasty")!;
    expect(dynastyRow.lens).toBe("dynasty");
    expect(dynastyRow.champion).toBe(true);
    expect(dynastyRow.runnerUp).toBe(false);
    expect(dynastyRow.madePlayoffs).toBe(true);
    expect(dynastyRow.hasLeaguePulseLink).toBe(true);

    const redraftRow = rows.find((r) => r.category === "redraft")!;
    expect(redraftRow.lens).toBe("redraft");
    expect(redraftRow.champion).toBe(false);
    expect(redraftRow.madePlayoffs).toBe(false);
    expect(redraftRow.hasLeaguePulseLink).toBe(false);
  });
});

/*
 * Points against is the mirror of points for, and the mirror is the thing worth
 * testing: both maps store 1 = the most of their own quantity, so the roster
 * that CONCEDED the most has rank 1 and must come out at the bottom of the
 * normalized scale. Getting this backwards would quietly congratulate the
 * unluckiest manager in the league.
 */
describe("points against rank", () => {
  it("puts the roster that conceded the most at the bottom of the scale", () => {
    const worst = computeResults(
      baseInput({
        leagueSeasons: [
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 1 } }),
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 1 } }),
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 1 } }),
        ],
      }),
    );
    expect(worst.pointsAgainstRank.all).toBe(0);

    const luckiest = computeResults(
      baseInput({
        leagueSeasons: [
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 10 } }),
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 10 } }),
          season({ rosterId: 1, teamCount: 10, pointsAgainstRankByRoster: { 1: 10 } }),
        ],
      }),
    );
    expect(luckiest.pointsAgainstRank.all).toBe(1);
  });

  it("is null when no season carries a points-against rank for this manager", () => {
    const out = computeResults(
      baseInput({
        leagueSeasons: [
          season({ rosterId: 1, teamCount: 10, pointsForRankByRoster: { 1: 3 } }),
          season({ rosterId: 1, teamCount: 10, pointsForRankByRoster: { 1: 3 } }),
          season({ rosterId: 1, teamCount: 10, pointsForRankByRoster: { 1: 3 } }),
        ],
      }),
    );
    expect(out.pointsAgainstRank.all).toBeNull();
  });
});
