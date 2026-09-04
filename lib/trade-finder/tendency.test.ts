import { describe, it, expect } from "vitest";
import {
  TENDENCY_DEFAULTS,
  appetiteScore,
  avoidsPicks,
  bandAdjustment,
  sliceFor,
} from "./tendency";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "@/lib/manager-pulse/default-settings";
import type { ManagerTendency, TendencySlice } from "@/lib/manager-pulse/types";

const SETTINGS = { minSample: 4, bandStepMax: 1 };

/** A slice with sane defaults, overridable per test. */
function slice(over: Partial<TendencySlice> = {}): TendencySlice {
  return {
    tradeCount: 10,
    tradesPerSeason: 3.5,
    avgValueMargin: null,
    positionAppetite: {},
    ageLean: null,
    picksTraded: 2,
    favouritePlayerIds: [],
    avoidPlayerIds: [],
    sampleSize: 8,
    confidence: "medium",
    ...over,
  };
}

function tendency(over: Partial<ManagerTendency> = {}): ManagerTendency {
  return {
    sleeperUserId: "u1",
    seasonsCovered: 3,
    overall: { leagueSeasons: 3, winRate: 0.5, lineupEfficiency: 0.9 },
    dynasty: null,
    redraft: null,
    ...over,
  };
}

/**
 * TENDENCY_DEFAULTS mirrors three admin settings (see the file header of
 * tendency.ts: a caller with no loaded settings falls back to these, and they
 * exist ONLY as a copy of the published defaults, never as a second place an
 * admin tunes). A copy of a number is a number that will eventually disagree
 * with its original, so this test is the thing that catches the drift: if
 * either constant changes without the other, this fails.
 */
describe("TENDENCY_DEFAULTS matches the published Manager Pulse defaults", () => {
  it("MIN_SAMPLE mirrors samples.minTradesForMargin", () => {
    expect(TENDENCY_DEFAULTS.MIN_SAMPLE).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.samples.minTradesForMargin,
    );
  });

  it("BAND_STEP_MAX mirrors tendency.bandStepMax", () => {
    expect(TENDENCY_DEFAULTS.BAND_STEP_MAX).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.tendency.bandStepMax,
    );
  });

  it("FREQUENT_TRADES_PER_SEASON mirrors wording.tradesOftenPerSeason", () => {
    expect(TENDENCY_DEFAULTS.FREQUENT_TRADES_PER_SEASON).toBe(
      DEFAULT_MANAGER_PULSE_SETTINGS.wording.tradesOftenPerSeason,
    );
  });
});

describe("sliceFor", () => {
  it("reads the dynasty slice in a dynasty league", () => {
    const d = slice({ tradeCount: 1 });
    const t = tendency({ dynasty: d, redraft: slice({ tradeCount: 2 }) });
    expect(sliceFor(t, true)).toBe(d);
  });

  it("reads the redraft slice in a redraft league", () => {
    const r = slice({ tradeCount: 1 });
    const t = tendency({ dynasty: slice({ tradeCount: 2 }), redraft: r });
    expect(sliceFor(t, false)).toBe(r);
  });

  it("never falls back to the other game's slice", () => {
    const t = tendency({ dynasty: null, redraft: slice() });
    expect(sliceFor(t, true)).toBeNull();
  });

  it("returns null for an undefined tendency, meaning no opinion rather than a neutral one", () => {
    expect(sliceFor(undefined, true)).toBeNull();
  });
});

