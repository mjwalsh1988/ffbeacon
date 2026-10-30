import { describe, expect, it } from "vitest";
import { computeSpotlight } from "./spotlight";

const riser = { playerId: "r", pct: 18.24, delta: 812, windowLabel: "30 days" };
const valuable = { playerId: "v", value: 6412, position: "WR", positionRank: 4 };

describe("computeSpotlight", () => {
  it("prefers the latest settled week's top scorer", () => {
    const s = computeSpotlight({
      week: { playerId: "w", week: 7, points: 24.6, average: 15.1 },
      riser,
      valuable,
    })!;
    expect(s).toMatchObject({
      kind: "week",
      label: "Top scorer, week 7",
      figure: "24.6",
      comparison: "Season average 15.1 a game, plus 9.5.",
    });
  });

  it("says when there is no season average", () => {
    const s = computeSpotlight({ week: { playerId: "w", week: 3, points: 9, average: null }, riser, valuable })!;
    expect(s.comparison).toBe("No season average to compare with yet.");
  });

  it("falls back to the top riser, then the most valuable player", () => {
    expect(computeSpotlight({ week: null, riser, valuable })).toMatchObject({
      kind: "riser",
      figure: "+18.2%",
      comparison: "Up 812 in value over 30 days.",
    });
    expect(computeSpotlight({ week: null, riser: null, valuable })).toMatchObject({
      kind: "value",
      figure: "6,412",
      comparison: "WR4 in this format.",
    });
    expect(computeSpotlight({ week: null, riser: null, valuable: null })).toBeNull();
  });
});
