import { describe, expect, it } from "vitest";
import { computeDrafting } from "./drafting";
import {
  DEFAULT_MANAGER_PULSE_SETTINGS,
  type ManagerPulseSettings,
} from "./default-settings";
import type {
  ManagerDraftFacts,
  ManagerDraftPick,
  ManagerPickObservation,
  ManagerPlayerFacts,
  ManagerPulseInput,
} from "./input-types";

/* -------------------------------------------------------------------------- */
/* Fixture helpers                                                           */
/* -------------------------------------------------------------------------- */

function settingsWith(overrides: {
  samples?: Partial<ManagerPulseSettings["samples"]>;
  draft?: Partial<ManagerPulseSettings["draft"]>;
}): ManagerPulseSettings {
  return {
    ...DEFAULT_MANAGER_PULSE_SETTINGS,
    samples: { ...DEFAULT_MANAGER_PULSE_SETTINGS.samples, ...overrides.samples },
    draft: { ...DEFAULT_MANAGER_PULSE_SETTINGS.draft, ...overrides.draft },
  };
}

function makeDraft(overrides: Partial<ManagerDraftFacts> = {}): ManagerDraftFacts {
  return {
    sleeperDraftId: "d1",
    sleeperLeagueId: "league1",
    season: 2024,
    category: "dynasty",
    draftType: "snake",
    rounds: 15,
    teams: 10,
    pickTimerSeconds: 90,
    startedAtMs: 0,
    lastPickedAtMs: 1_000_000,
    totalPicks: 10,
    isStartup: null,
    ...overrides,
  };
}

