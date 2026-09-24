import { describe, expect, it } from "vitest";
import { buildDefenderSummary } from "./defender-summary";
import { defenderDepthRole, subPositionLabel, subPositionPhrase } from "./defender-depth";
import { depthRoleLabel } from "../player-profile";

describe("buildDefenderSummary", () => {
  const base = {
    playerName: "Roquan Smith",
    playerSurname: "Smith",
    position: "LB",
    scoringLabel: "Sleeper default IDP scoring",
    lastThreeFinishes: [
      { season: 2025, finish: 1 },
      { season: 2024, finish: 5 },
      { season: 2023, finish: 9 },
    ],
    snapShare: null,
    nextWeek: null,
    projectionEngineDisplay: "Sleeper",
  };

  it("names the finishes, the position in words and the scoring", () => {
    const text = buildDefenderSummary(base)!;
    expect(text).toContain("finished LB1, LB5 and LB9 among linebackers in Sleeper default IDP scoring");
    expect(text).not.toMatch(/value|rank in|trade/i);
  });

  it("adds snap share and the projection, naming scoring and engine", () => {
    const text = buildDefenderSummary({
      ...base,
      snapShare: { season: 2025, pct: 0.9394 },
      nextWeek: { week: 3, points: 12.34 },
    })!;
    expect(text).toContain("94% of team defensive snaps in 2025");
    expect(text).toContain("Smith is projected for 12.3 points in Week 3 in Sleeper default IDP scoring, from Sleeper's projected stat line.");
  });

  it("renders nothing without facts", () => {
    expect(buildDefenderSummary({ ...base, lastThreeFinishes: [] })).toBeNull();
  });
});

describe("defender depth roles (R-24)", () => {
  it("two order-1 players at different sub-positions are both starters", () => {
    expect(depthRoleLabel("LB", 1)).toBe("Starter");
    expect(depthRoleLabel("DB", 1)).toBe("Starter");
    expect(depthRoleLabel("LB", 3)).toBe("Reserve");
    expect(defenderDepthRole(2)).toBe("Backup");
  });

  it("never uses the offensive ladder for a defender", () => {
    for (const order of [1, 2, 3, 4, 5]) {
      expect(["Handcuff", "Dart Throw", "Depth Piece"]).not.toContain(depthRoleLabel("DL", order));
    }
    // Offense unchanged.
    expect(depthRoleLabel("RB", 2)).toBe("Handcuff");
    expect(depthRoleLabel("WR", 4)).toBe("Dart Throw");
  });

  it("spells out sub-positions", () => {
    expect(subPositionLabel("LILB")).toBe("Inside linebacker, left");
    expect(subPositionPhrase("NB")).toBe("nickel back");
    expect(subPositionLabel("XYZ")).toBeNull();
  });
});
