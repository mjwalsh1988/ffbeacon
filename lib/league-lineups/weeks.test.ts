import { describe, it, expect } from "vitest";
import { buildWeekOptions, clampWeek } from "./weeks";

describe("buildWeekOptions", () => {
  it("uses the stored slate when there is one", () => {
    const options = buildWeekOptions(
      [
        { week: 1, isFinal: true },
        { week: 2, isFinal: true },
        { week: 3, isFinal: false },
      ],
      3,
      15,
    );
    expect(options.map((o) => o.week)).toEqual([1, 2, 3]);
    expect(options[2].isCurrent).toBe(true);
  });

  it("never calls a settled week the current one", () => {
    const options = buildWeekOptions([{ week: 5, isFinal: true }], 5, 15);
    expect(options[0].isCurrent).toBe(false);
    expect(options[0].isFinal).toBe(true);
  });

  it("sorts a slate that came back out of order", () => {
    const options = buildWeekOptions(
      [
        { week: 3, isFinal: false },
        { week: 1, isFinal: true },
        { week: 2, isFinal: true },
      ],
      3,
      15,
    );
    expect(options.map((o) => o.week)).toEqual([1, 2, 3]);
  });

  it("falls back to the regular season when nothing is stored", () => {
    const options = buildWeekOptions([], 1, 15);
    expect(options).toHaveLength(14);
    expect(options[0].week).toBe(1);
    expect(options[13].week).toBe(14);
    expect(options[0].isCurrent).toBe(true);
  });

  it("clamps the fallback to the maximum matchup week", () => {
    const options = buildWeekOptions([], 1, 99);
    expect(options[options.length - 1].week).toBeLessThanOrEqual(18);
  });

  it("still offers week 1 when the playoff week is unusably low", () => {
    const options = buildWeekOptions([], 1, 0);
    expect(options).toHaveLength(1);
    expect(options[0].week).toBe(1);
  });
});

describe("clampWeek", () => {
  const options = buildWeekOptions(
    [
      { week: 1, isFinal: true },
      { week: 2, isFinal: true },
      { week: 3, isFinal: false },
    ],
    3,
    15,
  );

  it("honours a requested week that exists", () => {
    expect(clampWeek(options, 2, 3)).toBe(2);
  });

  it("falls back to the live week when the requested one does not exist", () => {
    expect(clampWeek(options, 12, 3)).toBe(3);
  });

  it("falls back to the first week when the live one is not on the slate either", () => {
    expect(clampWeek(options, 12, 9)).toBe(1);
  });

  it("returns the live week when there are no options at all", () => {
    expect(clampWeek([], null, 7)).toBe(7);
  });

  it("defaults to the live week with no request", () => {
    expect(clampWeek(options, null, 3)).toBe(3);
  });
});
