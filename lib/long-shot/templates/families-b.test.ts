import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { marketAnswers, marketFormats, marketRank } from "./market-rank";
import { seasonFinish } from "./season-finish";
import { fakeCtx } from "./test-context";
import { valueMover } from "./value-mover";

const ASCII = /^[\x20-\x7E]+$/;

describe("season_finish", () => {
  it("builds the single-season and union texts", () => {
    const ctx = fakeCtx();
    expect(seasonFinish.text({ position: "TE", cutoff: 12, season: 2023, union: false }, ctx)).toBe(
      "Name a tight end who finished top 12 in PPR scoring in 2023.",
    );
    expect(seasonFinish.text({ position: "QB", cutoff: 5, season: 0, union: true }, ctx)).toBe(
      "Name a quarterback who finished top 5 in PPR scoring in any season since 2020.",
    );
  });

  it("never offers the union with cutoff 24, never the current season, and TE never 24", () => {
    const ctx = fakeCtx();
    for (const p of seasonFinish.draws(mulberry32(3), ctx)) {
      if (p.cutoff === 24) expect(p.union).toBe(false);
      if (!p.union) expect(p.season).not.toBe(2026);
      if (p.position === "TE") expect(p.cutoff).not.toBe(24);
      expect(seasonFinish.position!(p)).toBe(p.position);
    }
  });
});

describe("market_rank", () => {
  it("names the source and both boards in each form", () => {
    const gap = marketRank.text({ form: "gap", a: "dynasty-ppr-sflex", b: "dynasty-ppr-std", inside: 60, gap: 25 }, fakeCtx());
    expect(gap).toBe(
      "Name a player inside the top 60 on today's FF Beacon Dynasty PPR Superflex board who sits at least 25 spots lower on the Dynasty PPR 1QB board.",
    );
    const diff = marketRank.text({ form: "diff", a: "dynasty-ppr-sflex", b: "redraft-ppr-std", inside: 40, outside: 120 }, fakeCtx());
    expect(diff).toContain("but outside the top 120 on the Redraft PPR board.");
    expect(gap).toMatch(ASCII);
  });

  it("offers only formats the default source supports, and skips with fewer than two", () => {
    expect(marketFormats(fakeCtx({ defaultSourceFormats: ["redraft-ppr-std"] }))).toEqual(["redraft-ppr-std"]);
    expect(marketRank.draws(mulberry32(1), fakeCtx({ defaultSourceFormats: ["redraft-ppr-std"] }))).toEqual([]);
    expect(marketRank.draws(mulberry32(1), fakeCtx({ defaultSource: null }))).toEqual([]);
    expect(marketRank.draws(mulberry32(1), fakeCtx()).length).toBeGreaterThan(0);
  });

  it("computes both forms from two rank maps", () => {
    const a = new Map([
      ["x", 10],
      ["y", 30],
      ["z", 70],
    ]);
    const b = new Map([
      ["x", 40],
      ["y", 35],
    ]);
    expect(marketAnswers({ form: "gap", inside: 60, gap: 25 }, a, b)).toEqual(["x"]);
    expect(marketAnswers({ form: "diff", inside: 60, outside: 36 }, a, b)).toEqual(["x"]);
    expect(marketAnswers({ form: "diff", inside: 60, outside: 100 }, a, new Map())).toEqual(["x", "y"]);
  });
});

describe("value_mover", () => {
  it("names the source, the move and the position", () => {
    const ctx = fakeCtx();
    expect(valueMover.text({ direction: "up", window: "7d", move: 10, position: "any" }, ctx)).toBe(
      "Name a player whose FF Beacon dynasty superflex value rose at least 10 percent over the last 7 days.",
    );
    expect(valueMover.text({ direction: "down", window: "30d", move: 15, position: "RB" }, ctx)).toBe(
      "Name a running back whose FF Beacon dynasty superflex value fell at least 15 percent over the last 30 days.",
    );
    expect(valueMover.position!({ position: "any" })).toBeNull();
    expect(valueMover.position!({ position: "RB" })).toBe("RB");
  });

  it("is skipped when the default source does not cover dynasty superflex", () => {
    expect(valueMover.draws(mulberry32(1), fakeCtx({ defaultSourceFormats: ["redraft-ppr-std"] }))).toEqual([]);
  });
});
