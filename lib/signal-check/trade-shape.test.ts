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
      assumed: false,
    };
  }
  return {
    kind: "player",
    assetId: id,
    playerId: id,
    name: id,
    position: "WR",
    team: "FA",
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
  return { side: sideKey, assets, totalPre: total, totalPost: total };
}

describe("computePileOn", () => {
  it("depreciates depth beyond top K with the geometric curve", () => {
    // [100,50,30,20], K=2, base 0.9
    // 30*(1-0.9^1)=3 ; 20*(1-0.9^2)=3.8 ; total 6.8
    const r = computePileOn(side("a", [100, 50, 30, 20]), settingsWith());
    expect(r.penalty).toBeCloseTo(6.8, 6);
    expect(r.newTotal).toBeCloseTo(193.2, 6);
  });

  it("caps the penalty at the max penalty percent of the side", () => {
    const r = computePileOn(side("a", [100, 50, 30, 20]), settingsWith({ pileOnMaxPenaltyPct: 1 }));
    // cap = 1% of 200 = 2
    expect(r.penalty).toBeCloseTo(2, 6);
    expect(r.newTotal).toBeCloseTo(198, 6);
  });

  it("does not fire below the minimum asset count", () => {
    const r = computePileOn(side("a", [100, 50]), settingsWith());
    expect(r.penalty).toBe(0);
    expect(r.newTotal).toBe(150);
  });

  it("does not fire when disabled", () => {
    const r = computePileOn(side("a", [100, 50, 30, 20]), settingsWith({ pileOnEnabled: false }));
    expect(r.penalty).toBe(0);
  });
});

describe("applyTradeShape pile-on integration", () => {
  it("applies pile-on once per side and never boosts the other side", () => {
    const sides = { a: side("a", [100, 50, 30, 20]), b: side("b", [200]) };
    const r = applyTradeShape(sides, [], settingsWith(), "dynasty-ppr-sflex");

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

describe("detectShapeKey via applyTradeShape", () => {
  it("labels a near-even trade", () => {
    const sides = { a: side("a", [100]), b: side("b", [100]) };
    const r = applyTradeShape(sides, [], settingsWith(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("near_even");
  });

  it("labels a stud-for-stud swap", () => {
    const sides = { a: side("a", [100]), b: side("b", [130]) };
    const r = applyTradeShape(sides, [], settingsWith(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("stud_swap");
  });

  it("labels a roster-clog risk when pile-on fired", () => {
    const sides = { a: side("a", [100, 50, 30, 20]), b: side("b", [400]) };
    const r = applyTradeShape(sides, [], settingsWith(), "dynasty-ppr-sflex");
    expect(r.shapeKey).toBe("roster_clog");
  });
});
