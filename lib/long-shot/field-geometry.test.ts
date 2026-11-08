import { describe, expect, it } from "vitest";
import {
  CENTER_Y,
  MARKER_R,
  SPREAD,
  TRAIL_HALF,
  fieldStripLabel,
  landingX,
  markerPositions,
  trailPaths,
} from "./field-geometry";

describe("landingX", () => {
  it("maps every tier and a miss", () => {
    expect(landingX("chalk")).toBe(100);
    expect(landingX("field")).toBe(300);
    expect(landingX("deep")).toBe(600);
    expect(landingX("sleeper")).toBe(850);
    expect(landingX("long_shot")).toBe(950);
    expect(landingX(null)).toBe(40);
  });
});

describe("markerPositions", () => {
  it("spreads same-tier markers 36 units apart in prompt order and never overlaps", () => {
    const xs = markerPositions([
      { position: 3, tier: "deep" },
      { position: 1, tier: "deep" },
      { position: 2, tier: "deep" },
    ]);
    expect(xs.get(2)! - xs.get(1)!).toBe(SPREAD);
    expect(xs.get(3)! - xs.get(2)!).toBe(SPREAD);
    expect(xs.get(2)).toBe(600);
    expect(SPREAD).toBeGreaterThanOrEqual(MARKER_R * 2);
  });

  it("never lets markers from different groups overlap", () => {
    const xs = markerPositions([
      { position: 1, tier: null },
      { position: 2, tier: null },
      { position: 3, tier: "chalk" },
      { position: 4, tier: null, pending: true },
      { position: 5, tier: "chalk" },
    ]);
    const sorted = [...xs.values()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(SPREAD);
  });

  it("keeps a crowded end zone and a crowded backfield inside the field", () => {
    const ls = markerPositions([1, 2, 3, 4, 5].map((position) => ({ position, tier: "long_shot" as const })));
    expect(Math.max(...ls.values())).toBeLessThanOrEqual(1000 - MARKER_R);
    const miss = markerPositions([1, 2, 3, 4, 5].map((position) => ({ position, tier: null })));
    expect(Math.min(...miss.values())).toBeGreaterThanOrEqual(MARKER_R);
  });
});

describe("fieldStripLabel", () => {
  it("names every prompt and the total", () => {
    expect(
      fieldStripLabel(
        [
          { position: 1, tier: "chalk" },
          { position: 2, tier: "field" },
          { position: 3, tier: "deep" },
          { position: 4, tier: "sleeper" },
          { position: 5, tier: "long_shot" },
        ],
        285,
      ),
    ).toBe(
      "Your answers on the field: prompt 1 Chalk, prompt 2 Field, prompt 3 Deep, prompt 4 Sleeper, prompt 5 Long Shot. Total 285 points.",
    );
    expect(fieldStripLabel([{ position: 1, tier: null }, { position: 2, tier: null, pending: true }], 0)).toBe(
      "Your answers on the field: prompt 1 Miss, prompt 2 not answered yet. Total 0 points.",
    );
  });
});

describe("trailPaths", () => {
  const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const ys = (d: string) => nums(d).filter((_, i) => i % 2 === 1);

  it("returns two closed paths 28 units tall at the marker, tapering to the tail", () => {
    const { upper, lower } = trailPaths(40, 950);
    expect(upper.trim().endsWith("Z")).toBe(true);
    expect(lower.trim().endsWith("Z")).toBe(true);
    expect(Math.max(...ys(lower)) - Math.min(...ys(upper))).toBe(TRAIL_HALF * 2);
    // The tail is a single point on the center line.
    expect(nums(upper).slice(0, 2)).toEqual([40, CENTER_Y]);
  });

  it("never crosses the center line", () => {
    const { upper, lower } = trailPaths(40, 600);
    expect(ys(upper).every((y) => y <= CENTER_Y)).toBe(true);
    expect(ys(lower).every((y) => y >= CENTER_Y)).toBe(true);
  });
});
