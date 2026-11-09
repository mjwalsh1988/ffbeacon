import { describe, expect, it } from "vitest";
import { mulberry32 } from "../random";
import { statSeasons } from "./shared";
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

  it("offers valid parameter sets that name their position", () => {
    const draws = gameLine.draws(mulberry32(5), fakeCtx());
    expect(draws.length).toBeGreaterThan(0);
    for (const p of draws) {
      expect(() => gameLine.text(p, fakeCtx())).not.toThrow();
      expect(gameLine.position!(p)).toBe(p.position);
    }
  });
});

describe("opponent_line text", () => {
  it("builds every threshold with the team name, in one season or across seasons", () => {
    const ctx = fakeCtx();
    for (const [position, list] of Object.entries(OPPONENT_THRESHOLDS)) {
      for (const t of list) {
        const text = opponentLine.text({ position, opponent: "KC", season: 2023, threshold: t.id }, ctx);
        expect(text).toContain(t.phrase);
        expect(text).toContain("Kansas City Chiefs in the 2023 season.");
        expect(text).toMatch(ASCII);
      }
    }
    expect(opponentLine.text({ position: "RB", opponent: "HOU", season: 0, threshold: "td_1" }, ctx)).toBe(
      "Name a running back who scored a touchdown against the Houston Texans in any season since 2020.",
    );
  });
});

describe("statSeasons", () => {
  it("leaves the current season out until it has a completed week", () => {
    expect(statSeasons(fakeCtx({ completedWeek: null }))).not.toContain(2026);
    expect(statSeasons(fakeCtx())).toContain(2026);
  });
});
