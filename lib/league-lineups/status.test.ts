import { describe, expect, it } from "vitest";
import { hasLivePoints, weekStatus } from "./status";

describe("hasLivePoints", () => {
  it("is false before anybody scores, which is what Sleeper's row looks like on a Tuesday", () => {
    expect(hasLivePoints(new Map())).toBe(false);
    expect(hasLivePoints(new Map([["a", 0], ["b", 0]]))).toBe(false);
  });

  it("is true as soon as one player has anything", () => {
    expect(hasLivePoints(new Map([["a", 0], ["b", 4.2]]))).toBe(true);
  });

  it("counts a negative score, because a defence having a bad day is still a game being played", () => {
    expect(hasLivePoints(new Map([["def", -2]]))).toBe(true);
  });

  it("ignores a non-finite value rather than reading it as activity", () => {
    expect(hasLivePoints(new Map([["a", Number.NaN]]))).toBe(false);
  });
});

describe("weekStatus", () => {
  it("reports a settled week as final, and turns the advice off", () => {
    const s = weekStatus({ week: 3, currentWeek: 9, isFinal: true, hasLivePoints: true });
    expect(s.phase).toBe("final");
    expect(s.showsResults).toBe(true);
    expect(s.showsAdvice).toBe(false);
  });

  it("reports a week with points on the board as in progress", () => {
    const s = weekStatus({ week: 9, currentWeek: 9, isFinal: false, hasLivePoints: true });
    expect(s.phase).toBe("live");
    expect(s.label).toBe("In progress");
    expect(s.showsResults).toBe(true);
    // The optimiser is graded on projections until a week settles, so a live
    // week must not offer "changes worth making" for games already played.
    expect(s.showsAdvice).toBe(false);
  });

  it("does NOT call the current week live before anybody has scored", () => {
    // Sleeper publishes the row from Tuesday with every score at zero. Four
    // days of a roster showing 0.0 as though those were results is the bug this
    // rule exists to prevent.
    const s = weekStatus({ week: 9, currentWeek: 9, isFinal: false, hasLivePoints: false });
    expect(s.phase).toBe("upcoming");
    expect(s.label).toBe("This week");
    expect(s.showsResults).toBe(false);
    expect(s.showsAdvice).toBe(true);
  });

  it("treats a future week as upcoming and actionable", () => {
    const s = weekStatus({ week: 12, currentWeek: 9, isFinal: false, hasLivePoints: false });
    expect(s.phase).toBe("upcoming");
    expect(s.label).toBe("Upcoming");
    expect(s.showsAdvice).toBe(true);
  });

  it("calls a past week Sleeper never settled unsettled, and offers nothing for it", () => {
    const s = weekStatus({ week: 3, currentWeek: 9, isFinal: false, hasLivePoints: false });
    expect(s.phase).toBe("unsettled");
    // Neither: there is nothing to grade and nothing anybody can do about it.
    expect(s.showsResults).toBe(false);
    expect(s.showsAdvice).toBe(false);
  });

  it("never shows results and advice at the same time", () => {
    for (const week of [1, 8, 9, 10, 18]) {
      for (const isFinal of [true, false]) {
        for (const live of [true, false]) {
          const s = weekStatus({ week, currentWeek: 9, isFinal, hasLivePoints: live });
          expect(s.showsResults && s.showsAdvice).toBe(false);
        }
      }
    }
  });

  it("always produces a label and a sentence", () => {
    for (const week of [1, 9, 18]) {
      for (const isFinal of [true, false]) {
        for (const live of [true, false]) {
          const s = weekStatus({ week, currentWeek: 9, isFinal, hasLivePoints: live });
          expect(s.label.length).toBeGreaterThan(0);
          expect(s.blurb.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
