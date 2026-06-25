import { describe, it, expect } from "vitest";
import { runPipeline } from "./pipeline";
import { freezeAnalysis, buildPublicPayload } from "./freeze";
import type { AnalysisInput } from "./types";
import { fakeResolver, settingsWith, DYNASTY_FORMAT, SOURCE } from "./_test-kit";

const players = {
  p1: { name: "Player One", position: "WR", team: "DAL", value: 137 },
  p2: { name: "Player Two", position: "RB", team: "SF", value: 50 },
};

const input: AnalysisInput = {
  formatSlug: "dynasty-ppr-sflex",
  sides: { a: [{ kind: "player", playerId: "p1" }], b: [{ kind: "player", playerId: "p2" }] },
};

function analyze(settings = settingsWith()) {
  return runPipeline({
    input,
    resolver: fakeResolver(players),
    format: DYNASTY_FORMAT,
    source: SOURCE,
    settings,
    rules: [],
    rulesetVersion: 3,
  });
}

describe("freezeAnalysis privacy boundary", () => {
  it("freezes the full private row with raw + adjusted values and version pins", () => {
    const analysis = analyze();
    const row = freezeAnalysis({
      analysis,
      input,
      settings: settingsWith(),
      shareId: "share_abc",
      userId: "user-123",
      isPublic: true,
      createdAtIso: "2026-06-25T12:00:00.000Z",
      sleeperContext: { leagueId: "secret-league", rosterId: 4 },
    });
    expect(row.raw_values.p1).toBe(137);
    expect(row.adjusted_values.p1).toBe(137);
    expect(row.ruleset_version).toBe(3);
    expect(row.value_engine_version).toBeTruthy();
    expect(row.side_totals_pre.a).toBe(137);
    expect(row.sleeper_context).toEqual({ leagueId: "secret-league", rosterId: 4 });
  });

  it("public_payload excludes private fields and raw values by default", () => {
    const analysis = analyze(settingsWith({ showRawValues: false }));
    const row = freezeAnalysis({
      analysis,
      input,
      settings: settingsWith({ showRawValues: false }),
      shareId: "share_abc",
      userId: "user-123",
      isPublic: true,
      createdAtIso: "2026-06-25T12:00:00.000Z",
      sleeperContext: { leagueId: "secret-league" },
    });
    const serialized = JSON.stringify(row.public_payload);
    // No user id, no sleeper context, no raw value points leak.
    expect(serialized).not.toContain("user-123");
    expect(serialized).not.toContain("secret-league");
    expect(serialized).not.toContain("137");
    // Totals are withheld when the admin toggle is off.
    expect(row.public_payload.sides.every((s) => s.total === null)).toBe(true);
    // It still carries the safe summary.
    expect(row.public_payload.verdictLabel).toContain("Side A");
  });

  it("includes side totals in the public payload only when showRawValues is on", () => {
    const settings = settingsWith({ showRawValues: true });
    const analysis = analyze(settings);
    const payload = buildPublicPayload(analysis, settings, "2026-06-25T12:00:00.000Z");
    expect(payload.sides.find((s) => s.side === "a")?.total).toBe(137);
  });
});
