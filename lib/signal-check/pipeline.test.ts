import { describe, it, expect } from "vitest";
import { runPipeline } from "./pipeline";
import { SignalCheckError } from "./errors";
import type { AnalysisInput } from "./types";
import {
  fakeResolver,
  settingsWith,
  DYNASTY_FORMAT,
  REDRAFT_FORMAT,
  SOURCE,
} from "./_test-kit";

const players = {
  p1: { name: "Player One", position: "WR", team: "DAL", value: 100 },
  p2: { name: "Player Two", position: "RB", team: "SF", value: 50 },
  p3: { name: "Player Three", position: "TE", team: "KC", value: 30 },
  p4: { name: "Player Four", position: "QB", team: "BUF", value: 20 },
};

function base() {
  return {
    resolver: fakeResolver(players),
    format: DYNASTY_FORMAT,
    source: SOURCE,
    settings: settingsWith(),
    rules: [],
    rulesetVersion: 1,
  };
}

describe("runPipeline core", () => {
  it("picks a winner with the spec margin", () => {
    const input: AnalysisInput = { formatSlug: "dynasty-ppr-sflex", sides: { a: [{ kind: "player", playerId: "p1" }], b: [{ kind: "player", playerId: "p2" }] } };
    const r = runPipeline({ ...base(), input });
    expect(r.sides.a.totalPost).toBe(100);
    expect(r.sides.b.totalPost).toBe(50);
    expect(r.verdict.winnerSide).toBe("a");
    expect(r.verdict.marginPct).toBe(33.3); // 50/150
  });

  it("does not double-count: totals equal the sum of adjusted assets when no rules fire", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "p1" }, { kind: "player", playerId: "p2" }], b: [{ kind: "player", playerId: "p3" }] },
    };
    const r = runPipeline({ ...base(), input });
    // 2 assets on side a is below pileOnMinAssets (3), so no pile-on.
    expect(r.sides.a.totalPre).toBe(150);
    expect(r.sides.a.totalPost).toBe(150);
  });

  it("is deterministic / reproducible across runs", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "p1" }, { kind: "player", playerId: "p3" }, { kind: "player", playerId: "p4" }], b: [{ kind: "player", playerId: "p2" }] },
    };
    const r1 = runPipeline({ ...base(), input });
    const r2 = runPipeline({ ...base(), input });
    expect(JSON.stringify(r1)).toEqual(JSON.stringify(r2));
  });

  it("flags missing values and excludes them from totals", () => {
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "player", playerId: "ghost" }], b: [{ kind: "player", playerId: "p2" }] },
    };
    const r = runPipeline({ ...base(), input });
    expect(r.hasMissingValues).toBe(true);
    expect(r.sides.a.totalPost).toBe(0);
  });

  it("throws on an empty trade", () => {
    const input: AnalysisInput = { formatSlug: "dynasty-ppr-sflex", sides: { a: [], b: [] } };
    expect(() => runPipeline({ ...base(), input })).toThrow(SignalCheckError);
  });

  it("throws when a side exceeds the asset cap", () => {
    const many = Array.from({ length: 13 }, () => ({ kind: "player" as const, playerId: "p1" }));
    const input: AnalysisInput = { formatSlug: "dynasty-ppr-sflex", sides: { a: many, b: [] } };
    expect(() => runPipeline({ ...base(), input })).toThrow(/limited to/);
  });
});

