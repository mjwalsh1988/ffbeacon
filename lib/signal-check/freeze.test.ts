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

describe("consolidation in the public payload", () => {
  const consolidationInput: AnalysisInput = {
    formatSlug: "dynasty-ppr-sflex",
    sides: {
      a: [{ kind: "player", playerId: "big" }],
      b: [
        { kind: "player", playerId: "mid1" },
        { kind: "player", playerId: "mid2" },
        { kind: "player", playerId: "mid3" },
      ],
    },
  };
  const consolidationPlayers = {
    big: { name: "Premium", position: "WR", team: "DAL", value: 5498 },
    mid1: { name: "Mid One", position: "RB", team: "SF", value: 2190 },
    mid2: { name: "Mid Two", position: "WR", team: "NYJ", value: 2164 },
    mid3: { name: "Mid Three", position: "TE", team: "KC", value: 1531 },
  };

  const run = (settings = settingsWith()) =>
    runPipeline({
      input: consolidationInput,
      resolver: fakeResolver(consolidationPlayers),
      format: DYNASTY_FORMAT,
      source: SOURCE,
      settings,
      rules: [],
      rulesetVersion: 3,
      poolMax: 9900,
    });

  it("withholds the adjustment in points but keeps the share when raw values are hidden", () => {
    const settings = settingsWith({ showRawValues: false });
    const analysis = run(settings);
    const payload = buildPublicPayload(analysis, settings, "2026-06-25T12:00:00.000Z");
    const a = payload.sides.find((s) => s.side === "a");

    expect(analysis.consolidation.applied).toBe(true);
    expect(a?.adjustment).toBeNull();
    // A percentage exposes no value scale, so it is safe at the default setting
    // and is what keeps the line item meaningful there.
    expect(a?.adjustmentPct).toBeGreaterThan(0);
    expect(payload.adjustmentLabel).toBeTruthy();
  });

  it("shows the adjustment in points when raw values are on, and it reconciles", () => {
    const settings = settingsWith({ showRawValues: true });
    const analysis = run(settings);
    const payload = buildPublicPayload(analysis, settings, "2026-06-25T12:00:00.000Z");
    const a = payload.sides.find((s) => s.side === "a");
    const b = payload.sides.find((s) => s.side === "b");

    // The header total is the assets plus the credit shown beneath them, which
    // is the whole point of putting the credit in the list.
    expect(a?.total).toBe(5498 + (a?.adjustment ?? 0));
    // The other side is untouched: a consolidation credit never docks anyone.
    expect(b?.adjustment).toBeNull();
    expect(b?.total).toBe(5885);
    expect(payload.winnerSide).toBe("a");
  });

  it("carries no adjustment fields at all on a trade that did not earn one", () => {
    const settings = settingsWith({ showRawValues: true });
    const analysis = analyze(settings);
    const payload = buildPublicPayload(analysis, settings, "2026-06-25T12:00:00.000Z");
    expect(payload.adjustmentLabel).toBeNull();
    expect(payload.sides.every((s) => s.adjustment === null)).toBe(true);
    expect(payload.sides.every((s) => s.adjustmentPct === null)).toBe(true);
  });
});
