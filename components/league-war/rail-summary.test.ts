import { describe, expect, it } from "vitest";
import { buildYourBestLine, selectScarcestAndDeepest } from "./selection";
import type { PositionCurve } from "@/lib/positional-war/types";

function curve(overrides: Partial<PositionCurve> & { position: PositionCurve["position"] }): PositionCurve {
  return {
    structuralDemand: 12,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1: 1,
    warAtDemand: 0.1,
    cliffRank: 6,
    curve: [
      {
        playerId: `${overrides.position}-1`,
        sleeperId: `${overrides.position}-1`,
        slug: "p1",
        name: "Player One",
        team: "AAA",
        injuryStatus: null,
        positionRank: 1,
        war: 1,
        pointsAboveReplacement: 10,
        projectedPointsPerWeek: 20,
        replacementPointsPerWeek: 10,
        weeksProjected: 6,
      },
    ],
    weeklyDiagnostics: [],
    ...overrides,
  };
}

describe("selectScarcestAndDeepest", () => {
  it("picks the position with the highest warRank1 as scarcest and lowest as deepest", () => {
    const curves = [
      curve({ position: "QB", warRank1: 0.5 }),
      curve({ position: "RB", warRank1: 1.73 }),
      curve({ position: "K", warRank1: 0.11 }),
    ];
    const { scarcest, deepest } = selectScarcestAndDeepest(curves);
    expect(scarcest?.position).toBe("RB");
    expect(deepest?.position).toBe("K");
  });

  it("breaks a scarcest tie by the smaller cliffRank (steeper wins)", () => {
    const curves = [
      curve({ position: "QB", warRank1: 1.5, cliffRank: 8 }),
      curve({ position: "RB", warRank1: 1.5, cliffRank: 3 }),
    ];
    const { scarcest } = selectScarcestAndDeepest(curves);
    expect(scarcest?.position).toBe("RB");
  });

  it("breaks a deepest tie by the larger cliffRank (flatter wins)", () => {
    const curves = [
      curve({ position: "QB", warRank1: 0.5, cliffRank: 3 }),
      curve({ position: "RB", warRank1: 0.5, cliffRank: 9 }),
      // A third position so scarcest and deepest cannot collapse to one line.
      curve({ position: "WR", warRank1: 2, cliffRank: 5 }),
    ];
    const { deepest } = selectScarcestAndDeepest(curves);
    expect(deepest?.position).toBe("RB");
  });

  it("treats a missing cliffRank as the worst possible tiebreak for scarcest (steeper wins)", () => {
    const withCliff = curve({ position: "QB", warRank1: 1, cliffRank: 4 });
    const noCliff = curve({ position: "RB", warRank1: 1, cliffRank: null });
    const { scarcest } = selectScarcestAndDeepest([withCliff, noCliff]);
    expect(scarcest?.position).toBe("QB");
  });

  it("treats a missing cliffRank as the best possible tiebreak for deepest (flatter wins)", () => {
    const withCliff = curve({ position: "QB", warRank1: 1, cliffRank: 4 });
    const noCliff = curve({ position: "RB", warRank1: 1, cliffRank: null });
    const { deepest } = selectScarcestAndDeepest([withCliff, noCliff]);
    expect(deepest?.position).toBe("RB");
  });

  it("is deterministic across repeated calls on the same data", () => {
    const curves = [
      curve({ position: "QB", warRank1: 0.9, cliffRank: 5 }),
      curve({ position: "RB", warRank1: 0.9, cliffRank: 5 }),
      curve({ position: "WR", warRank1: 1.5, cliffRank: 2 }),
    ];
    const first = selectScarcestAndDeepest(curves);
    const second = selectScarcestAndDeepest([...curves]);
    expect(second.scarcest?.position).toBe(first.scarcest?.position);
    expect(second.deepest?.position).toBe(first.deepest?.position);
  });

  it("renders only the scarcest line when fewer than two positions have a curve", () => {
    const { scarcest, deepest } = selectScarcestAndDeepest([curve({ position: "QB" })]);
    expect(scarcest).not.toBeNull();
    expect(deepest).toBeNull();
  });

  it("collapses to one line when scarcest and deepest resolve to the same position", () => {
    const { scarcest, deepest } = selectScarcestAndDeepest([
      curve({ position: "QB", warRank1: 1, cliffRank: 4 }),
    ]);
    expect(scarcest?.position).toBe("QB");
    expect(deepest).toBeNull();
  });

  it("returns nulls for an empty curve list, and never crashes", () => {
    expect(selectScarcestAndDeepest([])).toEqual({ scarcest: null, deepest: null });
  });

  it("ignores a position with no plotted curve data at all", () => {
    const curves = [curve({ position: "QB", warRank1: 1 }), curve({ position: "RB", curve: [], warRank1: null })];
    const { scarcest, deepest } = selectScarcestAndDeepest(curves);
    expect(scarcest?.position).toBe("QB");
    expect(deepest).toBeNull();
  });
});

describe("buildYourBestLine", () => {
  it("names the viewer's best player when one is matched", () => {
    const line = buildYourBestLine("RB", { positionRank: 6, war: 0.94 }, false);
    expect(line).toBe("Your best RB is RB6, adding 0.94 matchups.");
  });

  it("says the player ranks past the chart's depth when unmatched but rostered at that position", () => {
    const line = buildYourBestLine("RB", null, true);
    expect(line).toBe("Your best RB ranks past this chart's depth.");
  });

  it("omits the line when the viewer has no player at the position at all", () => {
    const line = buildYourBestLine("RB", null, false);
    expect(line).toBeNull();
  });
});
