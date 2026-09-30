import { describe, it, expect } from "vitest";
import {
  changedSince,
  idList,
  pickOwnershipKeys,
  rostersChanged,
  type RosterShape,
} from "./league-roster-change";

function shape(overrides: Partial<RosterShape> = {}): RosterShape {
  return {
    sleeperRosterId: 1,
    playerIds: ["a", "b"],
    reserveIds: [],
    taxiIds: [],
    picks: ["2027:1:1>1"],
    ...overrides,
  };
}

describe("rostersChanged", () => {
  it("ignores order within a list", () => {
    expect(rostersChanged([shape()], [shape({ playerIds: ["b", "a"] })])).toBe(false);
  });

  it.each([
    ["a player added", { playerIds: ["a", "b", "c"] }],
    ["a player swapped", { playerIds: ["a", "c"] }],
    ["a player moved to injured reserve", { reserveIds: ["b"] }],
    ["a player moved to the taxi squad", { taxiIds: ["b"] }],
    ["a pick changing hands", { picks: ["2027:1:1>2"] }],
  ])("sees %s", (_label, overrides) => {
    expect(rostersChanged([shape()], [shape(overrides)])).toBe(true);
  });

  it("sees a roster added or removed", () => {
    expect(rostersChanged([shape()], [shape(), shape({ sleeperRosterId: 2 })])).toBe(true);
    expect(rostersChanged([shape(), shape({ sleeperRosterId: 2 })], [shape()])).toBe(true);
    expect(rostersChanged([shape()], [shape({ sleeperRosterId: 3 })])).toBe(true);
  });
});

describe("pickOwnershipKeys and idList", () => {
  it("keys picks on ownership only, so a slot label appearing is not a change", () => {
    const bare = { season: 2027, round: 1, original_roster_id: 1, current_roster_id: 4 };
    expect(pickOwnershipKeys([bare])).toEqual(pickOwnershipKeys([{ ...bare, slot: 4, pick_label: "1.04" }]));
  });

  it("reads anything that is not a list as empty, and drops Sleeper's placeholders", () => {
    expect(pickOwnershipKeys(null)).toEqual([]);
    expect(idList({})).toEqual([]);
    expect(idList(["1", "0", "", 5, "2"])).toEqual(["1", "2"]);
  });
});

describe("changedSince", () => {
  it("is true only for a real change later than the cache row", () => {
    expect(changedSince("2026-09-29T12:00:00Z", "2026-09-29T11:00:00Z")).toBe(true);
    expect(changedSince("2026-09-29T10:00:00Z", "2026-09-29T11:00:00Z")).toBe(false);
    expect(changedSince(null, "2026-09-29T11:00:00Z")).toBe(false);
    expect(changedSince("garbage", "2026-09-29T11:00:00Z")).toBe(false);
  });
});
