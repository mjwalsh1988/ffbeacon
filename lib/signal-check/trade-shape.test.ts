import { describe, it, expect } from "vitest";
import { computePileOn, applyTradeShape } from "./trade-shape";
import { settingsWith } from "./_test-kit";
import type { AnalyzedSide, AssetResult, PricedAsset, SideKey } from "./types";

function asset(id: string, value: number, kind: "player" | "pick" = "player"): PricedAsset {
  if (kind === "pick") {
    return {
      kind: "pick",
      assetId: id,
      season: 2026,
      round: 1,
      pickPosition: "mid",
      label: id,
      baseValue: value,
      noValue: false,
      blendedValue: false,
      slotEstimated: false,
    };
  }
  return {
    kind: "player",
    assetId: id,
    playerId: id,
    name: id,
    position: "WR",
    team: "FA",
    sleeperId: null,
    baseValue: value,
    noValue: false,
  };
}

function side(sideKey: SideKey, values: number[], kind: "player" | "pick" = "player"): AnalyzedSide {
  const assets: AssetResult[] = values.map((v, i) => ({
    asset: asset(`${sideKey}${i}`, v, kind),
    side: sideKey,
    baseValue: v,
    adjustedValue: v,
  }));
  const total = values.reduce((s, v) => s + v, 0);
  return {
    side: sideKey,
    assets,
    totalPre: total,
    totalPost: total,
    consolidationAdjustment: 0,
    effectiveTotal: total,
  };
}

/** Pile-on is legacy and off by default; these tests opt back into it. */
const withPileOn = (over: Parameters<typeof settingsWith>[0] = {}) =>
  settingsWith({ pileOnEnabled: true, qualityEnabled: false, ...over });

/** Quality scoring on, pile-on off: the shipping configuration. */
const withQuality = (over: Parameters<typeof settingsWith>[0] = {}) =>
  settingsWith(over);

describe("computePileOn", () => {
  it("depreciates depth beyond top K with the geometric curve", () => {
    // [100,50,30,20], K=2, base 0.9
    // 30*(1-0.9^1)=3 ; 20*(1-0.9^2)=3.8 ; total 6.8
    const r = computePileOn(side("a", [100, 50, 30, 20]), withPileOn());
    expect(r.penalty).toBeCloseTo(6.8, 6);
    expect(r.newTotal).toBeCloseTo(193.2, 6);
  });

  it("caps the penalty at the max penalty percent of the side", () => {
    const r = computePileOn(side("a", [100, 50, 30, 20]), withPileOn({ pileOnMaxPenaltyPct: 1 }));
    // cap = 1% of 200 = 2
    expect(r.penalty).toBeCloseTo(2, 6);
    expect(r.newTotal).toBeCloseTo(198, 6);
  });

  it("does not fire below the minimum asset count", () => {
    const r = computePileOn(side("a", [100, 50]), withPileOn());
    expect(r.penalty).toBe(0);
    expect(r.newTotal).toBe(150);
  });

  it("is off by default, because the quality pass replaced it", () => {
    const r = computePileOn(side("a", [100, 50, 30, 20]), settingsWith());
    expect(r.penalty).toBe(0);
  });

  it("does not fire when explicitly disabled", () => {
    const r = computePileOn(side("a", [100, 50, 30, 20]), withPileOn({ pileOnEnabled: false }));
    expect(r.penalty).toBe(0);
  });
});

describe("applyTradeShape pile-on integration", () => {
  it("applies pile-on once per side and never boosts the other side", () => {
    const sides = { a: side("a", [100, 50, 30, 20]), b: side("b", [200]) };
    const r = applyTradeShape(sides, [], withPileOn(), "dynasty-ppr-sflex");

    expect(r.pileOnFired.a).toBe(true);
    expect(r.pileOnFired.b).toBe(false);
    expect(r.sides.a.totalPost).toBeCloseTo(193.2, 6);
    // Side B is untouched: pile-on never boosts the counter side.
    expect(r.sides.b.totalPost).toBe(200);

    const pileOnTraces = r.trace.filter((t) => t.ruleId === "pile-on");
    expect(pileOnTraces).toHaveLength(1);
    expect(pileOnTraces[0].side).toBe("a");
  });
});

