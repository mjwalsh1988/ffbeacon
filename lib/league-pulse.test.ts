import { describe, it, expect } from "vitest";
import { orphanRowIds } from "./league-pulse";

/**
 * The rule that keeps our copy of a league the same shape as Sleeper's.
 *
 * Every child write in league-pulse.ts is an upsert, so a team or a member that
 * disappears from Sleeper is never touched again and never leaves. A 16-team
 * league cut to 12 kept four ownerless roster rows, and Power Pulse went on
 * simulating a 16-team bracket against a 12-team schedule.
 */
describe("orphanRowIds", () => {
  const stored = [
    { id: "a", key: 1 },
    { id: "b", key: 2 },
    { id: "c", key: 13 },
    { id: "d", key: 14 },
  ];

  it("returns the rows the payload does not name", () => {
    expect(orphanRowIds(stored, [1, 2])).toEqual(["c", "d"]);
  });

  it("returns nothing when the payload names every stored row", () => {
    expect(orphanRowIds(stored, [1, 2, 13, 14])).toEqual([]);
  });

  it("ignores keys the payload adds that we have not stored yet", () => {
    expect(orphanRowIds(stored, [1, 2, 13, 14, 15])).toEqual([]);
  });

  it("compares a number key and a string key as the same key", () => {
    // Sleeper sends roster ids as numbers and user ids as numeric strings.
    expect(orphanRowIds([{ id: "a", key: 7 }], ["7"])).toEqual([]);
    expect(orphanRowIds([{ id: "a", key: "7" }], [7])).toEqual([]);
  });

  it("treats a null stored key as unmatched", () => {
    expect(orphanRowIds([{ id: "a", key: null }], [1, 2])).toEqual(["a"]);
  });

  /**
   * GUARD. lib/sleeper.ts collapses a failed request into `[]`, so an empty
   * payload means either "Sleeper has no rows" or "Sleeper did not answer" and
   * nothing here can tell those apart. This function will happily call every
   * stored row an orphan when handed an empty list, which is why both callers
   * return early first.
   *
   * If you are reading this because you moved the empty check, put it back. The
   * cost of getting it wrong is deleting a healthy league on one timeout.
   */
  it("would delete everything on an empty payload, which is why callers guard first", () => {
    expect(orphanRowIds(stored, [])).toEqual(["a", "b", "c", "d"]);
  });
});
