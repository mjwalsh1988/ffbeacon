import { describe, it, expect } from "vitest";
import { applyCalibration } from "./calibration";
import type { PricedAsset, SideKey } from "./types";
import type { ParsedRule } from "./rules/schema";

function player(assetId: string, baseValue: number, position = "WR"): PricedAsset {
  return {
    kind: "player",
    assetId,
    playerId: assetId,
    name: assetId,
    position,
    team: "FA",
    sleeperId: null,
    baseValue,
    noValue: false,
  };
}

function calRule(partial: Partial<ParsedRule>): ParsedRule {
  return {
    id: "r",
    rulesetVersion: 1,
    scope: "single_asset",
    phase: "post_format_calibration",
    sortOrder: 0,
    condition: {},
    action: { type: "multiply_pct", value: -10 },
    stackable: false,
    stackGroup: null,
    maxAdjustment: null,
    adminLabel: "cal",
    publicExplanationTemplate: "",
    enabled: true,
    ...partial,
  };
}

const sides = (a: PricedAsset[], b: PricedAsset[] = []): Record<SideKey, PricedAsset[]> => ({ a, b });

describe("applyCalibration", () => {
  it("passes base values through untouched when there are no rules", () => {
    const r = applyCalibration(sides([player("p1", 100)]), [], "dynasty-ppr-sflex", "sequential");
    expect(r.sides.a.assets[0].adjustedValue).toBe(100);
    expect(r.sides.a.totalPre).toBe(100);
  });

  it("compounds stackable multiply rules sequentially", () => {
    const rules = [
      calRule({ id: "x", stackable: true, sortOrder: 0, action: { type: "multiply_pct", value: -10 } }),
      calRule({ id: "y", stackable: true, sortOrder: 1, action: { type: "multiply_pct", value: -20 } }),
    ];
    const r = applyCalibration(sides([player("p1", 100)]), rules, "dynasty-ppr-sflex", "sequential");
    expect(r.sides.a.assets[0].adjustedValue).toBeCloseTo(72, 6);
  });

  it("compounds stackable multiply rules against base when configured", () => {
    const rules = [
      calRule({ id: "x", stackable: true, sortOrder: 0, action: { type: "multiply_pct", value: -10 } }),
      calRule({ id: "y", stackable: true, sortOrder: 1, action: { type: "multiply_pct", value: -20 } }),
    ];
    const r = applyCalibration(sides([player("p1", 100)]), rules, "dynasty-ppr-sflex", "against_base");
    expect(r.sides.a.assets[0].adjustedValue).toBeCloseTo(70, 6);
  });

  it("applies a non-stackable rule exactly once (no double-counting)", () => {
    const rules = [calRule({ id: "x", action: { type: "add_points", value: 10 } })];
    const r = applyCalibration(sides([player("p1", 100)]), rules, "dynasty-ppr-sflex", "sequential");
    expect(r.sides.a.assets[0].adjustedValue).toBe(110);
    const applied = r.trace.filter((t) => t.ruleId === "x" && t.adjustment !== null);
    expect(applied).toHaveLength(1);
  });

  it("matches conditions on the base value, not the running value", () => {
    // Two stackable rules: first drops value below 60, second requires base >= 60.
    // Because matching uses BASE, the second still applies.
    const rules = [
      calRule({ id: "x", stackable: true, sortOrder: 0, action: { type: "multiply_pct", value: -50 } }),
      calRule({
        id: "y",
        stackable: true,
        sortOrder: 1,
        condition: { minValue: 60 },
        action: { type: "add_points", value: 5 },
      }),
    ];
    const r = applyCalibration(sides([player("p1", 100)]), rules, "dynasty-ppr-sflex", "sequential");
    // 100 -> 50 (-50%) -> 55 (+5)
    expect(r.sides.a.assets[0].adjustedValue).toBeCloseTo(55, 6);
  });

  it("emits a skip trace for a non-stackable rule that loses its group", () => {
    const rules = [
      calRule({ id: "a", stackable: false, stackGroup: "g", sortOrder: 0, action: { type: "add_points", value: 10 } }),
      calRule({ id: "b", stackable: false, stackGroup: "g", sortOrder: 1, action: { type: "add_points", value: 99 } }),
    ];
    const r = applyCalibration(sides([player("p1", 100)]), rules, "dynasty-ppr-sflex", "sequential");
    expect(r.sides.a.assets[0].adjustedValue).toBe(110);
    expect(r.trace.some((t) => t.ruleId === "b" && t.adminDebug.includes("skipped"))).toBe(true);
  });
});
