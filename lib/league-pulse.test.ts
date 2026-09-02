import { describe, it, expect } from "vitest";
import { orphanRowIds, transactionWeek } from "./league-pulse";

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

describe("transactionWeek", () => {
  it("reads Sleeper's `leg`, which is the field that actually arrives", () => {
    // THE BUG THIS CLOSES. The row was built with `t.week ?? null` and Sleeper
    // sends `leg`, so every one of the 23,847 stored transactions had a null
    // week. That emptied the Transactions page's week filter, left every row
    // without its week, and made the incremental sync resume from week 0 on
    // every single resync instead of from the newest week it already held.
    expect(transactionWeek({ leg: 7 })).toBe(7);
  });

  it("prefers `week` if Sleeper ever populates it", () => {
    expect(transactionWeek({ week: 3, leg: 7 })).toBe(3);
  });

  it("falls through to leg when week is null", () => {
    expect(transactionWeek({ week: null, leg: 7 })).toBe(7);
  });

  it("returns null rather than a zero that would sort ahead of week 1", () => {
    expect(transactionWeek({})).toBeNull();
    expect(transactionWeek({ week: 0, leg: 0 })).toBeNull();
    expect(transactionWeek({ leg: -1 })).toBeNull();
  });
});
