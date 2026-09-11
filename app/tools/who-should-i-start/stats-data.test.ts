import { describe, it, expect } from "vitest";
import { bestIndices, allEmpty } from "./stats-data";

describe("bestIndices", () => {
  it("picks the single highest value for a high-is-better stat", () => {
    expect(bestIndices([10, 25, 5], "high")).toEqual(new Set([1]));
  });

  it("picks the single lowest value for a low-is-better stat", () => {
    expect(bestIndices([3, 1, 2], "low")).toEqual(new Set([1]));
  });

  it("badges every tied cell rather than picking one", () => {
    expect(bestIndices([10, 10, 5], "high")).toEqual(new Set([0, 1]));
  });

  it("never treats a missing value as best", () => {
    expect(bestIndices([null, 5, null], "high")).toEqual(new Set([1]));
  });

  it("returns an empty set when every value is missing", () => {
    expect(bestIndices([null, null, null], "high")).toEqual(new Set());
  });

  it("handles a full N of eight players with a clear winner", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(bestIndices(values, "high")).toEqual(new Set([7]));
  });

  it("treats near-equal floats within tolerance as a tie", () => {
    expect(bestIndices([1.0000000001, 1, 0.5], "high")).toEqual(new Set([0, 1]));
  });
});

describe("allEmpty", () => {
  it("is true when every value is null or zero", () => {
    expect(allEmpty([null, 0, null])).toBe(true);
  });

  it("is false when at least one value is non-zero", () => {
    expect(allEmpty([null, 0, 3])).toBe(false);
  });

  it("is true for an empty array", () => {
    expect(allEmpty([])).toBe(true);
  });
});
