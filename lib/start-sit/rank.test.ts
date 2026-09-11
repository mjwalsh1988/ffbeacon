import { describe, it, expect } from "vitest";
import { clampStartCount, rankForWeek } from "./rank";
import type { StartSitCandidate, StartSitProjection } from "./types";

function candidate(overrides: Partial<StartSitCandidate> & { playerId: string }): StartSitCandidate {
  return {
    slug: overrides.playerId,
    sleeperId: null,
    name: overrides.playerId,
    position: "RB",
    team: null,
    injuryStatus: null,
    ...overrides,
  };
}

function projection(
  overrides: Partial<StartSitProjection> & { playerId: string },
): StartSitProjection {
  return {
    week: 3,
    points: null,
    rawPoints: null,
    sigma: null,
    floor: null,
    ceiling: null,
    opponent: null,
    opponentMultiplier: null,
    defenseRankVsPosition: null,
    beatRate: null,
    availabilityRate: null,
    weeksGraded: 0,
    environment: null,
    environmentTier: null,
    onBye: false,
    availability: "projected",
    ...overrides,
  };
}

describe("rankForWeek", () => {
  it("ranks the top K by descending adjusted points", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
      candidate({ playerId: "c", slug: "c-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 12 }),
      projection({ playerId: "b", points: 20 }),
      projection({ playerId: "c", points: 16 }),
    ];

    const result = rankForWeek(candidates, projections, 2);

    expect(result.starters).toEqual(["b", "c"]);
    expect(result.bench).toEqual(["a"]);
    expect(result.startCount).toBe(2);
  });

  it("always benches null-points candidates and never counts them toward K", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
      candidate({ playerId: "c", slug: "c-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 12 }),
      projection({ playerId: "b", points: null, onBye: true }),
      projection({ playerId: "c", points: 16 }),
    ];

    const result = rankForWeek(candidates, projections, 2);

    // Only two candidates have points at all, so both fill the K=2 request
    // and the bye-week candidate lands on the bench regardless of K.
    expect(result.starters).toEqual(["c", "a"]);
    expect(result.bench).toEqual(["b"]);
  });

  it("produces fewer starters than K when too few candidates have points", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
      candidate({ playerId: "c", slug: "c-player" }),
      candidate({ playerId: "d", slug: "d-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 12 }),
      projection({ playerId: "b", points: null }),
      projection({ playerId: "c", points: null }),
      projection({ playerId: "d", points: 9 }),
    ];

    const result = rankForWeek(candidates, projections, 3);

    expect(result.startCount).toBe(3);
    expect(result.starters).toEqual(["a", "d"]);
    // Null-points bench members are ordered by slug, ascending.
    expect(result.bench).toEqual(["b", "c"]);
  });

  it("treats a candidate with no matching projection row the same as a null", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
    ];
    const projections = [projection({ playerId: "a", points: 10 })];

    const result = rankForWeek(candidates, projections, 1);

    expect(result.starters).toEqual(["a"]);
    expect(result.bench).toEqual(["b"]);
  });

  it("clamps K to at least 1", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 10 }),
      projection({ playerId: "b", points: 5 }),
    ];

    expect(rankForWeek(candidates, projections, 0).startCount).toBe(1);
    expect(rankForWeek(candidates, projections, -3).startCount).toBe(1);
  });

  it("clamps K to N-1 so at least one candidate is always benched", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
      candidate({ playerId: "c", slug: "c-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 10 }),
      projection({ playerId: "b", points: 8 }),
      projection({ playerId: "c", points: 6 }),
    ];

    const result = rankForWeek(candidates, projections, 10);

    expect(result.startCount).toBe(2);
    expect(result.starters).toEqual(["a", "b"]);
    expect(result.bench).toEqual(["c"]);
  });

  it("clamps K to exactly 1 on a two-candidate board", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 10 }),
      projection({ playerId: "b", points: 8 }),
    ];

    expect(clampStartCount(99, 2)).toBe(1);
    expect(rankForWeek(candidates, projections, 99).startCount).toBe(1);
  });

  it("breaks ties by higher floor, then higher beat rate, then slug ascending, and is stable", () => {
    const candidates = [
      candidate({ playerId: "z", slug: "z-player" }),
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "m", slug: "m-player" }),
    ];
    // All three tie on points and floor; only beat rate should separate a and m,
    // and z ties both on every figure so it falls back to slug order.
    const projections = [
      projection({ playerId: "z", points: 10, floor: 5, beatRate: 0.5 }),
      projection({ playerId: "a", points: 10, floor: 5, beatRate: 0.5 }),
      projection({ playerId: "m", points: 10, floor: 5, beatRate: 0.7 }),
    ];

    // K clamps to N-1 (2) on a three-candidate board, so the full tie order
    // shows up split across starters and bench.
    const result = rankForWeek(candidates, projections, 2);

    expect(result.starters).toEqual(["m", "a"]);
    expect(result.bench).toEqual(["z"]);

    // Running it again produces the identical order.
    const again = rankForWeek(candidates, projections, 2);
    expect(again.starters).toEqual(result.starters);
    expect(again.bench).toEqual(result.bench);
  });

  it("ranks a higher floor above a higher raw points tie when points are equal, then falls to beat rate", () => {
    const candidates = [
      candidate({ playerId: "a", slug: "a-player" }),
      candidate({ playerId: "b", slug: "b-player" }),
    ];
    const projections = [
      projection({ playerId: "a", points: 15, floor: 9, beatRate: 0.4 }),
      projection({ playerId: "b", points: 15, floor: 11, beatRate: 0.8 }),
    ];

    const result = rankForWeek(candidates, projections, 1);

    expect(result.starters).toEqual(["b"]);
    expect(result.bench).toEqual(["a"]);
  });

  it("allows mixed positions with no slot filtering", () => {
    const candidates = [
      candidate({ playerId: "qb", slug: "qb-player", position: "QB" }),
      candidate({ playerId: "wr", slug: "wr-player", position: "WR" }),
      candidate({ playerId: "te", slug: "te-player", position: "TE" }),
    ];
    const projections = [
      projection({ playerId: "qb", points: 18 }),
      projection({ playerId: "wr", points: 14 }),
      projection({ playerId: "te", points: 9 }),
    ];

    const result = rankForWeek(candidates, projections, 2);

    expect(result.starters).toEqual(["qb", "wr"]);
    expect(result.bench).toEqual(["te"]);
  });
});

describe("clampStartCount", () => {
  it("clamps a requested value into 1..N-1", () => {
    expect(clampStartCount(1, 5)).toBe(1);
    expect(clampStartCount(4, 5)).toBe(4);
    expect(clampStartCount(10, 5)).toBe(4);
    expect(clampStartCount(0, 5)).toBe(1);
    expect(clampStartCount(-5, 5)).toBe(1);
  });

  it("never drops the range below 1 even when N is 1", () => {
    expect(clampStartCount(5, 1)).toBe(1);
  });
});
