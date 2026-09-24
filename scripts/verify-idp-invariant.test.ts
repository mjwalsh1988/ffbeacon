import { describe, expect, it } from "vitest";
import {
  comparable,
  curveReportLines,
  diffPaths,
  isVersionKey,
  plainName,
  sampleEvenly,
} from "./verify-idp-invariant";
import type { PositionCurve } from "../lib/positional-war/types";

describe("comparable", () => {
  it("drops version-named keys at any depth", () => {
    expect(comparable({ modelVersion: "pp-8", a: { cacheModelVersion: "x", b: 1 } })).toEqual({ a: { b: 1 } });
    expect(isVersionKey("model_version")).toBe(true);
    expect(isVersionKey("weeks")).toBe(false);
  });

  it("turns Maps and Sets into sorted arrays so insertion order cannot read as a change", () => {
    const a = new Map([["b", 2], ["a", 1]]);
    const b = new Map([["a", 1], ["b", 2]]);
    expect(comparable(a)).toEqual(comparable(b));
    expect(comparable(new Set([3, 1]))).toEqual([1, 3]);
  });
});

describe("diffPaths", () => {
  it("finds nothing when the only difference is a version string", () => {
    expect(diffPaths({ modelVersion: "a", x: [1, 2] }, { modelVersion: "b", x: [1, 2] })).toEqual([]);
  });

  it("names the path of a changed number, exactly", () => {
    expect(diffPaths({ teams: [{ mean: 100 }] }, { teams: [{ mean: 100.0001 }] })).toEqual([
      "teams[0].mean: 100 -> 100.0001",
    ]);
  });

  it("reports an added key and a changed array length", () => {
    const out = diffPaths({ a: [1] }, { a: [1, 2], b: true });
    expect(out).toContain("a.length: 1 -> 2");
    expect(out).toContain("b: undefined -> true");
  });

  it("stops at the limit", () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = a.map((n) => n + 1);
    expect(diffPaths(a, b, 5)).toHaveLength(5);
  });
});

describe("sampleEvenly", () => {
  it("spreads the sample across the list and keeps the first item", () => {
    expect(sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
  });

  it("returns the whole list when it is shorter than the sample", () => {
    expect(sampleEvenly([1, 2], 20)).toEqual([1, 2]);
    expect(sampleEvenly([1, 2], 0)).toEqual([]);
  });
});

describe("curveReportLines", () => {
  const curve = (position: PositionCurve["position"], warRank1: number): PositionCurve => ({
    position,
    structuralDemand: 12,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1,
    warAtDemand: 0.1,
    cliffRank: null,
    curve: [],
    weeklyDiagnostics: [],
  });

  it("says a position has no curve on the side where it is missing", () => {
    const lines = curveReportLines([curve("QB", 1)], [curve("QB", 1), curve("LB", 0.4)]);
    expect(lines).toEqual([
      "  QB: demand 12, rank 1 1.00, at demand 0.10 | demand 12, rank 1 1.00, at demand 0.10",
      "  LB: no curve | demand 12, rank 1 0.40, at demand 0.10",
    ]);
  });
});

describe("plainName", () => {
  it("turns typographic punctuation in a league name into plain ASCII", () => {
    expect(plainName("It\u2019s A Dynasty \u2014 Folks\u2026")).toBe("It's A Dynasty - Folks...");
    expect(plainName(null)).toBe("(unnamed)");
  });
});
