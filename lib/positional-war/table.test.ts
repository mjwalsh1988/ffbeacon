/**
 * Tests for the dashboard row builder, its sort and its filter.
 *
 * The rules worth pinning down are the ones that stop a number being invented:
 * an unowned player is a free agent rather than a blank, a player with no
 * published value is a null rather than a zero, and a null sorts to the bottom
 * whichever way a column points.
 */

import { describe, expect, it } from "vitest";
import {
  buildWarDashboardPositions,
  filterWarRows,
  flattenWarRows,
  ownerLabel,
  sortWarRows,
  type WarOwner,
  type WarTableRow,
} from "./table";
import { buildTierScale } from "./tiers";
import type { PlottableCurve, WarCurvePoint } from "./types";
import type { PulsePosition } from "@/lib/power-pulse/types";

function point(rank: number, war: number, overrides: Partial<WarCurvePoint> = {}): WarCurvePoint {
  return {
    playerId: `player-${rank}`,
    sleeperId: `sleeper-${rank}`,
    slug: `player-${rank}`,
    name: `Player ${rank}`,
    team: "BUF",
    injuryStatus: null,
    positionRank: rank,
    war,
    pointsAboveReplacement: war * 100,
    projectedPointsPerWeek: 10 + war,
    replacementPointsPerWeek: 10,
    weeksProjected: 13,
    ...overrides,
  };
}

function curve(position: PulsePosition, depth: number, demand = 12): PlottableCurve {
  const points: WarCurvePoint[] = [];
  for (let rank = 1; rank <= depth; rank += 1) {
    points.push(
      point(rank, Math.max(0, 2 - rank * 0.05), {
        playerId: `${position}-${rank}`,
        sleeperId: `${position}-s-${rank}`,
        name: `${position} Player ${rank}`,
      }),
    );
  }
  return {
    position,
    structuralDemand: demand,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1: points[0].war,
    warAtDemand: points[demand - 1]?.war ?? null,
    cliffRank: null,
    curve: points,
  };
}

const OWNER_A: WarOwner = { rosterId: 1, manager: "mjwalsh" };
const OWNER_ORPHAN: WarOwner = { rosterId: 7, manager: null };

function build(overrides: Partial<Parameters<typeof buildWarDashboardPositions>[0]> = {}) {
  const curves = [curve("QB", 40), curve("RB", 40, 24)];
  return buildWarDashboardPositions({
    curves,
    maxRank: 36,
    scale: buildTierScale(curves),
    owners: new Map([["QB-s-1", OWNER_A]]),
    values: new Map([["QB-1", 9500]]),
    viewerRosterId: 1,
    ...overrides,
  });
}

describe("buildWarDashboardPositions", () => {
  it("caps every position at maxRank, so the table lists exactly what the chart plots", () => {
    const positions = build();
    for (const position of positions) {
      expect(position.curve.length).toBe(36);
      expect(Math.max(...position.curve.map((r) => r.positionRank))).toBe(36);
    }
  });

  it("honours a shorter cap for the preview", () => {
    const positions = build({ maxRank: 25 });
    expect(positions[0].curve.length).toBe(25);
  });

  it("resolves the owner from the player's Sleeper id and marks the viewer's own", () => {
    const [qb] = build();
    expect(qb.curve[0].owner).toEqual(OWNER_A);
    expect(qb.curve[0].isYours).toBe(true);
    expect(qb.curve[1].owner).toBeNull();
    expect(qb.curve[1].isYours).toBe(false);
  });

  it("does not mark a player as yours when no viewer roster resolved", () => {
    const [qb] = build({ viewerRosterId: null });
    expect(qb.curve[0].owner).toEqual(OWNER_A);
    expect(qb.curve[0].isYours).toBe(false);
  });

  it("carries a null trade value rather than a zero when the source publishes none", () => {
    const [qb] = build();
    expect(qb.curve[0].tradeValue).toBe(9500);
    expect(qb.curve[1].tradeValue).toBeNull();
  });

  it("never matches a curve entry that carries no Sleeper id", () => {
    const nameless = curve("TE", 5);
    nameless.curve[0].sleeperId = null;
    const [te] = buildWarDashboardPositions({
      curves: [nameless],
      maxRank: 36,
      scale: null,
      owners: new Map([["TE-s-1", OWNER_A]]),
      values: new Map(),
      viewerRosterId: 1,
    });
    expect(te.curve[0].owner).toBeNull();
  });

  it("computes wins per week from the weeks he is projected for, not the window's length", () => {
    const short = curve("WR", 3);
    short.curve[0].weeksProjected = 4;
    const [wr] = buildWarDashboardPositions({
      curves: [short],
      maxRank: 36,
      scale: null,
      owners: new Map(),
      values: new Map(),
      viewerRosterId: null,
    });
    expect(wr.curve[0].warPerWeek).toBeCloseTo(wr.curve[0].war / 4, 10);
  });

  it("returns a null wins per week rather than dividing by zero", () => {
    const none = curve("K", 2);
    none.curve[0].weeksProjected = 0;
    const [k] = buildWarDashboardPositions({
      curves: [none],
      maxRank: 36,
      scale: null,
      owners: new Map(),
      values: new Map(),
      viewerRosterId: null,
    });
    expect(k.curve[0].warPerWeek).toBeNull();
  });
});

