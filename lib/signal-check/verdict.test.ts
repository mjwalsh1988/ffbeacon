import { describe, it, expect } from "vitest";
import { computeVerdict } from "./verdict";
import { settingsWith } from "./_test-kit";

describe("computeVerdict / margin normalization", () => {
  it("uses margin = abs(A-B)/(A+B) and renders the spec example", () => {
    const v = computeVerdict(110, 100, settingsWith());
    // 10 / 210 = 4.7619... -> 4.8 at precision 1
    expect(v.marginPct).toBe(4.8);
    expect(v.winnerSide).toBe("a");
    expect(v.isNeutral).toBe(false);
    expect(v.label).toBe("Side A wins by 4.8% of total trade value.");
  });

  it("respects margin display precision", () => {
    const v = computeVerdict(110, 100, settingsWith({ marginPrecision: 2 }));
    expect(v.marginPct).toBe(4.76);
  });

  it("returns neutral below the threshold (no winner forced)", () => {
    const v = computeVerdict(101, 100, settingsWith());
    // 1 / 201 = 0.497% < 2.5%
    expect(v.isNeutral).toBe(true);
    expect(v.winnerSide).toBeNull();
    expect(v.label).toBe("Near even");
  });

  it("threshold is applied to the unrounded margin", () => {
    // marginRaw just under 2.5 should still be neutral even if it rounds to 2.5
    const v = computeVerdict(102.49, 100, settingsWith({ marginPrecision: 1 }));
    expect(v.marginRaw).toBeLessThan(2.5);
    expect(v.isNeutral).toBe(true);
  });

  it("treats equal totals as neutral", () => {
    const v = computeVerdict(100, 100, settingsWith());
    expect(v.isNeutral).toBe(true);
    expect(v.winnerSide).toBeNull();
  });

  it("treats a zero-sum trade as neutral without dividing by zero", () => {
    const v = computeVerdict(0, 0, settingsWith());
    expect(v.isNeutral).toBe(true);
    expect(v.marginPct).toBe(0);
  });

  it("flags a blowout at or above the blowout threshold", () => {
    const v = computeVerdict(200, 100, settingsWith());
    // 100 / 300 = 33.3% >= 20%
    expect(v.isBlowout).toBe(true);
    expect(v.winnerSide).toBe("a");
  });

  it("side B can win", () => {
    const v = computeVerdict(100, 140, settingsWith());
    expect(v.winnerSide).toBe("b");
    expect(v.label).toContain("Side B");
  });
});
