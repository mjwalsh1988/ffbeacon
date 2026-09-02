import { describe, it, expect } from "vitest";
import {
  normalizeIdList,
  weeksToFetch,
  type StoredWeekState,
} from "./league-matchups";

describe("normalizeIdList", () => {
  it("keeps Sleeper's empty-slot placeholder", () => {
    expect(normalizeIdList(["11", "0", "22"])).toEqual(["11", "0", "22"]);
  });

  it("turns a non-string into an empty string instead of removing it", () => {
    expect(normalizeIdList(["11", 22, null, undefined, { id: 3 }])).toEqual([
      "11",
      "",
      "",
      "",
      "",
    ]);
  });

  it("returns an empty array for anything that is not an array", () => {
    expect(normalizeIdList(null)).toEqual([]);
    expect(normalizeIdList(undefined)).toEqual([]);
    expect(normalizeIdList("11,22")).toEqual([]);
    expect(normalizeIdList({ 0: "11" })).toEqual([]);
  });

  it("returns exactly as many entries as it was given", () => {
    for (const input of [[], ["11"], ["11", "0"], ["0", "0", "0", "44"]]) {
      expect(normalizeIdList(input)).toHaveLength(input.length);
    }
  });

  /**
   * GUARD. This is not a duplicate of the first test, it is the reason the
   * first test is allowed to be that boring.
   *
   * `starters` is POSITIONAL: index i is the i-th startable slot of the
   * league's roster_positions, and "0" means the manager left that slot empty.
   * A `.filter(validPlayerId)` here looks like harmless cleanup and it is not:
   * removing the placeholder shifts every player below it up one slot, so the
   * Schedule page renders a lineup nobody set. The array is stored verbatim and
   * every reader filters at read time.
   *
   * If this assertion fails, someone reintroduced the filter. Do not fix the
   * test. Fix the filter, and read lib/league-schedule/lineups.ts on the way.
   */
  it("must not shorten the array: the length IS the slot alignment", () => {
    expect(normalizeIdList(["1", "0", "2"])).toHaveLength(3);
    expect(normalizeIdList(["1", "0", "2"])[2]).toBe("2");
  });
});

describe("weeksToFetch", () => {
  const state = (
    week: number,
    settled: boolean,
    scored: boolean,
  ): StoredWeekState => ({ week, settled, scored });

  it("asks for the whole season when nothing is stored", () => {
    expect(weeksToFetch([], 5, false)).toHaveLength(18);
  });

  it("asks for the whole season on force, however much is stored", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 5, true)).toHaveLength(18);
  });

  it("refreshes the current week and the two ahead of it", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 5, false)).toEqual([5, 6, 7]);
  });

  it("fills a gap in the stored slate", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true)).filter(
      (s) => s.week !== 2,
    );
    expect(weeksToFetch(stored, 10, false)).toEqual([2, 10, 11, 12]);
  });

  it("keeps chasing a past week that has points but has not settled", () => {
    // THE BUG THIS CLOSES. The window used to run forward only, so a week last
    // written mid-Sunday kept its half-played scores forever once Sleeper moved
    // on. Week 3 scored and is not final, so it is asked for again even though
    // it is seven weeks behind.
    const stored = Array.from({ length: 18 }, (_, i) =>
      state(i + 1, i + 1 !== 3, true),
    );
    expect(weeksToFetch(stored, 10, false)).toContain(3);
  });

  it("stops chasing a stale week that never scored, so an abandoned league costs nothing", () => {
    const stored = Array.from({ length: 18 }, (_, i) =>
      state(i + 1, false, false),
    );
    const targets = weeksToFetch(stored, 10, false);
    // The lookback is three weeks, so 7, 8 and 9 are still chased and 6 is not.
    expect(targets).toContain(7);
    expect(targets).not.toContain(6);
    expect(targets).not.toContain(1);
  });

  it("leaves a settled past week alone", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 10, false)).not.toContain(9);
  });
});
