/**
 * The Manager Ledger with the IDP switch (plan IDP-310). The OFF path is pinned
 * by the ledger goldens; this pins that defensive slots grade once it is on.
 */

import { describe, expect, it } from "vitest";
import { gradeWeek, planSlots, type LedgerPlayer } from "./lineup";

const players = new Map<string, LedgerPlayer>([
  ["lb1", { sleeperId: "lb1", name: "Linebacker One", position: "LB" }],
  ["edge", { sleeperId: "edge", name: "Edge Rusher", position: "DL", eligible: ["DL", "LB"] }],
  ["db1", { sleeperId: "db1", name: "Safety One", position: "DB" }],
]);

function week() {
  return {
    week: 3,
    officialPoints: 20,
    starterIds: ["lb1", "db1"],
    playerPoints: new Map([
      ["lb1", 6],
      ["db1", 14],
      ["edge", 12],
    ]),
    opponentPoints: 25,
    ineligibleIds: new Set<string>(),
    startedIds: new Set(["lb1", "db1"]),
  };
}

describe("the ledger with the IDP switch", () => {
  it("off: an LB and DB only league has nothing it can grade", () => {
    const plan = planSlots(["LB", "DB", "BN"]);
    expect(plan.gradableTokens).toEqual([]);
    expect(plan.ungradableTokens).toEqual(["LB", "DB"]);
  });

  it("on: grades the defensive slots, and a DL/LB bench player can take the LB slot", () => {
    const plan = planSlots(["LB", "DB", "BN"], true);
    expect(plan.gradableTokens).toEqual(["LB", "DB"]);
    const graded = gradeWeek(plan, week() as never, players);
    expect(graded.setPoints).toBe(20);
    expect(graded.optimalPoints).toBe(26);
    expect(graded.pointsLeft).toBe(6);
    // Starting him instead would have won a game lost by 5.
    expect(graded.bestLineupOutcome).toBe("win");
    expect(graded.biggestMiss?.inName).toBe("Edge Rusher");
  });
});