describe("applyTradeShape consolidation", () => {
  it("credits the side holding the premium asset against a heavier package", () => {
    const sides = { a: side("a", [5498]), b: side("b", [2190, 2164, 1531]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex", 9900);

    expect(r.consolidation.applied).toBe(true);
    expect(r.consolidation.favouredSide).toBe("a");
    // Raw totals are left exactly as they were. The credit sits beside them.
    expect(r.sides.a.totalPost).toBe(5498);
    expect(r.sides.b.totalPost).toBe(5885);
    expect(r.sides.a.effectiveTotal).toBeGreaterThan(r.sides.b.effectiveTotal);
    expect(r.sides.a.effectiveTotal).toBe(5498 + r.sides.a.consolidationAdjustment);
    expect(r.sides.b.consolidationAdjustment).toBe(0);
  });

  it("emits exactly one consolidation trace entry, on the credited side", () => {
    const sides = { a: side("a", [5498]), b: side("b", [2190, 2164, 1531]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex", 9900);

    const entries = r.trace.filter((t) => t.ruleId === "consolidation");
    expect(entries).toHaveLength(1);
    expect(entries[0].side).toBe("a");
    expect(entries[0].adjustment).toBeCloseTo(r.sides.a.consolidationAdjustment, 6);
    expect(entries[0].publicExplanation.length).toBeGreaterThan(0);
  });

  it("leaves a one-for-one completely alone", () => {
    const sides = { a: side("a", [5000]), b: side("b", [4500]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex", 9900);

    expect(r.consolidation.applied).toBe(false);
    expect(r.sides.a.effectiveTotal).toBe(5000);
    expect(r.sides.b.effectiveTotal).toBe(4500);
    expect(r.trace.filter((t) => t.ruleId === "consolidation")).toHaveLength(0);
  });

  it("does nothing at all when quality scoring is switched off", () => {
    const sides = { a: side("a", [5498]), b: side("b", [2190, 2164, 1531]) };
    const r = applyTradeShape(
      sides,
      [],
      settingsWith({ qualityEnabled: false }),
      "dynasty-ppr-sflex",
      9900,
    );
    expect(r.consolidation.enabled).toBe(false);
    expect(r.sides.a.effectiveTotal).toBe(5498);
    expect(r.sides.b.effectiveTotal).toBe(5885);
  });

  it("never charges the same package twice when pile-on is left on", () => {
    const sides = { a: side("a", [5498]), b: side("b", [2190, 2164, 1531]) };
    const both = applyTradeShape(
      sides,
      [],
      settingsWith({ pileOnEnabled: true }),
      "dynasty-ppr-sflex",
      9900,
    );
    const qualityOnly = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex", 9900);

    // Pile-on still bites the side total when an admin re-enables it, which is
    // exactly why the default is off: the same three pieces are being charged
    // by two mechanisms and the margin widens beyond what either intends.
    expect(both.sides.b.totalPost).toBeLessThan(qualityOnly.sides.b.totalPost);
  });
});

describe("detectShapeKey via applyTradeShape", () => {
  it("labels a near-even trade", () => {
    const sides = { a: side("a", [100]), b: side("b", [100]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("near_even");
  });

  it("labels a stud-for-stud swap", () => {
    const sides = { a: side("a", [100]), b: side("b", [130]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("stud_swap");
  });

  it("labels a roster-clog risk when pile-on fired", () => {
    const sides = { a: side("a", [100, 50, 30, 20]), b: side("b", [400]) };
    const r = applyTradeShape(sides, [], withPileOn(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("roster_clog");
  });

  it("labels a roster-clog risk when the quality pass discounted two pieces", () => {
    const sides = { a: side("a", [2600, 1400, 1200, 1000]), b: side("b", [6000]) };
    const r = applyTradeShape(sides, [], withQuality(), "dynasty-ppr-sflex", 9900);
    expect(r.consolidation.discountedCounts.a).toBeGreaterThanOrEqual(2);
    expect(r.shapeKey).toBe("roster_clog");
  });
});
