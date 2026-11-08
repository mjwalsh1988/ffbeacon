import { describe, expect, it } from "vitest";
import { pickCompletedWeek } from "./completed-week";

describe("pickCompletedWeek", () => {
  it("skips a week at 7 percent of the prior week", () => {
    expect(pickCompletedWeek(9, 151, 2052)).toBe(8);
  });

  it("keeps a week at or above 60 percent", () => {
    expect(pickCompletedWeek(8, 2052, 2067)).toBe(8);
    expect(pickCompletedWeek(8, 1200, 2000)).toBe(8);
  });

  it("skips week 1 under 1,500 rows", () => {
    expect(pickCompletedWeek(1, 1499, 0)).toBeNull();
    expect(pickCompletedWeek(1, 1500, 0)).toBe(1);
  });

  it("returns null with no weeks", () => {
    expect(pickCompletedWeek(null, 0, 0)).toBeNull();
  });
});
