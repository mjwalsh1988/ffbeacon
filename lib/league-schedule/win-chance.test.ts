import { describe, expect, it } from "vitest";
import { winProbability } from "@/lib/power-pulse/math";
import { expectedTotal, gameClock, liveWinChance, sideState } from "./win-chance";
import { otherLegWeek, playoffLeg, playoffRoundWeeks } from "./playoff-legs";
import { currentWeekFromStored } from "./stored-week";

const notStarted = (projected: number | null, sigma: number) => ({
  projected,
  sigma,
  actual: null,
  started: false,
  finished: false,
});

describe("liveWinChance", () => {
  it("before kickoff equals the plain set-lineup win probability", () => {
    const a = sideState([notStarted(20, 6), notStarted(15, 5)]);
    const b = sideState([notStarted(18, 6), notStarted(14, 4)]);
    expect(liveWinChance(a, b)).toBeCloseTo(
      winProbability(35, Math.sqrt(61), 32, Math.sqrt(52)),
      10,
    );
  });

  it("banks finished games with no spread, so the chance moves as games end", () => {
    const before = liveWinChance(
      sideState([notStarted(20, 8)]),
      sideState([notStarted(20, 8)]),
    );
    const after = liveWinChance(
      sideState([{ projected: 20, sigma: 8, actual: 35, started: true, finished: true }]),
      sideState([notStarted(20, 8)]),
    );
    expect(before).toBeCloseTo(0.5, 6);
    expect(after).toBeGreaterThan(0.9);
  });

  it("is certain once every game is over", () => {
    const a = sideState([{ projected: 20, sigma: 8, actual: 12, started: true, finished: true }]);
    const b = sideState([{ projected: 20, sigma: 8, actual: 30, started: true, finished: true }]);
    expect(liveWinChance(a, b)).toBe(0);
  });

  it("keeps what is left of a player's projection while his game is on", () => {
    const side = sideState([{ projected: 20, sigma: 8, actual: 5, started: true, finished: false }]);
    expect(side.banked).toBe(5);
    expect(side.remainingMean).toBe(15);
    expect(expectedTotal(side)).toBe(20);
    expect(side.remainingSigma).toBeLessThan(8);
  });

  it("treats a starter with no projection who has not played as nothing, and an empty side as unknown", () => {
    const empty = sideState([notStarted(null, 0)]);
    expect(empty.known).toBe(false);
    expect(liveWinChance(empty, sideState([notStarted(10, 3)]))).toBeNull();
  });
});

describe("gameClock", () => {
  const now = Date.parse("2026-11-15T19:00:00Z");
  it("reads kickoff against the clock, and calls a game over four hours in", () => {
    expect(gameClock("2026-11-15T20:25:00Z", now, null)).toEqual({ started: false, finished: false });
    expect(gameClock("2026-11-15T18:00:00Z", now, 3)).toEqual({ started: true, finished: false });
    expect(gameClock("2026-11-15T13:00:00Z", now, 3)).toEqual({ started: true, finished: true });
  });
  it("with no kickoff, counts a game as started only once points are on the board", () => {
    expect(gameClock(null, now, 0)).toEqual({ started: false, finished: false });
    expect(gameClock(null, now, 4.5)).toEqual({ started: true, finished: false });
  });
});

describe("two-week playoff rounds", () => {
  const shape = (roundType: number) => ({ playoffWeekStart: 15, playoffRoundType: roundType, playoffTeams: 4 });
  it("type 2 pairs every round's weeks", () => {
    expect(playoffRoundWeeks(15, shape(2))).toEqual([15, 16]);
    expect(playoffRoundWeeks(18, shape(2))).toEqual([17, 18]);
    expect(playoffLeg(16, shape(2))).toBe(2);
    expect(otherLegWeek(16, shape(2))).toBe(15);
  });
  it("type 1 pairs only the championship", () => {
    expect(playoffRoundWeeks(15, shape(1))).toEqual([15]);
    expect(playoffRoundWeeks(17, shape(1))).toEqual([16, 17]);
    expect(playoffLeg(15, shape(1))).toBeNull();
  });
  it("type 0 and the regular season have no legs", () => {
    expect(playoffLeg(16, shape(0))).toBeNull();
    expect(playoffRoundWeeks(10, shape(2))).toBeNull();
    expect(playoffRoundWeeks(15, { ...shape(2), playoffWeekStart: null })).toBeNull();
  });
});

describe("currentWeekFromStored", () => {
  it("is the first week not yet final, or the week after the last when all are", () => {
    expect(currentWeekFromStored([])).toBe(1);
    expect(
      currentWeekFromStored([
        { week: 1, isFinal: true },
        { week: 2, isFinal: true },
        { week: 3, isFinal: false },
      ]),
    ).toBe(3);
    expect(currentWeekFromStored([{ week: 1, isFinal: true }, { week: 2, isFinal: true }])).toBe(3);
  });
});
