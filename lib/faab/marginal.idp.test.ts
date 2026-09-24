/**
 * The FAAB swap with the IDP switch (plan IDP-312, R-5): a protected defender
 * is never named as the cut, and a DL/LB free agent can fill an LB slot.
 */

import { describe, expect, it } from "vitest";
import { slotEligibility } from "@/lib/power-pulse/types";
import { computeLineupSwap } from "./marginal";

const ON = slotEligibility(true);

function base() {
  return {
    slots: ["QB", "SUPER_FLEX", "LB"],
    weeks: [5, 6],
    rosterByWeek: new Map([
      [5, [
        { playerId: "qb", position: "QB" as const, points: 20, sigma: 1 },
        { playerId: "lb", position: "LB" as const, points: 0.5, sigma: 1 },
        { playerId: "qb2", position: "QB" as const, points: 8, sigma: 1 },
      ]],
      [6, [
        { playerId: "qb", position: "QB" as const, points: 20, sigma: 1 },
        { playerId: "lb", position: "LB" as const, points: 0.5, sigma: 1 },
        { playerId: "qb2", position: "QB" as const, points: 8, sigma: 1 },
      ]],
    ]),
    candidateByWeek: new Map([
      [5, { points: 9, sigma: 1, opponent: null, opponentMultiplier: 1 }],
      [6, { points: 9, sigma: 1, opponent: null, opponentMultiplier: 1 }],
    ]),
    candidatePlayerId: "edge",
    candidatePosition: "DL" as const,
    candidateEligible: ["DL", "LB"] as ("DL" | "LB")[],
    slotMap: ON,
    rosterMeta: new Map([
      ["qb", { name: "Starter", position: "QB" }],
      ["lb", { name: "Linebacker", position: "LB" }],
      ["qb2", { name: "Backup", position: "QB" }],
    ]),
    mustDrop: true,
    isKeeperLeague: true,
  };
}

describe("computeLineupSwap with the IDP switch", () => {
  it("seats a DL/LB free agent in the LB slot", () => {
    const swap = computeLineupSwap(base());
    // He replaces the half-point linebacker: 8.5 points a week gross.
    expect(swap.pointsPerWeek).toBeCloseTo(8.5, 5);
  });

  it("never names a protected defender as the cut, and says why when he was the cheapest", () => {
    const unguarded = computeLineupSwap(base());
    expect(unguarded.dropCost?.playerId).toBe("lb");

    const guarded = computeLineupSwap({ ...base(), protectedIds: new Set(["lb"]) });
    expect(guarded.dropOptions.map((o) => o.playerId)).not.toContain("lb");
    expect(guarded.dropCost?.playerId).toBe("qb2");
    expect(guarded.dropNote ?? "").toContain("no value source prices defensive players");
  });
});
