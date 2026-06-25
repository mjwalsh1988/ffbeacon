import { describe, it, expect } from "vitest";
import {
  matchCondition,
  applyValueAction,
  applySideAction,
  selectApplicableRules,
} from "./rules/interpreter";
import type { ParsedRule } from "./rules/schema";

function rule(partial: Partial<ParsedRule>): ParsedRule {
  return {
    id: "r1",
    rulesetVersion: 1,
    scope: "single_asset",
    phase: "post_format_calibration",
    sortOrder: 0,
    condition: {},
    action: { type: "multiply_pct", value: -10 },
    stackable: false,
    stackGroup: null,
    maxAdjustment: null,
    adminLabel: "test",
    publicExplanationTemplate: "",
    enabled: true,
    ...partial,
  };
}

describe("matchCondition", () => {
  it("matches when all present filters pass", () => {
    expect(
      matchCondition(
        { positions: ["QB"], minValue: 50 },
        { formatSlug: "dynasty-ppr-sflex", position: "QB", value: 100 },
      ),
    ).toBe(true);
  });

  it("fails a value filter when the field is absent", () => {
    expect(matchCondition({ minValue: 50 }, { formatSlug: "x" })).toBe(false);
  });

  it("respects format and position filters", () => {
    expect(matchCondition({ formats: ["a"] }, { formatSlug: "b" })).toBe(false);
    expect(matchCondition({ positions: ["RB"] }, { formatSlug: "a", position: "WR" })).toBe(false);
  });
});

describe("applyValueAction compounding", () => {
  it("sequential applies each percent to the running value", () => {
    const r1 = applyValueAction({ type: "multiply_pct", value: -10 }, 100, 100, "sequential", null);
    expect(r1?.valueAfter).toBeCloseTo(90, 6);
    const r2 = applyValueAction({ type: "multiply_pct", value: -20 }, 100, 90, "sequential", null);
    expect(r2?.valueAfter).toBeCloseTo(72, 6); // 90 * 0.8
  });

  it("against_base applies each percent to the original base", () => {
    const r1 = applyValueAction({ type: "multiply_pct", value: -10 }, 100, 100, "against_base", null);
    expect(r1?.valueAfter).toBeCloseTo(90, 6);
    const r2 = applyValueAction({ type: "multiply_pct", value: -20 }, 100, 90, "against_base", null);
    expect(r2?.valueAfter).toBeCloseTo(70, 6); // 90 - (100*0.2)
  });

  it("add_points adjusts by a flat amount", () => {
    const r = applyValueAction({ type: "add_points", value: 50 }, 100, 100, "sequential", null);
    expect(r?.valueAfter).toBe(150);
  });

  it("cap_value clamps down", () => {
    const r = applyValueAction({ type: "cap_value", value: 150 }, 200, 200, "sequential", null);
    expect(r?.valueAfter).toBe(150);
    expect(r?.adjustment).toBe(-50);
  });

  it("never produces a negative value", () => {
    const r = applyValueAction({ type: "add_points", value: -500 }, 100, 100, "sequential", null);
    expect(r?.valueAfter).toBe(0);
  });

  it("honors a pct max_adjustment guardrail", () => {
    // raw delta would be -50, but cap is 10% of base (100) = 10
    const r = applyValueAction(
      { type: "multiply_pct", value: -50 },
      100,
      100,
      "sequential",
      { type: "pct", value: 10 },
    );
    expect(r?.valueAfter).toBeCloseTo(90, 6);
  });

  it("honors a points max_adjustment guardrail", () => {
    const r = applyValueAction(
      { type: "add_points", value: 500 },
      100,
      100,
      "sequential",
      { type: "points", value: 25 },
    );
    expect(r?.valueAfter).toBe(125);
  });
});

describe("applySideAction", () => {
  it("applies a side penalty percent", () => {
    const r = applySideAction({ type: "side_penalty_pct", value: 25 }, 100, null);
    expect(r?.valueAfter).toBe(75);
  });
  it("applies a side boost percent", () => {
    const r = applySideAction({ type: "side_boost_pct", value: 10 }, 100, null);
    expect(r?.valueAfter).toBeCloseTo(110, 6);
  });
});

describe("selectApplicableRules / stackability", () => {
  it("applies stackable rules together", () => {
    const rules = [
      rule({ id: "a", stackable: true, sortOrder: 0 }),
      rule({ id: "b", stackable: true, sortOrder: 1 }),
    ];
    const { applied, skipped } = selectApplicableRules(rules);
    expect(applied).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("makes non-stackable rules in the same group mutually exclusive (first by sort_order wins)", () => {
    const rules = [
      rule({ id: "b", stackable: false, stackGroup: "g", sortOrder: 5 }),
      rule({ id: "a", stackable: false, stackGroup: "g", sortOrder: 1 }),
    ];
    const { applied, skipped } = selectApplicableRules(rules);
    expect(applied.map((r) => r.id)).toEqual(["a"]);
    expect(skipped.map((r) => r.id)).toEqual(["b"]);
  });

  it("applies non-stackable rules with null group independently", () => {
    const rules = [
      rule({ id: "a", stackable: false, stackGroup: null }),
      rule({ id: "b", stackable: false, stackGroup: null }),
    ];
    const { applied } = selectApplicableRules(rules);
    expect(applied).toHaveLength(2);
  });
});
