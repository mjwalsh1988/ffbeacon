import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_CLEAR_THRESHOLD,
  CONFIDENCE_LEAN_THRESHOLD,
  callLabelFor,
  computeConfidence,
} from "./confidence";

describe("computeConfidence", () => {
  it("is a coin flip when the two means are equal", () => {
    expect(computeConfidence({ points: 15, sigma: 6 }, { points: 15, sigma: 6 })).toBeCloseTo(0.5, 6);
  });

  it("favors the higher-scoring side", () => {
    const confidence = computeConfidence({ points: 20, sigma: 5 }, { points: 12, sigma: 5 });
    expect(confidence).not.toBeNull();
    expect(confidence as number).toBeGreaterThan(0.7);
  });

  it("is null when the starter side is missing", () => {
    expect(computeConfidence(null, { points: 10, sigma: 4 })).toBeNull();
    expect(computeConfidence(undefined, { points: 10, sigma: 4 })).toBeNull();
  });

  it("is null when the benched side is missing", () => {
    expect(computeConfidence({ points: 10, sigma: 4 }, null)).toBeNull();
    expect(computeConfidence({ points: 10, sigma: 4 }, undefined)).toBeNull();
  });

  it("is null when either points is null", () => {
    expect(computeConfidence({ points: null, sigma: 4 }, { points: 10, sigma: 4 })).toBeNull();
    expect(computeConfidence({ points: 10, sigma: 4 }, { points: null, sigma: 4 })).toBeNull();
  });

  it("is null when either sigma is null", () => {
    expect(computeConfidence({ points: 10, sigma: null }, { points: 8, sigma: 4 })).toBeNull();
    expect(computeConfidence({ points: 10, sigma: 4 }, { points: 8, sigma: null })).toBeNull();
  });
});

describe("callLabelFor", () => {
  it("labels null confidence as unmeasured", () => {
    expect(callLabelFor(null)).toBe("unmeasured");
  });

  it("labels exactly at the clear threshold as clear", () => {
    expect(callLabelFor(CONFIDENCE_CLEAR_THRESHOLD)).toBe("clear");
    expect(callLabelFor(0.65)).toBe("clear");
  });

  it("labels just below the clear threshold as lean", () => {
    expect(callLabelFor(CONFIDENCE_CLEAR_THRESHOLD - 0.0001)).toBe("lean");
    expect(callLabelFor(0.6499)).toBe("lean");
  });

  it("labels exactly at the lean threshold as lean", () => {
    expect(callLabelFor(CONFIDENCE_LEAN_THRESHOLD)).toBe("lean");
    expect(callLabelFor(0.55)).toBe("lean");
  });

  it("labels just below the lean threshold as toss-up", () => {
    expect(callLabelFor(CONFIDENCE_LEAN_THRESHOLD - 0.0001)).toBe("toss-up");
    expect(callLabelFor(0.5499)).toBe("toss-up");
  });

  it("labels a coin flip as toss-up", () => {
    expect(callLabelFor(0.5)).toBe("toss-up");
  });
});
