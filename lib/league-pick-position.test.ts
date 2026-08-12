import { describe, it, expect } from "vitest";
import {
  positionFromProjectedFinish,
  positionFromDraftSlot,
} from "./league-pick-position";

/** Every finish in a league of N, in order. */
function finishes(teamCount: number): (string | null)[] {
  return Array.from({ length: teamCount }, (_, i) =>
    positionFromProjectedFinish(i + 1, teamCount),
  );
}

function slots(teamCount: number): (string | null)[] {
  return Array.from({ length: teamCount }, (_, i) => positionFromDraftSlot(i + 1, teamCount));
}

describe("positionFromProjectedFinish", () => {
  // The two splits called out when this was specified.
  it("splits a 12-team league 4/4/4", () => {
    expect(finishes(12)).toEqual([
      "late", "late", "late", "late",
      "mid", "mid", "mid", "mid",
      "early", "early", "early", "early",
    ]);
  });

  it("splits a 10-team league 3/3/4, remainder to early", () => {
    expect(finishes(10)).toEqual([
      "late", "late", "late",
      "mid", "mid", "mid",
      "early", "early", "early", "early",
    ]);
  });

  it("scales to other league sizes without hardcoding twelve", () => {
    expect(finishes(8)).toEqual(["late", "late", "mid", "mid", "mid", "early", "early", "early"]);
    expect(finishes(14)).toEqual([
      "late", "late", "late", "late",
      "mid", "mid", "mid", "mid", "mid",
      "early", "early", "early", "early", "early",
    ]);
    // The smallest league that still has thirds.
    expect(finishes(3)).toEqual(["late", "mid", "early"]);
  });

  it("never gives the bottom bucket fewer teams than the top", () => {
    for (let n = 3; n <= 32; n += 1) {
      const split = finishes(n);
      const late = split.filter((p) => p === "late").length;
      const early = split.filter((p) => p === "early").length;
      expect(early).toBeGreaterThanOrEqual(late);
      expect(split.filter((p) => p === null)).toHaveLength(0);
    }
  });

  it("refuses leagues too small to split and finishes out of range", () => {
    expect(positionFromProjectedFinish(1, 2)).toBeNull();
    expect(positionFromProjectedFinish(0, 12)).toBeNull();
    expect(positionFromProjectedFinish(13, 12)).toBeNull();
    expect(positionFromProjectedFinish(1.5, 12)).toBeNull();
  });
});

describe("positionFromDraftSlot", () => {
  // Finishing 1st earns the LAST pick; holding slot 1 IS the first pick. If
  // these two ever stop being mirrors, the same team lands in different buckets
  // depending on which source answered.
  it("is the mirror image of the projected-finish split", () => {
    for (const n of [8, 10, 12, 14]) {
      expect(slots(n)).toEqual([...finishes(n)].reverse());
    }
  });

  it("puts the first pick in the round in the early bucket", () => {
    expect(positionFromDraftSlot(1, 12)).toBe("early");
    expect(positionFromDraftSlot(12, 12)).toBe("late");
  });

  it("refuses slots out of range", () => {
    expect(positionFromDraftSlot(0, 12)).toBeNull();
    expect(positionFromDraftSlot(13, 12)).toBeNull();
    expect(positionFromDraftSlot(1, 0)).toBeNull();
  });
});
