import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { marketFormats, marketRank } from "./market-rank";
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

  it("never draws the union with cutoff 24, never the current season, and TE never 24", () => {
    const ctx = fakeCtx();
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const p = seasonFinish.draw(rng, ctx)!;
      if (p.cutoff === 24) expect(p.union).toBe(false);
      if (!p.union) expect(p.season).not.toBe(2026);
      if (p.position === "TE") expect(p.cutoff).not.toBe(24);
    }
  });
});

describe("market_rank", () => {
  it("names the source display name and the format display name", () => {
    const text = marketRank.text({ format: "dynasty-ppr-sflex", cutoff: 50 }, fakeCtx());
    expect(text).toBe("Name a player ranked inside the top 50 on today's FF Beacon Dynasty PPR Superflex board.");
    expect(text).toMatch(ASCII);
  });

  it("draws only formats the default source supports, and skips when none", () => {
    expect(marketFormats(fakeCtx({ defaultSourceFormats: ["redraft-ppr-std"] }))).toEqual(["redraft-ppr-std"]);
    expect(marketRank.draw(mulberry32(1), fakeCtx({ defaultSourceFormats: ["bestball-ppr-std"] }))).toBeNull();
    expect(marketRank.draw(mulberry32(1), fakeCtx({ defaultSource: null }))).toBeNull();
  });
});

describe("value_mover", () => {
  it("names the source and every direction and window", () => {
    const ctx = fakeCtx();
    expect(valueMover.text({ direction: "up", window: "7d" }, ctx)).toBe(
      "Name a player whose FF Beacon dynasty superflex value rose over the last 7 days.",
    );
    expect(valueMover.text({ direction: "down", window: "30d" }, ctx)).toContain("fell over the last 30 days");
  });

  it("is skipped when the default source does not cover dynasty superflex", () => {
    expect(valueMover.draw(mulberry32(1), fakeCtx({ defaultSourceFormats: ["redraft-ppr-std"] }))).toBeNull();
  });
});
