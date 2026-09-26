import { describe, expect, it } from "vitest";
import {
  addTierBreak,
  breaksFromTiers,
  computeBoardRanks,
  isBoardScope,
  isDefenderScope,
  MAX_TIER_BREAKS,
  moveTierBreak,
  normalizeTierBreaks,
  removeTierBreak,
  scopeDescription,
  shiftLabelsForAddedBreak,
  shiftLabelsForRemovedBreak,
  scopeLabel,
  scopePositions,
  tierForRank,
  tierRanges,
} from "./ranking-boards";

describe("scopes", () => {
  it("accepts the defender scopes and refuses anything else", () => {
    for (const s of ["overall", "QB", "DEF", "DL", "LB", "DB", "defense"]) {
      expect(isBoardScope(s)).toBe(true);
    }
    expect(isBoardScope("IDP")).toBe(false);
    expect(isBoardScope("OL")).toBe(false);
  });

  it("an overall board with defenders is still overall, with a wider pool", () => {
    expect(scopePositions("overall")).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(scopePositions("overall", true)).toEqual([
      "QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB",
    ]);
    expect(scopePositions("defense")).toEqual(["DL", "LB", "DB"]);
    expect(scopePositions("LB")).toEqual(["LB"]);
    expect(scopeLabel("overall", true)).toBe("Overall with IDP");
  });

  it("spells positions out in descriptions", () => {
    expect(scopeDescription("LB")).toBe("Ranks linebackers only.");
    expect(scopeDescription("defense")).toContain("defensive backs");
    expect(isDefenderScope("DB")).toBe(true);
    expect(isDefenderScope("DEF")).toBe(false);
  });
});

describe("tier breaks", () => {
  it("numbers tiers from the top by the lines (the plan's RB example)", () => {
    const breaks = [2, 10];
    expect(tierForRank(breaks, 1)).toBe(1);
    expect(tierForRank(breaks, 2)).toBe(1);
    expect(tierForRank(breaks, 3)).toBe(2);
    expect(tierForRank(breaks, 10)).toBe(2);
    expect(tierForRank(breaks, 11)).toBe(3);
    expect(tierRanges(breaks, 24)).toEqual([
      { tier: 1, start: 1, end: 2 },
      { tier: 2, start: 3, end: 10 },
      { tier: 3, start: 11, end: 24 },
    ]);
  });

  it("a board with no lines is one tier, and an empty board has none", () => {
    expect(tierRanges([], 5)).toEqual([{ tier: 1, start: 1, end: 5 }]);
    expect(tierRanges([2], 0)).toEqual([]);
  });

  it("normalises: sorted, unique, inside the board, and reports what fell off", () => {
    expect(normalizeTierBreaks([10, 2, 2, 0, -1, 1.5, "x", null], 12)).toEqual({
      breaks: [2, 10],
      removed: [],
    });
    // A line at or past the last rank has nothing below it.
    expect(normalizeTierBreaks([3, 5, 8], 5)).toEqual({ breaks: [3], removed: [5, 8] });
  });

  it("caps the number of lines", () => {
    const many = Array.from({ length: 40 }, (_, i) => i + 1);
    const { breaks, removed } = normalizeTierBreaks(many, 100);
    expect(breaks).toHaveLength(MAX_TIER_BREAKS);
    expect(removed).toHaveLength(40 - MAX_TIER_BREAKS);
  });

  it("adds and removes", () => {
    expect(addTierBreak([2], 10, 24)).toEqual([2, 10]);
    expect(addTierBreak([2], 2, 24)).toEqual([2]);
    expect(addTierBreak([2], 24, 24)).toEqual([2]);
    expect(removeTierBreak([2, 10], 2)).toEqual([10]);
  });

  it("moves a line, refusing a move onto another line or off the board", () => {
    expect(moveTierBreak([2, 10], 2, 4, 24)).toEqual([4, 10]);
    expect(moveTierBreak([2, 10], 2, 12, 24)).toEqual([10, 12]);
    expect(moveTierBreak([2, 10], 2, 10, 24)).toBeNull();
    expect(moveTierBreak([2, 10], 2, 24, 24)).toBeNull();
    expect(moveTierBreak([2, 10], 3, 4, 24)).toBeNull();
  });

  it("a break stays at its rank when players move (the rank, not the player, carries it)", () => {
    const breaks = [2];
    // Before: A B | C D E. The reader drags E to the top: E A | B C D.
    const before = ["A", "B", "C", "D", "E"];
    const after = ["E", "A", "B", "C", "D"];
    expect(before.map((_, i) => tierForRank(breaks, i + 1))).toEqual([1, 1, 2, 2, 2]);
    expect(after.indexOf("B") + 1).toBe(3);
    expect(tierForRank(breaks, after.indexOf("B") + 1)).toBe(2);
  });

  it("derives lines from ordered tier numbers, including the step into no tier", () => {
    expect(breaksFromTiers([1, 1, 2, 2, 2, 2, 3, 4, 4])).toEqual([2, 6, 7]);
    expect(breaksFromTiers([1, 1, null, null])).toEqual([2]);
    expect(breaksFromTiers([null, null])).toEqual([]);
    // Out of order keeps every visible boundary.
    expect(breaksFromTiers([1, 3, 2])).toEqual([1, 2]);
  });
});

describe("computeBoardRanks", () => {
  it("ranks overall and within position in board order", () => {
    const ranks = computeBoardRanks([
      { playerId: "a", position: "RB" },
      { playerId: "b", position: "WR" },
      { playerId: "c", position: "RB" },
    ]);
    expect(ranks.get("c")).toEqual({ overall: 3, positionRank: 2 });
  });
});

describe("tier label re-indexing", () => {
  it("adding a line keeps labels on their tiers", () => {
    // Tiers: 1-2 "Elite", 3-10 "Starters", 11-24 "Depth". Split Starters after 6.
    const labels = { "1": "Elite", "2": "Starters", "3": "Depth" };
    expect(shiftLabelsForAddedBreak(labels, [2, 10], 6)).toEqual({
      "1": "Elite",
      "2": "Starters",
      "4": "Depth",
    });
    // A line inside tier 1 pushes everything down.
    expect(shiftLabelsForAddedBreak(labels, [2, 10], 1)).toEqual({
      "1": "Elite",
      "3": "Starters",
      "4": "Depth",
    });
  });

  it("removing a line merges the lower tier into the upper", () => {
    const labels = { "1": "Elite", "2": "Starters", "3": "Depth" };
    expect(shiftLabelsForRemovedBreak(labels, [2, 10], 2)).toEqual({
      "1": "Elite",
      "2": "Depth",
    });
    expect(shiftLabelsForRemovedBreak(labels, [2, 10], 10)).toEqual({
      "1": "Elite",
      "2": "Starters",
    });
    expect(shiftLabelsForRemovedBreak(labels, [2, 10], 7)).toEqual(labels);
  });
});