describe("redraft vs dynasty pick handling", () => {
  it("rejects draft picks in a redraft format", () => {
    const input: AnalysisInput = {
      formatSlug: "redraft-ppr-std",
      sides: { a: [{ kind: "pick", season: 2026, round: 1, pickPosition: "mid" }], b: [{ kind: "player", playerId: "p2" }] },
    };
    expect(() =>
      runPipeline({ ...base(), input, format: REDRAFT_FORMAT }),
    ).toThrow(/dynasty-only/);
  });

  it("allows and prices draft picks in a dynasty format", () => {
    const resolver = fakeResolver(players, { "2026|1|mid": 80 });
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "pick", season: 2026, round: 1, pickPosition: "mid" }], b: [{ kind: "player", playerId: "p2" }] },
    };
    const r = runPipeline({ ...base(), resolver, input });
    expect(r.sides.a.totalPost).toBe(80);
    expect(r.verdict.winnerSide).toBe("a");
  });

  it("uses a generic season+round value for an unknown pick bucket", () => {
    const resolver = fakeResolver(players, {
      "2026|1|early": 100,
      "2026|1|mid": 80,
      "2026|1|late": 60,
    });
    const input: AnalysisInput = {
      formatSlug: "dynasty-ppr-sflex",
      sides: { a: [{ kind: "pick", season: 2026, round: 1 }], b: [{ kind: "player", playerId: "p2" }] },
    };
    const r = runPipeline({ ...base(), resolver, input });
    // generic = (100+80+60)/3 = 80
    expect(r.sides.a.totalPost).toBe(80);
  });

  // hasBlendedPicks gates the "this pick has no slot" note on every surface and
  // an 8-point confidence penalty. It was hardcoded false in the value engine,
  // so neither ever fired, on the one path (Sleeper import) where EVERY pick is
  // slotless. That is what let an imported trade and the same trade typed by
  // hand disagree with nothing on screen accounting for it.
  it("flags a slotless pick as blended, and a slotted one as not", () => {
    const buckets = { "2026|1|early": 100, "2026|1|mid": 80, "2026|1|late": 60 };
    const resolver = fakeResolver(players, buckets);

    const slotless = runPipeline({
      ...base(),
      resolver,
      input: {
        formatSlug: "dynasty-ppr-sflex",
        sides: { a: [{ kind: "pick", season: 2026, round: 1 }], b: [{ kind: "player", playerId: "p2" }] },
      },
    });
    expect(slotless.hasBlendedPicks).toBe(true);
    expect(slotless.confidence.factors.some((f) => f.key === "blended_picks")).toBe(true);

    const slotted = runPipeline({
      ...base(),
      resolver,
      input: {
        formatSlug: "dynasty-ppr-sflex",
        sides: {
          a: [{ kind: "pick", season: 2026, round: 1, pickPosition: "mid" }],
          b: [{ kind: "player", playerId: "p2" }],
        },
      },
    });
    expect(slotted.hasBlendedPicks).toBe(false);
    expect(slotted.confidence.factors.some((f) => f.key === "blended_picks")).toBe(false);
  });

  // The spread across slots is the whole reason the blend needs saying out loud.
  it("prices an early and a late pick far enough apart to move a verdict", () => {
    const resolver = fakeResolver(players, {
      "2026|1|early": 100,
      "2026|1|mid": 80,
      "2026|1|late": 60,
    });
    const sidesFor = (pickPosition?: "early" | "late"): AnalysisInput => ({
      formatSlug: "dynasty-ppr-sflex",
      sides: {
        a: [{ kind: "player", playerId: "p1" }],
        b: pickPosition
          ? [{ kind: "pick", season: 2026, round: 1, pickPosition }, { kind: "player", playerId: "p3" }]
          : [{ kind: "pick", season: 2026, round: 1 }, { kind: "player", playerId: "p3" }],
      },
    });
    const early = runPipeline({ ...base(), resolver, input: sidesFor("early") });
    const late = runPipeline({ ...base(), resolver, input: sidesFor("late") });
    const blend = runPipeline({ ...base(), resolver, input: sidesFor() });

    expect(early.sides.b.totalPost).toBe(130); // 100 + 30
    expect(late.sides.b.totalPost).toBe(90); // 60 + 30
    expect(blend.sides.b.totalPost).toBe(110); // 80 + 30
    expect(early.verdict.winnerSide).toBe("b");
    expect(late.verdict.winnerSide).toBe("a");
  });
});