describe("bandAdjustment", () => {
  it("gives no opinion on a null slice", () => {
    expect(bandAdjustment(null, SETTINGS)).toEqual({ steps: 0, reason: null });
  });

  it("gives no opinion below the sample floor", () => {
    const s = slice({ sampleSize: 1, tradeCount: 5, tradesPerSeason: 4, avgValueMargin: -0.1 });
    expect(bandAdjustment(s, SETTINGS)).toEqual({ steps: 0, reason: null });
  });

  it("downgrades a manager who has never completed a trade, whatever the floor says", () => {
    const s = slice({ tradeCount: 0, tradesPerSeason: 0, sampleSize: 0 });
    const result = bandAdjustment(s, SETTINGS);
    expect(result.steps).toBe(-1);
    expect(result.reason).toMatch(/0 trades/);
  });

  it("upgrades a manager who trades often and pays up, and names both figures", () => {
    const s = slice({
      tradeCount: 12,
      tradesPerSeason: 4,
      avgValueMargin: -0.08,
      sampleSize: 9,
    });
    const result = bandAdjustment(s, SETTINGS);
    expect(result.steps).toBe(1);
    expect(result.reason).toContain("12 trades");
    expect(result.reason).toContain("8%");
    expect(result.reason).toContain("9 graded trades");
  });

  it("does nothing for a frequent trader who does not pay up", () => {
    const s = slice({ tradeCount: 12, tradesPerSeason: 4, avgValueMargin: 0.05, sampleSize: 9 });
    expect(bandAdjustment(s, SETTINGS)).toEqual({ steps: 0, reason: null });
  });

  it("does nothing for an occasional trader who pays up", () => {
    const s = slice({ tradeCount: 5, tradesPerSeason: 1, avgValueMargin: -0.2, sampleSize: 5 });
    expect(bandAdjustment(s, SETTINGS)).toEqual({ steps: 0, reason: null });
  });

  it("clamps the upgrade to bandStepMax", () => {
    const s = slice({ tradeCount: 12, tradesPerSeason: 4, avgValueMargin: -0.08, sampleSize: 9 });
    expect(bandAdjustment(s, { minSample: 4, bandStepMax: 0 }).steps).toBe(0);
  });

  it("clamps the downgrade to bandStepMax", () => {
    const s = slice({ tradeCount: 0, tradesPerSeason: 0, sampleSize: 0 });
    expect(bandAdjustment(s, { minSample: 4, bandStepMax: 0 }).steps).toBe(0);
  });
});

describe("appetiteScore", () => {
  it("is zero for a null slice, whatever else is asked", () => {
    expect(appetiteScore(null, "RB", "p1")).toBe(0);
  });

  it("is zero with no position and no player id", () => {
    expect(appetiteScore(slice({ positionAppetite: { RB: 4000 } }), null, null)).toBe(0);
  });

  it("reads a positive net position flow as a positive, bounded score", () => {
    const s = slice({ positionAppetite: { RB: TENDENCY_DEFAULTS.POSITION_APPETITE_SCALE * 10 } });
    const score = appetiteScore(s, "RB", null);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
    // Saturates rather than growing without bound.
    expect(score).toBeCloseTo(TENDENCY_DEFAULTS.POSITION_COMPONENT_MAX, 5);
  });

  it("reads a negative net position flow as a negative score", () => {
    const s = slice({ positionAppetite: { WR: -500 } });
    expect(appetiteScore(s, "WR", null)).toBeLessThan(0);
  });

  it("does not read a position the tendency has no opinion on", () => {
    const s = slice({ positionAppetite: { RB: 4000 } });
    expect(appetiteScore(s, "TE", null)).toBe(0);
  });

  it("adds a bonus for a favourite player", () => {
    const s = slice({ favouritePlayerIds: ["p1"] });
    expect(appetiteScore(s, null, "p1")).toBeCloseTo(TENDENCY_DEFAULTS.FAVOURITE_BONUS, 5);
  });

  it("subtracts for an avoided player", () => {
    const s = slice({ avoidPlayerIds: ["p2"] });
    expect(appetiteScore(s, null, "p2")).toBeCloseTo(-TENDENCY_DEFAULTS.AVOID_PENALTY, 5);
  });

  it("clamps a combined position and player hit to the [-1, 1] bound", () => {
    const s = slice({
      positionAppetite: { RB: TENDENCY_DEFAULTS.POSITION_APPETITE_SCALE * 10 },
      favouritePlayerIds: ["p1"],
    });
    expect(appetiteScore(s, "RB", "p1")).toBeLessThanOrEqual(1);
  });
});

describe("avoidsPicks", () => {
  it("is false for a null slice", () => {
    expect(avoidsPicks(null, 4)).toBe(false);
  });

  it("is false on a tiny sample, even with zero picks moved", () => {
    const s = slice({ picksTraded: 0, tradeCount: 1 });
    expect(avoidsPicks(s, 4)).toBe(false);
  });

  it("is true once zero picks holds across enough trades to be a pattern", () => {
    const s = slice({ picksTraded: 0, tradeCount: 11 });
    expect(avoidsPicks(s, 4)).toBe(true);
  });

  it("is false when picks have moved at all, whatever the sample", () => {
    const s = slice({ picksTraded: 1, tradeCount: 20 });
    expect(avoidsPicks(s, 4)).toBe(false);
  });
});
