import { describe, it, expect } from "vitest";
import {
  analysisInputSchema,
  ruleInputSchema,
  ruleActionSchema,
} from "./rules/schema";

const UUID = "11111111-1111-4111-8111-111111111111"; // RFC-valid v4

describe("analysisInputSchema", () => {
  it("accepts a valid player+pick input", () => {
    const r = analysisInputSchema.safeParse({
      formatSlug: "dynasty-ppr-sflex",
      sides: {
        a: [{ kind: "player", playerId: UUID }],
        b: [{ kind: "pick", season: 2026, round: 1, pickPosition: "mid" }],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    const r = analysisInputSchema.safeParse({
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [], b: [] },
      injected: true,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-uuid player id", () => {
    const r = analysisInputSchema.safeParse({
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "not-a-uuid" }], b: [] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range pick round", () => {
    const r = analysisInputSchema.safeParse({
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "pick", season: 2026, round: 99 }], b: [] },
    });
    expect(r.success).toBe(false);
  });
});

describe("ruleActionSchema bounds", () => {
  it("accepts an in-range multiply", () => {
    expect(ruleActionSchema.safeParse({ type: "multiply_pct", value: -25 }).success).toBe(true);
  });
  it("rejects an out-of-range multiply", () => {
    expect(ruleActionSchema.safeParse({ type: "multiply_pct", value: 5000 }).success).toBe(false);
  });
  it("rejects an unknown action type", () => {
    expect(ruleActionSchema.safeParse({ type: "delete_universe", value: 1 }).success).toBe(false);
  });
});

describe("ruleInputSchema coherence", () => {
  it("accepts a coherent asset calibration rule", () => {
    const r = ruleInputSchema.safeParse({
      scope: "single_asset",
      phase: "post_format_calibration",
      action: { type: "multiply_pct", value: -10 },
      adminLabel: "QB tax",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an asset action placed in the trade-shape phase", () => {
    const r = ruleInputSchema.safeParse({
      scope: "one_side",
      phase: "post_aggregation_trade_shape",
      action: { type: "add_points", value: 10 },
      adminLabel: "bad",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a side action placed in the calibration phase", () => {
    const r = ruleInputSchema.safeParse({
      scope: "single_asset",
      phase: "post_format_calibration",
      action: { type: "side_penalty_pct", value: 10 },
      adminLabel: "bad",
    });
    expect(r.success).toBe(false);
  });
});