function makePick(overrides: Partial<ManagerDraftPick> = {}): ManagerDraftPick {
  return {
    sleeperDraftId: "d1",
    sleeperLeagueId: "league1",
    season: 2024,
    category: "dynasty",
    pickNo: 1,
    round: 1,
    playerId: "p1",
    sleeperPlayerId: "p1",
    isKeeper: false,
    marketAdp: null,
    grade: null,
    wasRookie: null,
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<ManagerPickObservation> = {},
): ManagerPickObservation {
  return {
    sleeperDraftId: "d1",
    pickNo: 1,
    firstSeenAtMs: 0,
    observationGapMs: 45_000,
    wasAutopick: null,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<ManagerPlayerFacts> = {}): ManagerPlayerFacts {
  return {
    playerId: "p1",
    sleeperId: "p1",
    name: "Player One",
    position: "RB",
    age: 25,
    marketValue: { dynasty: null, redraft: null },
    leagueWideRosterRate: null,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ManagerPulseInput> = {}): ManagerPulseInput {
  return {
    sleeperUserId: "u1",
    handle: "TestManager",
    avatarUrl: null,
    window: { seasonFrom: 2021, seasonTo: 2024 },
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
/* Reach index                                                               */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: reach index", () => {
  it("a player taken at pick 5 with ADP 20 in a 10-team league is +1.5 rounds", () => {
    const drafts = [makeDraft({ teams: 10 })];
    const picks = [makePick({ pickNo: 5, marketAdp: 20 })];
    const settings = settingsWith({ samples: { minDraftsForReach: 1 } });
    const result = computeDrafting(makeInput({ drafts, picks, settings }));
    expect(result.reachIndexRounds.dynasty).toBe(1.5);
    expect(result.reachIndexRounds.all).toBe(1.5);
    expect(result.reachIndexSampleSize.dynasty).toBe(1);
  });

  it("excludes a null marketAdp pick rather than treating it as on-market", () => {
    const drafts = [makeDraft({ teams: 10 })];
    const picks = [
      makePick({ pickNo: 5, marketAdp: 20 }),
      makePick({ pickNo: 8, marketAdp: null, round: 2 }),
    ];
    const settings = settingsWith({ samples: { minDraftsForReach: 1 } });
    const result = computeDrafting(makeInput({ drafts, picks, settings }));
    // Only the priced pick contributes; the null-ADP pick is dropped, not zeroed.
    expect(result.reachIndexRounds.dynasty).toBe(1.5);
    expect(result.reachIndexSampleSize.dynasty).toBe(1);
  });

  it("returns null below minDraftsForReach distinct drafts", () => {
    const drafts = [makeDraft({ teams: 10 })];
    const picks = [makePick({ pickNo: 5, marketAdp: 20 })];
    const settings = settingsWith({ samples: { minDraftsForReach: 2 } });
    const result = computeDrafting(makeInput({ drafts, picks, settings }));
    expect(result.reachIndexRounds.dynasty).toBeNull();
    // Sample size still reports the real evidence count even while gated.
    expect(result.reachIndexSampleSize.dynasty).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Keeper exclusion                                                          */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: keeper exclusion", () => {
  it("excludes keepers from reach, positional shape and draft grade", () => {
    const drafts = [makeDraft({ teams: 10 })];
    const players = {
      p1: makePlayer({ playerId: "p1", position: "RB" }),
      p2: makePlayer({ playerId: "p2", position: "QB" }),
    };
    const picks = [
      makePick({ pickNo: 5, marketAdp: 20, round: 1, playerId: "p1", grade: 80, isKeeper: false }),
      // A keeper carried at a slot the league's rules set: wildly different
      // ADP gap, a different position, and a low grade, all of which must be
      // invisible to every figure below.
      makePick({ pickNo: 1, marketAdp: 200, round: 1, playerId: "p2", grade: 10, isKeeper: true }),
    ];
    const settings = settingsWith({ samples: { minDraftsForReach: 1 } });
    const result = computeDrafting(makeInput({ drafts, picks, players, settings }));

    expect(result.reachIndexRounds.dynasty).toBe(1.5);
    expect(result.firstRoundsShape.dynasty).toEqual({ RB: 1 });
    expect(result.avgDraftGrade.dynasty).toBe(80);
  });
});

/* -------------------------------------------------------------------------- */
/* Positional shape                                                          */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: positional shape", () => {
  it("sums to 1 and excludes a null position from both halves", () => {
    const players = {
      p1: makePlayer({ playerId: "p1", position: "RB" }),
      p2: makePlayer({ playerId: "p2", position: "RB" }),
      p3: makePlayer({ playerId: "p3", position: "WR" }),
      // p4 deliberately absent from the player map, so its position resolves
      // to null and it must not appear in either the numerator or the count.
    };
    const picks = [
      makePick({ pickNo: 1, round: 1, playerId: "p1" }),
      makePick({ pickNo: 2, round: 2, playerId: "p2" }),
      makePick({ pickNo: 3, round: 3, playerId: "p3" }),
      makePick({ pickNo: 4, round: 3, playerId: "p4" }),
    ];
    const result = computeDrafting(makeInput({ picks, players }));

    expect(result.firstRoundsShape.dynasty).toEqual({ RB: 2 / 3, WR: 1 / 3 });
    const shape = result.firstRoundsShape.dynasty ?? {};
    const total = Object.values(shape).reduce((sum, v) => sum + (v ?? 0), 0);
    expect(total).toBeCloseTo(1, 10);
    expect(result.firstRoundsSampleSize.dynasty).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Rookie versus veteran lean                                                */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: rookie versus veteran lean", () => {
  it("is null for a redraft-only manager", () => {
    const drafts = [makeDraft({ category: "redraft", isStartup: null })];
    const picks = [
      makePick({ category: "redraft", pickNo: 1, wasRookie: true }),
      makePick({ category: "redraft", pickNo: 2, wasRookie: false }),
    ];
    const result = computeDrafting(makeInput({ drafts, picks }));
    expect(result.rookieVeteranLean).toBeNull();
    expect(result.rookieVeteranLeanSampleSize).toBe(0);
  });

  it("excludes drafts where isStartup is null", () => {
    const drafts = [makeDraft({ category: "dynasty", isStartup: null })];
    const picks = [
      makePick({ category: "dynasty", pickNo: 1, wasRookie: true }),
      makePick({ category: "dynasty", pickNo: 2, wasRookie: false }),
      makePick({ category: "dynasty", pickNo: 3, wasRookie: false }),
    ];
    const result = computeDrafting(makeInput({ drafts, picks }));
    // isStartup: null means "we cannot tell", never treated as a startup.
    expect(result.rookieVeteranLean).toBeNull();
    expect(result.rookieVeteranLeanSampleSize).toBe(0);
  });

  it("computes the lean over a genuine dynasty startup draft", () => {
    const drafts = [makeDraft({ category: "dynasty", isStartup: true })];
    const picks = [
      makePick({ category: "dynasty", pickNo: 1, wasRookie: true }),
      makePick({ category: "dynasty", pickNo: 2, wasRookie: true }),
      makePick({ category: "dynasty", pickNo: 3, wasRookie: false }),
      // Unknown-rookie-status pick is excluded from the total.
      makePick({ category: "dynasty", pickNo: 4, wasRookie: null }),
    ];
    const result = computeDrafting(makeInput({ drafts, picks }));
    expect(result.rookieVeteranLean).toBeCloseTo(1 / 3, 10);
    expect(result.rookieVeteranLeanSampleSize).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Draft pace                                                                */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: draft pace", () => {
  it("excludes a draft with a null lastPickedAtMs", () => {
    const drafts = [
      makeDraft({
        sleeperDraftId: "d1",
        startedAtMs: 0,
        lastPickedAtMs: 600_000,
        totalPicks: 12,
        pickTimerSeconds: 120,
      }),
      makeDraft({ sleeperDraftId: "d2", startedAtMs: 0, lastPickedAtMs: null, totalPicks: 12 }),
    ];
    const result = computeDrafting(makeInput({ drafts }));
    expect(result.draftPace).not.toBeNull();
    expect(result.draftPace?.draftsObserved).toBe(1);
    expect(result.draftPace?.secondsPerPick).toBe(50);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-pick clock                                                            */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: per-pick clock", () => {
  it("excludes a pair where either observation has a null observationGapMs", () => {
    const observations = [
      makeObservation({ pickNo: 1, firstSeenAtMs: 0, observationGapMs: 45_000 }),
      // Seen in a bulk first poll: no elapsed time can be derived either side of it.
      makeObservation({ pickNo: 2, firstSeenAtMs: 30_000, observationGapMs: null }),
      makeObservation({ pickNo: 3, firstSeenAtMs: 90_000, observationGapMs: 45_000 }),
      makeObservation({ pickNo: 4, firstSeenAtMs: 150_000, observationGapMs: 45_000 }),
    ];
    // pickNo 2, 3 and 4 are this manager's own picks; only the (3, 4) gap
    // has both endpoints usable.
    const picks = [
      makePick({ pickNo: 2 }),
      makePick({ pickNo: 3 }),
      makePick({ pickNo: 4 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    expect(result.perPickClock).not.toBeNull();
    expect(result.perPickClock?.sampleSize).toBe(1);
    expect(result.perPickClock?.medianSeconds).toBe(60);
  });

  it("uses the median rather than the mean on a skewed set", () => {
    const observations = [
      makeObservation({ sleeperDraftId: "d1", pickNo: 1, firstSeenAtMs: 0, observationGapMs: 1000 }),
      makeObservation({ sleeperDraftId: "d1", pickNo: 2, firstSeenAtMs: 10_000, observationGapMs: 1000 }),
      makeObservation({ sleeperDraftId: "d1", pickNo: 3, firstSeenAtMs: 20_000, observationGapMs: 1000 }),
      // One manager who stepped away: a five-hour outlier, still under the
      // six-hour drop threshold, that must not drag the median with it.
      makeObservation({
        sleeperDraftId: "d1",
        pickNo: 4,
        firstSeenAtMs: 20_000 + 18_000_000,
        observationGapMs: 1000,
      }),
    ];
    const picks = [
      makePick({ sleeperDraftId: "d1", pickNo: 2 }),
      makePick({ sleeperDraftId: "d1", pickNo: 3 }),
      makePick({ sleeperDraftId: "d1", pickNo: 4 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    // Diffs are 10s, 10s, 18000s. Median is 10, mean would be ~6006.67.
    expect(result.perPickClock?.sampleSize).toBe(3);
    expect(result.perPickClock?.medianSeconds).toBe(10);
  });

  it("drops a gap larger than six hours", () => {
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    const secondPickSeenAtMs = SIX_HOURS_MS + 1;
    const observations = [
      makeObservation({ sleeperDraftId: "d1", pickNo: 1, firstSeenAtMs: 0, observationGapMs: 1000 }),
      makeObservation({
        sleeperDraftId: "d1",
        pickNo: 2,
        firstSeenAtMs: secondPickSeenAtMs,
        observationGapMs: 1000,
      }),
      makeObservation({
        sleeperDraftId: "d1",
        pickNo: 3,
        firstSeenAtMs: secondPickSeenAtMs + 20_000,
        observationGapMs: 1000,
      }),
    ];
    const picks = [
      makePick({ sleeperDraftId: "d1", pickNo: 2 }),
      makePick({ sleeperDraftId: "d1", pickNo: 3 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    // The (1, 2) gap is a paused draft, not a nine-hour pick, and is dropped.
    // Only the (2, 3) gap, 20 seconds, remains.
    expect(result.perPickClock?.sampleSize).toBe(1);
    expect(result.perPickClock?.medianSeconds).toBe(20);
  });

  it("reports errorBarMs as the max gap across contributing observations, not the mean", () => {
    const observations = [
      makeObservation({ sleeperDraftId: "d1", pickNo: 1, firstSeenAtMs: 0, observationGapMs: 1000 }),
      makeObservation({ sleeperDraftId: "d1", pickNo: 2, firstSeenAtMs: 10_000, observationGapMs: 2000 }),
      makeObservation({ sleeperDraftId: "d2", pickNo: 1, firstSeenAtMs: 0, observationGapMs: 500 }),
      makeObservation({ sleeperDraftId: "d2", pickNo: 2, firstSeenAtMs: 5_000, observationGapMs: 100 }),
    ];
    const picks = [
      makePick({ sleeperDraftId: "d1", pickNo: 2 }),
      makePick({ sleeperDraftId: "d2", pickNo: 2 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    // Draft d1's pair maxes at 2000ms, d2's pair maxes at 500ms. The mean of
    // those two maxima would be 1250; the honest error bar is the worse one.
    expect(result.perPickClock?.sampleSize).toBe(2);
    expect(result.perPickClock?.errorBarMs).toBe(2000);
  });
});

/* -------------------------------------------------------------------------- */
/* Autopick                                                                  */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: autopick", () => {
  it("never counts a null wasAutopick as false", () => {
    const observations = [
      makeObservation({ sleeperDraftId: "d1", pickNo: 1, wasAutopick: null }),
      makeObservation({ sleeperDraftId: "d2", pickNo: 1, wasAutopick: null }),
      makeObservation({ sleeperDraftId: "d2", pickNo: 2, wasAutopick: true }),
    ];
    const picks = [
      makePick({ sleeperDraftId: "d1", pickNo: 1 }),
      makePick({ sleeperDraftId: "d2", pickNo: 1 }),
      makePick({ sleeperDraftId: "d2", pickNo: 2 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    // Draft d1 has only a null observation, so it never enters the
    // denominator. If null had counted as false, the rate would be 0.5
    // instead of a clean 1.
    expect(result.autopick).not.toBeNull();
    expect(result.autopick?.draftsObserved).toBe(1);
    expect(result.autopick?.rate).toBe(1);
  });

  it("returns null for the whole fact when every observation is null", () => {
    const observations = [
      makeObservation({ sleeperDraftId: "d1", pickNo: 1, wasAutopick: null }),
      makeObservation({ sleeperDraftId: "d1", pickNo: 2, wasAutopick: null }),
    ];
    const picks = [
      makePick({ sleeperDraftId: "d1", pickNo: 1 }),
      makePick({ sleeperDraftId: "d1", pickNo: 2 }),
    ];
    const result = computeDrafting(
      makeInput({ picks, pickObservations: observations }),
    );
    expect(result.autopick).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Keeper usage                                                              */
/* -------------------------------------------------------------------------- */

describe("computeDrafting: keeper usage", () => {
  it("is null when no league-season carries a keeper pick", () => {
    const picks = [
      makePick({ pickNo: 1, isKeeper: false }),
      makePick({ pickNo: 2, isKeeper: false }),
    ];
    const result = computeDrafting(makeInput({ picks }));
    expect(result.keeperUsageRate).toBeNull();
  });

  it("computes the rate only over league-seasons that carry a keeper", () => {
    const picks = [
      makePick({ sleeperLeagueId: "keeper-league", season: 2024, pickNo: 1, isKeeper: true }),
      makePick({ sleeperLeagueId: "keeper-league", season: 2024, pickNo: 2, isKeeper: false }),
      makePick({ sleeperLeagueId: "keeper-league", season: 2024, pickNo: 3, isKeeper: false }),
      makePick({ sleeperLeagueId: "keeper-league", season: 2024, pickNo: 4, isKeeper: false }),
      // A different league-season with no keepers at all: excluded from
      // both the numerator and the denominator.
      makePick({ sleeperLeagueId: "no-keeper-league", season: 2024, pickNo: 1, isKeeper: false }),
    ];
    const result = computeDrafting(makeInput({ picks }));
    expect(result.keeperUsageRate).toBe(0.25);
    expect(result.keeperUsageSampleSize).toBe(4);
  });
});
