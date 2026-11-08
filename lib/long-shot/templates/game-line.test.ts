import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { drawStatSeason } from "./shared";
import { GAME_LINE_THRESHOLDS, gameLine } from "./game-line";
import { OPPONENT_THRESHOLDS, opponentLine } from "./opponent-line";
import { fakeCtx } from "./test-context";

const ASCII = /^[\x20-\x7E]+$/;

describe("game_line text", () => {
  it("builds every threshold at every position", () => {
    const ctx = fakeCtx();
    for (const [position, list] of Object.entries(GAME_LINE_THRESHOLDS)) {
      for (const t of list) {
        const text = gameLine.text({ position, season: 2024, threshold: t.id }, ctx);
        expect(text).toContain(t.phrase);
        expect(text).toContain("in one game in the 2024 season.");
        expect(text).toMatch(ASCII);
      }
    }
  });

  it("says the current season in words", () => {
    const text = gameLine.text({ position: "QB", season: 2026, threshold: "pass_yd_300" }, fakeCtx());
    expect(text).toBe("Name a quarterback who had 300 or more passing yards in one game in the current season.");
  });

  it("draws a valid parameter set", () => {
    const p = gameLine.draw(mulberry32(5), fakeCtx());
    expect(p).not.toBeNull();
    expect(() => gameLine.text(p!, fakeCtx())).not.toThrow();
  });
});

describe("opponent_line text", () => {
  it("builds every threshold with the team name", () => {
    const ctx = fakeCtx();
    for (const [position, list] of Object.entries(OPPONENT_THRESHOLDS)) {
      for (const t of list) {
        const text = opponentLine.text({ position, opponent: "KC", season: 2023, threshold: t.id }, ctx);
        expect(text).toContain(t.phrase);
        expect(text).toContain("Kansas City Chiefs");
        expect(text).toMatch(ASCII);
      }
    }
  });
});

describe("drawStatSeason", () => {
  it("never draws the current season when completedWeek is null", () => {
    const ctx = fakeCtx({ completedWeek: null });
    const rng = mulberry32(11);
    for (let i = 0; i < 200; i++) expect(drawStatSeason(rng, ctx)).not.toBe(2026);
  });

  it("draws the current season sometimes when it has a completed week", () => {
    const ctx = fakeCtx();
    const rng = mulberry32(11);
    const seen = new Set(Array.from({ length: 200 }, () => drawStatSeason(rng, ctx)));
    expect(seen.has(2026)).toBe(true);
  });
});
