import { describe, expect, it } from "vitest";
import {
  naiveForecasts,
  pearson,
  reliabilityFrom,
  summarize,
  yearOverYear,
} from "./backtest-idp-accuracy";

describe("pearson", () => {
  it("is 1 for a perfect line and -1 for its mirror", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
  });

  it("is null with fewer than three pairs or no spread", () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([3, 3, 3], [1, 2, 3])).toBeNull();
  });
});

describe("naiveForecasts", () => {
  it("averages up to four prior played weeks and needs at least two", () => {
    const out = naiveForecasts([
      { week: 5, points: 10 },
      { week: 1, points: 2 },
      { week: 2, points: 4 },
      { week: 3, points: 6 },
      { week: 4, points: 8 },
      { week: 7, points: 0 },
    ]);
    expect(out.get(1)).toBeNull();
    expect(out.get(2)).toBeNull();
    expect(out.get(3)).toBe(3);
    expect(out.get(5)).toBe(5);
    // A bye in week 6 is skipped: the window is the last four PLAYED weeks.
    expect(out.get(7)).toBe(7);
  });
});

describe("summarize", () => {
  it("flags a projection that loses on both correlation and error", () => {
    const rows = [
      { actual: 2, projected: 9, naive: 3 },
      { actual: 5, projected: 4, naive: 5 },
      { actual: 9, projected: 1, naive: 8 },
    ];
    const s = summarize(rows);
    expect(s?.worseThanNaive).toBe(true);
    expect(s?.naiveMae).toBeCloseTo(2 / 3, 12);
    expect(s?.projectedCloserShare).toBe(0);
  });

  it("does not flag a projection that wins on either measure", () => {
    const s = summarize([
      { actual: 2, projected: 2, naive: 5 },
      { actual: 5, projected: 5, naive: 5.5 },
      { actual: 9, projected: 9, naive: 6 },
    ]);
    expect(s?.worseThanNaive).toBe(false);
    expect(s?.projectedMae).toBe(0);
  });

  it("returns null for no weeks", () => {
    expect(summarize([])).toBeNull();
  });
});

describe("reliabilityFrom", () => {
  it("is the mean floored at zero and rounded to two places, ignoring gaps", () => {
    expect(reliabilityFrom([0.319, 0.276, 0.297, 0.238])).toBe(0.28);
    expect(reliabilityFrom([-0.2, 0.1, null])).toBe(0);
    expect(reliabilityFrom([null])).toBeNull();
  });
});

describe("yearOverYear", () => {
  it("pairs teams present in both seasons only", () => {
    const a = new Map([
      ["NYG", 1.1],
      ["DAL", 0.9],
      ["OAK", 1.2],
      ["MIA", 1.0],
    ]);
    const b = new Map([
      ["NYG", 1.2],
      ["DAL", 0.8],
      ["MIA", 1.0],
      ["LV", 1.1],
    ]);
    const out = yearOverYear(a, b);
    expect(out.teams).toBe(3);
    expect(out.r).toBeCloseTo(1, 12);
  });
});
