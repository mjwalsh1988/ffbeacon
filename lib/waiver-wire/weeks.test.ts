import { describe, it, expect } from "vitest";
import {
  boardWeeks,
  isPublishableWeek,
  parseWeekSegment,
  weekNeighbours,
  weekPath,
  weekPhase,
  weekPhaseLabel,
} from "./weeks";

describe("boardWeeks", () => {
  it("runs from week 1 to one week past the live week", () => {
    expect(boardWeeks(3)).toEqual([1, 2, 3, 4]);
  });

  it("offers week 1 and 2 in the preseason, so the first board exists before kickoff", () => {
    expect(boardWeeks(1)).toEqual([1, 2]);
  });

  it("never runs past the 18-week regular season", () => {
    expect(boardWeeks(18)).toHaveLength(18);
    expect(boardWeeks(18).at(-1)).toBe(18);
  });

  it("treats a nonsense live week as week 1 rather than producing an empty list", () => {
    expect(boardWeeks(0)).toEqual([1, 2]);
    expect(boardWeeks(-5)).toEqual([1, 2]);
  });
});

describe("isPublishableWeek", () => {
  it("publishes the past, the present and exactly one week ahead", () => {
    expect(isPublishableWeek(2, 5)).toBe(true);
    expect(isPublishableWeek(5, 5)).toBe(true);
    expect(isPublishableWeek(6, 5)).toBe(true);
  });

  it("refuses two weeks ahead, which would be a page of blanks", () => {
    expect(isPublishableWeek(7, 5)).toBe(false);
    expect(isPublishableWeek(18, 5)).toBe(false);
  });

  it("refuses a non-integer week", () => {
    expect(isPublishableWeek(3.5, 10)).toBe(false);
  });
});

describe("parseWeekSegment", () => {
  it("accepts the route's own shape", () => {
    expect(parseWeekSegment("week-4")).toBe(4);
    expect(parseWeekSegment("week-18")).toBe(18);
  });

  it("accepts a bare number from an internal caller", () => {
    expect(parseWeekSegment("7")).toBe(7);
  });

  it("is case and whitespace tolerant", () => {
    expect(parseWeekSegment("  WEEK-9 ")).toBe(9);
  });

  it("refuses anything outside the regular season", () => {
    expect(parseWeekSegment("week-0")).toBeNull();
    expect(parseWeekSegment("week-19")).toBeNull();
    expect(parseWeekSegment("week-99")).toBeNull();
  });

  it("refuses junk rather than guessing a week from it", () => {
    expect(parseWeekSegment("week")).toBeNull();
    expect(parseWeekSegment("week-four")).toBeNull();
    expect(parseWeekSegment("4-week")).toBeNull();
    expect(parseWeekSegment("")).toBeNull();
    expect(parseWeekSegment(undefined)).toBeNull();
    expect(parseWeekSegment(null)).toBeNull();
  });
});

describe("weekPath", () => {
  it("is the canonical URL every link and every canonical tag uses", () => {
    expect(weekPath(4)).toBe("/waiver-wire/week-4");
  });

  it("round-trips through the parser", () => {
    for (let w = 1; w <= 18; w += 1) {
      expect(parseWeekSegment(weekPath(w).split("/").pop())).toBe(w);
    }
  });
});

describe("weekPhase", () => {
  it("names the three tenses the page writes in", () => {
    expect(weekPhase(2, 5)).toBe("past");
    expect(weekPhase(5, 5)).toBe("current");
    expect(weekPhase(6, 5)).toBe("upcoming");
  });
});

describe("weekPhaseLabel", () => {
  it("puts the boundaries where the FAAB market priors put theirs", () => {
    expect(weekPhaseLabel(1)).toBe("Opening week");
    expect(weekPhaseLabel(6)).toBe("Early season");
    expect(weekPhaseLabel(7)).toBe("Midseason");
    expect(weekPhaseLabel(10)).toBe("Midseason");
    expect(weekPhaseLabel(13)).toBe("Playoff push");
    expect(weekPhaseLabel(14)).toBe("Fantasy playoffs");
  });
});

describe("weekNeighbours", () => {
  it("gives both arrows in the middle of the season", () => {
    expect(weekNeighbours(5, 8)).toEqual({ prev: 4, next: 6 });
  });

  it("drops the back arrow on week 1", () => {
    expect(weekNeighbours(1, 8)).toEqual({ prev: null, next: 2 });
  });

  it("drops the forward arrow at the publishable edge rather than linking a dead page", () => {
    expect(weekNeighbours(9, 8)).toEqual({ prev: 8, next: null });
  });

  it("says nothing about a week that is not publishable at all", () => {
    expect(weekNeighbours(15, 8)).toEqual({ prev: null, next: null });
  });
});
