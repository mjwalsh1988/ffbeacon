import { describe, expect, it } from "vitest";
import { changedInjuryIds, countChangedForRoster } from "./injury-since-draft";

describe("changedInjuryIds", () => {
  it("finds a player who picked up, lost, or changed a designation", () => {
    const atDraft = { a: null, b: "QUESTIONABLE", c: "OUT", d: null };
    const now = { a: "IR", b: null, c: "QUESTIONABLE", d: null };
    expect(changedInjuryIds(atDraft, now)).toEqual(["a", "b", "c"]);
  });

  it("treats an empty string as healthy and ignores letter case", () => {
    expect(changedInjuryIds({ a: "", b: "Out" }, { a: null, b: "OUT" })).toEqual([]);
  });

  it("leaves out a player we can no longer find rather than counting him", () => {
    expect(changedInjuryIds({ a: null }, {})).toEqual([]);
  });
});

describe("countChangedForRoster", () => {
  const picks = [
    { rosterId: 1, sleeperPlayerId: "a" },
    { rosterId: 1, sleeperPlayerId: "b" },
    { rosterId: 2, sleeperPlayerId: "c" },
    { rosterId: 1, sleeperPlayerId: null },
  ];

  it("counts only the reader's own picks", () => {
    expect(countChangedForRoster(picks, 1, ["a", "c"])).toBe(1);
  });

  it("is null when there is no baseline or no reader roster, so the banner hides", () => {
    expect(countChangedForRoster(picks, 1, null)).toBeNull();
    expect(countChangedForRoster(picks, null, ["a"])).toBeNull();
  });
});
