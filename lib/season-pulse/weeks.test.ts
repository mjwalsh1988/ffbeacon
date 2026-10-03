import { describe, it, expect } from "vitest";
import {
  isPublishableWeek,
  lastCompletedWeek,
  parseWeekSegment,
  publishedWeeks,
  throughWeek,
  weekPath,
  weekPhase,
} from "./weeks";

describe("weekPath and parseWeekSegment", () => {
  it("round trips every week of the season", () => {
    for (let week = 1; week <= 18; week += 1) {
      expect(parseWeekSegment(weekPath(week).split("/").pop())).toBe(week);
    }
  });

  it("refuses anything that is not exactly week-N", () => {
    for (const bad of ["week-0", "week-19", "week-04", "week-", "4", "week-4x", "Week-4", "", undefined, null]) {
      expect(parseWeekSegment(bad)).toBeNull();
    }
  });
});

describe("isPublishableWeek", () => {
  it("publishes a week once the season reaches it, and not before", () => {
    expect(isPublishableWeek(4, 4)).toBe(true);
    expect(isPublishableWeek(3, 4)).toBe(true);
    expect(isPublishableWeek(5, 4)).toBe(false);
    expect(isPublishableWeek(0, 4)).toBe(false);
  });

  it("stops at week 18 after the regular season", () => {
    expect(isPublishableWeek(18, 19)).toBe(true);
    expect(isPublishableWeek(19, 19)).toBe(false);
  });
});

describe("the clock helpers", () => {
  it("calls a week before the live one played, and the live one live", () => {
    expect(weekPhase(3, 4)).toBe("played");
    expect(weekPhase(4, 4)).toBe("live");
  });

  it("has no completed week in week 1 and eighteen after the season", () => {
    expect(lastCompletedWeek(1)).toBe(0);
    expect(lastCompletedWeek(4)).toBe(3);
    expect(lastCompletedWeek(19)).toBe(18);
  });

  it("reads through the live week and never past week 18", () => {
    expect(throughWeek(4)).toBe(4);
    expect(throughWeek(19)).toBe(18);
  });

  it("lists published weeks newest first", () => {
    expect(publishedWeeks(4)).toEqual([4, 3, 2, 1]);
    expect(publishedWeeks(19)).toHaveLength(18);
  });
});
