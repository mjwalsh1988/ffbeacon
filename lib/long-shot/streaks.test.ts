import { describe, expect, it } from "vitest";
import { applyCompletion, displayedStreak } from "./streaks";

const empty = { last_completed_date: null, current_streak: 0, best_streak: 0 };

describe("applyCompletion", () => {
  it("first day is a streak of 1", () => {
    expect(applyCompletion(empty, "2026-11-08")).toEqual({
      last_completed_date: "2026-11-08",
      current_streak: 1,
      best_streak: 1,
    });
  });

  it("a consecutive day extends, across a DST change", () => {
    const prev = { last_completed_date: "2026-10-31", current_streak: 4, best_streak: 4 };
    expect(applyCompletion(prev, "2026-11-01")).toMatchObject({ current_streak: 5, best_streak: 5 });
  });

  it("a gap resets to 1 and keeps the best", () => {
    const prev = { last_completed_date: "2026-11-01", current_streak: 6, best_streak: 9 };
    expect(applyCompletion(prev, "2026-11-08")).toEqual({
      last_completed_date: "2026-11-08",
      current_streak: 1,
      best_streak: 9,
    });
  });

  it("the same day leaves the streak unchanged", () => {
    const prev = { last_completed_date: "2026-11-08", current_streak: 3, best_streak: 3 };
    expect(applyCompletion(prev, "2026-11-08").current_streak).toBe(3);
  });
});

describe("displayedStreak", () => {
  it("shows the streak when the last day is today or yesterday", () => {
    expect(displayedStreak({ last_completed_date: "2026-11-08", current_streak: 3 }, "2026-11-08")).toBe(3);
    expect(displayedStreak({ last_completed_date: "2026-11-07", current_streak: 3 }, "2026-11-08")).toBe(3);
  });

  it("lazily resets an older streak to 0", () => {
    expect(displayedStreak({ last_completed_date: "2026-11-06", current_streak: 3 }, "2026-11-08")).toBe(0);
    expect(displayedStreak(null, "2026-11-08")).toBe(0);
  });
});
