import { describe, it, expect } from "vitest";
import { runPipeline } from "./pipeline";
import type { AnalysisInput } from "./types";
import type { ParsedRule } from "./rules/schema";
import { fakeResolver, settingsWith, DYNASTY_FORMAT, SOURCE } from "./_test-kit";

const players = {
  q1: { name: "QB One", position: "QB", team: "BUF", value: 100 },
  w1: { name: "WR One", position: "WR", team: "DAL", value: 100 },
};

function calRule(over: Partial<ParsedRule>): ParsedRule {
  return {
    id: "r1",
    rulesetVersion: 1,
    scope: "single_asset",
    phase: "post_format_calibration",
    sortOrder: 0,
    condition: { positions: ["QB"] },
    action: { type: "multiply_pct", value: -10 },
    stackable: false,
    stackGroup: null,
    maxAdjustment: null,
    adminLabel: "QB tax",
    publicExplanationTemplate: "QB depth tax applied to {asset}.",
    enabled: true,
    ...over,
  };
}

describe("rules applied through the full pipeline", () => {
  it("applies a calibration rule and records it in the trace, changing the verdict", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "q1" }], b: [{ kind: "player", playerId: "w1" }] },
    };
    const analysis = runPipeline({
      input,
      resolver: fakeResolver(players),
      format: DYNASTY_FORMAT,
      source: SOURCE,
      settings: settingsWith(),
      rules: [calRule({})],
      rulesetVersion: 1,
    });

    // QB dropped 10% -> 90; WR untouched -> 100; B wins.
    expect(analysis.sides.a.totalPost).toBeCloseTo(90, 6);
    expect(analysis.sides.b.totalPost).toBe(100);
    expect(analysis.verdict.winnerSide).toBe("b");

    const calEntry = analysis.trace.find(
      (t) => t.phase === "post_format_calibration" && t.ruleId === "r1" && t.adjustment !== null,
    );
    expect(calEntry).toBeTruthy();
    expect(calEntry?.adjustment).toBeCloseTo(-10, 6);
    expect(calEntry?.ruleVersion).toBe(1);
  });

  it("does not apply a disabled rule", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "q1" }], b: [{ kind: "player", playerId: "w1" }] },
    };
    const analysis = runPipeline({
      input,
      resolver: fakeResolver(players),
      format: DYNASTY_FORMAT,
      source: SOURCE,
      settings: settingsWith(),
      rules: [calRule({ enabled: false })],
      rulesetVersion: 1,
    });
    expect(analysis.sides.a.totalPost).toBe(100);
    expect(analysis.verdict.isNeutral).toBe(true);
  });

  it("explanation names the winning side", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "q1" }], b: [{ kind: "player", playerId: "w1" }] },
    };
    const analysis = runPipeline({
      input,
      resolver: fakeResolver(players),
      format: DYNASTY_FORMAT,
      source: SOURCE,
      settings: settingsWith(),
      rules: [calRule({})],
      rulesetVersion: 1,
    });
    expect(analysis.explanation).toContain("Side B");
  });
});
