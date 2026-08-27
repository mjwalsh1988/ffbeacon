import { describe, expect, it } from "vitest";
import { matchCurveOwnership, splitUnmatchedOwners } from "./overlay";
import type { PositionCurve, WarCurvePoint } from "@/lib/positional-war/types";

function point(overrides: Partial<WarCurvePoint> & { playerId: string }): WarCurvePoint {
  return {
    sleeperId: overrides.playerId,
    slug: overrides.playerId,
    name: `Player ${overrides.playerId}`,
    team: "AAA",
    injuryStatus: null,
    positionRank: 1,
    war: 1,
    pointsAboveReplacement: 10,
    projectedPointsPerWeek: 15,
    replacementPointsPerWeek: 10,
    weeksProjected: 6,
    ...overrides,
  };
}

function curve(position: PositionCurve["position"], points: WarCurvePoint[]): PositionCurve {
  return {
    position,
    structuralDemand: 2,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1: points[0]?.war ?? null,
    warAtDemand: 0.5,
    cliffRank: null,
    curve: points,
    weeklyDiagnostics: [],
  };
}

describe("matchCurveOwnership", () => {
  it("marks a curve entry whose sleeperId is in the owned set, and no others", () => {
    const rb1 = point({ playerId: "rb1", sleeperId: "sleeper-1", positionRank: 1 });
    const rb2 = point({ playerId: "rb2", sleeperId: "sleeper-2", positionRank: 2 });
    const curves = [curve("RB", [rb1, rb2])];
    const owned = new Set(["sleeper-1"]);

    const result = matchCurveOwnership(curves, owned);
    expect(result.matchedByPosition.get("RB")?.map((p) => p.playerId)).toEqual(["rb1"]);
    expect(result.unmatchedOwnedIds).toEqual([]);
  });

  it("marks IR and taxi players the same as any other owned player, since the caller already unions them in", () => {
    // loadViewerOverlay is responsible for unioning player_ids/reserve_ids/
    // taxi_ids before this function ever sees the set; from here, an IR
    // player's sleeperId is indistinguishable from a starter's.
    const irPlayer = point({ playerId: "rb-ir", sleeperId: "sleeper-ir", positionRank: 4 });
    const curves = [curve("RB", [irPlayer])];
    const owned = new Set(["sleeper-ir"]);

    const result = matchCurveOwnership(curves, owned);
    expect(result.matchedByPosition.get("RB")?.[0].playerId).toBe("rb-ir");
  });

  it("never marks a curve entry with sleeperId: null, and counts the owned id as unmatched", () => {
    const noSleeperId = point({ playerId: "ghost", sleeperId: null, positionRank: 1 });
    const curves = [curve("TE", [noSleeperId])];
    // The owned set holds a real id that happens to match nothing on the
    // curve (the curve's only entry has no sleeperId to match against).
    const owned = new Set(["sleeper-owned-elsewhere"]);

    const result = matchCurveOwnership(curves, owned);
    expect(result.matchedByPosition.has("TE")).toBe(false);
    expect(result.unmatchedOwnedIds).toEqual(["sleeper-owned-elsewhere"]);
  });

  it("reports no matches and no unmatched ids with an empty owned set (byte-identical to no overlay)", () => {
    const curves = [curve("RB", [point({ playerId: "rb1", sleeperId: "sleeper-1" })])];
    const result = matchCurveOwnership(curves, new Set());
    expect(result.matchedByPosition.size).toBe(0);
    expect(result.unmatchedOwnedIds).toEqual([]);
  });

  it("sorts matched entries within a position by ascending positionRank", () => {
    const worse = point({ playerId: "rb2", sleeperId: "s2", positionRank: 6 });
    const better = point({ playerId: "rb1", sleeperId: "s1", positionRank: 2 });
    const curves = [curve("RB", [better, worse])];
    const result = matchCurveOwnership(curves, new Set(["s1", "s2"]));
    expect(result.matchedByPosition.get("RB")?.map((p) => p.playerId)).toEqual(["rb1", "rb2"]);
  });
});

describe("splitUnmatchedOwners", () => {
  it("names a rostered player at a plotted position as ranking past the chart's depth", () => {
    const info = new Map([["sleeper-9", { name: "Deep Bench Guy", position: "RB" }]]);
    const result = splitUnmatchedOwners(["sleeper-9"], info);
    expect(result.pastDepth).toEqual([{ sleeperId: "sleeper-9", name: "Deep Bench Guy", position: "RB" }]);
    expect(result.noProjectionCount).toBe(0);
  });

  it("counts, without naming, a player with no player record at all", () => {
    const result = splitUnmatchedOwners(["sleeper-unknown"], new Map());
    expect(result.pastDepth).toEqual([]);
    expect(result.noProjectionCount).toBe(1);
  });

  it("counts, without naming, a player at a position this chart never plots (an IDP slot)", () => {
    const info = new Map([["sleeper-idp", { name: "Some Linebacker", position: "LB" }]]);
    const result = splitUnmatchedOwners(["sleeper-idp"], info);
    expect(result.pastDepth).toEqual([]);
    expect(result.noProjectionCount).toBe(1);
  });

  it("splits a mixed list so every id lands in exactly one bucket", () => {
    const info = new Map([
      ["sleeper-1", { name: "Deep WR", position: "WR" }],
      ["sleeper-2", { name: "Some Linebacker", position: "LB" }],
    ]);
    const result = splitUnmatchedOwners(["sleeper-1", "sleeper-2", "sleeper-3"], info);
    expect(result.pastDepth.map((p) => p.sleeperId)).toEqual(["sleeper-1"]);
    expect(result.noProjectionCount).toBe(2);
  });
});
