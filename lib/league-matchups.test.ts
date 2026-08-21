import { describe, it, expect } from "vitest";
import { normalizeIdList } from "./league-matchups";

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
