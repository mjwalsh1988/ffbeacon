import { describe, it, expect } from "vitest";
import { calculateFaabRecommendation } from "./calculate-faab";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { FaabCalcInput, FaabSettings, FaabPoolEntry } from "./types";

function clone(s: FaabSettings): FaabSettings {
  return structuredClone(s);
}

/** A synthetic ranked pool: rank 1 is the most valuable, values decay linearly
 * down to ~0 at the bottom. Source-agnostic shape, just used to locate
 * replacement/elite values. */
function makePool(n: number): FaabPoolEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    overallRank: i + 1,
    value: (n - i) * 10,
  }));
}

function baseInput(overrides: Partial<FaabCalcInput>): FaabCalcInput {
  return {
    player: { overallRank: 100, positionRank: 40, value: null },
    remainingBudget: 100,
    needLevel: "medium",
    teams: 12,
    offensiveStarters: 9,
    settings: DEFAULT_FAAB_SETTINGS,
    ...overrides,
  };
}

describe("calculateFaabRecommendation", () => {
  it("shallow leagues reduce bids for fringe/depth players", () => {
    // Shallow league: 8 teams x 7 starters = 56 demand. A rank-80 player has
    // ratio ~1.43, which is fringe/depth, so the shallow depth cut applies.
    const player = { overallRank: 80, value: null };
    const withCut = calculateFaabRecommendation(
      baseInput({ player, teams: 8, offensiveStarters: 7 }),
    );
    const noCut = clone(DEFAULT_FAAB_SETTINGS);
    noCut.depthAdjustments.shallowDepthCutPct = 0;
    const withoutCut = calculateFaabRecommendation(
      baseInput({ player, teams: 8, offensiveStarters: 7, settings: noCut }),
    );
    expect(withCut.debugContext.depthTier).toBe("shallow");
    expect(withCut.highBid).toBeLessThan(withoutCut.highBid);
  });

  it("deep leagues increase bids for useful depth players", () => {
    // Deep league: 16 teams x 9 starters = 144 demand. A rank-200 player has
    // ratio ~1.39 (useful depth), so the deep depth boost applies.
    const player = { overallRank: 200, value: null };
    const withBoost = calculateFaabRecommendation(
      baseInput({ player, teams: 16, offensiveStarters: 9 }),
    );
    const noBoost = clone(DEFAULT_FAAB_SETTINGS);
    noBoost.depthAdjustments.deepDepthBoostPct = 0;
    const withoutBoost = calculateFaabRecommendation(
      baseInput({ player, teams: 16, offensiveStarters: 9, settings: noBoost }),
    );
    expect(withBoost.debugContext.depthTier).toBe("deep");
    expect(withBoost.highBid).toBeGreaterThan(withoutBoost.highBid);
  });

  it("dump candidacy is dynamic, not a fixed top-100 rule", () => {
    // Same rank-50 player: a dump in a deep league (threshold 144*0.4=57.6),
    // not a dump in a shallow league (threshold 56*0.4=22.4).
    const player = { overallRank: 50, value: null };
    const deep = calculateFaabRecommendation(
      baseInput({ player, teams: 16, offensiveStarters: 9 }),
    );
    const shallow = calculateFaabRecommendation(
      baseInput({ player, teams: 8, offensiveStarters: 7 }),
    );
    expect(deep.isDumpCandidate).toBe(true);
    expect(shallow.isDumpCandidate).toBe(false);

    // A rank-90 player in a standard 12x9 league is NOT a dump, where the old
    // fixed top-100 rule would have forced an all-in bid.
    const standard = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 90, value: null } }),
    );
    expect(standard.isDumpCandidate).toBe(false);
  });

  it("falls back to rank-only when value data is missing", () => {
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 120, value: null }, playerPool: makePool(300) }),
    );
    expect(res.debugContext.usedValueData).toBe(false);
    expect(res.debugContext.valueScore).toBeNull();
    expect(res.notices).toContain(DEFAULT_FAAB_SETTINGS.copy.missingValueNote);
  });

  it("uses value data when the pool and value are present", () => {
    const pool = makePool(300);
    // Rank 30 player, valued like its pool slot (top-end value).
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 30, value: pool[29].value }, playerPool: pool }),
    );
    expect(res.debugContext.usedValueData).toBe(true);
    expect(res.debugContext.valueScore).not.toBeNull();
  });

  it("never recommends more than the remaining budget", () => {
    for (const budget of [1, 3, 7, 25, 100]) {
      const res = calculateFaabRecommendation(
        baseInput({ player: { overallRank: 1, value: null }, remainingBudget: budget, needLevel: "high" }),
      );
      expect(res.highBid).toBeLessThanOrEqual(budget);
      expect(res.lowBid).toBeLessThanOrEqual(res.highBid);
      expect(res.lowBid).toBeGreaterThanOrEqual(0);
    }
  });

  it("enforces a 1-FAAB floor for non-deep-flyer tiers", () => {
    // Speculative band (ratio 1.8-2.4) with a tiny budget would round to 0, but
    // the floor lifts it to at least 1.
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 230, value: null }, remainingBudget: 10, needLevel: "low" }),
    );
    expect(res.tierLabel).toBe("Speculative add");
    expect(res.highBid).toBeGreaterThanOrEqual(1);
  });

  it("allows a true deep flyer to land at 0", () => {
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 300, value: null }, remainingBudget: 10 }),
    );
    expect(res.tierLabel).toBe("Deep flyer");
    expect(res.lowBid).toBe(0);
  });

  it("caps a tier so high need cannot exceed the ceiling", () => {
    const capped = clone(DEFAULT_FAAB_SETTINGS);
    // Force a very low cap on the depth band and a big need multiplier.
    const depthBand = capped.bidCurve.find((b) => b.id === "depth")!;
    depthBand.capPct = 5;
    capped.needMultipliers.high = 5;
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 130, value: null }, needLevel: "high", settings: capped }),
    );
    expect(res.tierLabel).toBe("Useful depth / flex");
    expect(res.highPct).toBeLessThanOrEqual(5);
  });

  it("returns zeros for a non-positive budget", () => {
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 50, value: null }, remainingBudget: 0 }),
    );
    expect(res.lowBid).toBe(0);
    expect(res.highBid).toBe(0);
  });

  it("clamps low <= high always", () => {
    const res = calculateFaabRecommendation(
      baseInput({ player: { overallRank: 12, value: null }, needLevel: "high" }),
    );
    expect(res.lowBid).toBeLessThanOrEqual(res.highBid);
    expect(res.lowPct).toBeLessThanOrEqual(res.highPct);
  });
});
