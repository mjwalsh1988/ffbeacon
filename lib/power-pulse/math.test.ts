import { describe, it, expect } from "vitest";
import {
  clamp,
  createRng,
  normalCdf,
  normalDraw,
  rankDescending,
  winProbability,
  zScores,
  zToDisplay,
} from "./math";

const DISPLAY = { min: 1, max: 99, sharpness: 1 };

describe("normalCdf", () => {
  it("matches known values of the standard normal", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it("stays inside 0 and 1 at the tails", () => {
    expect(normalCdf(-40)).toBeGreaterThanOrEqual(0);
    expect(normalCdf(40)).toBeLessThanOrEqual(1);
  });
});

describe("winProbability", () => {
  it("is a coin flip between identical teams", () => {
    expect(winProbability(120, 25, 120, 25)).toBeCloseTo(0.5, 6);
  });

  it("favors the higher-scoring team", () => {
    expect(winProbability(140, 25, 110, 25)).toBeGreaterThan(0.7);
  });

  it("gives an underdog better odds when the matchup is volatile", () => {
    const tight = winProbability(110, 5, 130, 5);
    const swingy = winProbability(110, 40, 130, 40);
    expect(swingy).toBeGreaterThan(tight);
  });

  it("is decisive when neither team varies", () => {
    expect(winProbability(120, 0, 110, 0)).toBe(1);
    expect(winProbability(110, 0, 110, 0)).toBe(0.5);
  });
});

describe("zToDisplay", () => {
  it("puts an average team at the middle of the scale", () => {
    expect(zToDisplay(0, DISPLAY)).toBe(50);
  });

  it("puts a clearly best team near the top, not stranded mid-scale", () => {
    // A linear stretch left the best team in a 12-team league around 65, which
    // does not read as a power score. The percentile mapping fixes that.
    const best = zToDisplay(1.1, DISPLAY);
    expect(best).toBeGreaterThan(80);
    expect(best).toBeLessThanOrEqual(99);
  });

  it("puts a clearly worst team near the bottom", () => {
    expect(zToDisplay(-2, DISPLAY)).toBeLessThan(10);
  });

  it("preserves ordering and stays within bounds", () => {
    const scores = [-3, -1, 0, 1, 3].map((z) => zToDisplay(z, DISPLAY));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(99);
    }
  });

  it("spreads the league further as sharpness rises", () => {
    const soft = zToDisplay(1, { ...DISPLAY, sharpness: 0.5 });
    const hard = zToDisplay(1, { ...DISPLAY, sharpness: 2 });
    expect(hard).toBeGreaterThan(soft);
  });
});

describe("zScores", () => {
  it("centers on zero with unit spread", () => {
    const z = zScores([10, 20, 30, 40]);
    const sum = z.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 6);
    expect(z[0]).toBeLessThan(0);
    expect(z[3]).toBeGreaterThan(0);
  });

  it("returns all zeros rather than magnifying noise in a level league", () => {
    expect(zScores([100, 100, 100])).toEqual([0, 0, 0]);
  });
});

describe("rankDescending", () => {
  it("ranks highest first", () => {
    expect(rankDescending([10, 30, 20])).toEqual([3, 1, 2]);
  });

  it("gives ties the same rank and skips the next", () => {
    expect(rankDescending([10, 30, 30, 5])).toEqual([3, 1, 1, 4]);
  });

  it("leaves nulls unranked", () => {
    expect(rankDescending([10, null, 30])).toEqual([2, null, 1]);
  });
});

describe("createRng and normalDraw", () => {
  it("is deterministic for a seed", () => {
    const a = createRng(99);
    const b = createRng(99);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it("draws around the mean and never goes negative", () => {
    const rng = createRng(7);
    const draws = Array.from({ length: 4000 }, () => normalDraw(rng, 120, 25));
    const mean = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(mean).toBeGreaterThan(115);
    expect(mean).toBeLessThan(125);
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
  });

  it("returns the mean when there is no spread", () => {
    expect(normalDraw(createRng(1), 100, 0)).toBe(100);
  });
});

describe("clamp", () => {
  it("bounds a value and rejects non-finite input", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(NaN, 0, 10)).toBe(0);
  });
});