describe("ownerLabel", () => {
  it("says free agent rather than leaving a blank", () => {
    expect(ownerLabel(null)).toBe("Free agent");
  });

  it("names an orphan roster by its number rather than leaving a blank", () => {
    expect(ownerLabel(OWNER_ORPHAN)).toBe("Team 7");
  });
});

describe("sortWarRows", () => {
  const rows = flattenWarRows(build());

  it("sorts descending by default on wins", () => {
    const sorted = sortWarRows(rows, "war", "desc");
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1].war).toBeGreaterThanOrEqual(sorted[i].war);
    }
  });

  it("puts a missing trade value at the bottom in BOTH directions", () => {
    const desc = sortWarRows(rows, "tradeValue", "desc");
    const asc = sortWarRows(rows, "tradeValue", "asc");
    expect(desc[desc.length - 1].tradeValue).toBeNull();
    expect(asc[asc.length - 1].tradeValue).toBeNull();
    // The one real value leads in descending order and in ascending order
    // alike, because it is the only non-null.
    expect(desc[0].tradeValue).toBe(9500);
    expect(asc[0].tradeValue).toBe(9500);
  });

  it("is stable across repeated calls, so a re-render cannot reshuffle a tie", () => {
    const a = sortWarRows(rows, "war", "desc").map((r) => r.playerId);
    const b = sortWarRows(rows, "war", "desc").map((r) => r.playerId);
    expect(b).toEqual(a);
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.playerId);
    sortWarRows(rows, "tradeValue", "asc");
    expect(rows.map((r) => r.playerId)).toEqual(before);
  });
});

describe("filterWarRows", () => {
  const rows: WarTableRow[] = flattenWarRows(build());

  it("keeps only the active positions", () => {
    const filtered = filterWarRows(rows, new Set<PulsePosition>(["QB"]), "");
    expect(filtered.every((r) => r.position === "QB")).toBe(true);
    expect(filtered.length).toBe(36);
  });

  it("matches a name case-insensitively, as a plain substring", () => {
    const filtered = filterWarRows(rows, new Set<PulsePosition>(["QB", "RB"]), "rb player 1");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((r) => r.name.toLowerCase().includes("rb player 1"))).toBe(true);
  });

  it("returns nothing rather than something adjacent when a search matches nobody", () => {
    expect(filterWarRows(rows, new Set<PulsePosition>(["QB"]), "zzzz")).toEqual([]);
  });

  it("ignores surrounding whitespace in the search", () => {
    const padded = filterWarRows(rows, new Set<PulsePosition>(["QB"]), "  QB Player 2  ");
    const plain = filterWarRows(rows, new Set<PulsePosition>(["QB"]), "QB Player 2");
    expect(padded).toEqual(plain);
  });
});
