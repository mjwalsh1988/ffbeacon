import { describe, expect, it } from "vitest";
import { longDayLabel, puzzleDateLabel, shortWeekday } from "./dates";

describe("game date labels", () => {
  it("names the day in Eastern", () => {
    expect(puzzleDateLabel("2026-11-07")).toBe("Puzzle for Saturday, November 7");
    expect(longDayLabel("2026-11-06")).toBe("Friday, November 6");
    expect(shortWeekday("2026-11-08")).toBe("Sun");
  });

  it("holds across the fall-back date", () => {
    expect(longDayLabel("2026-11-01")).toBe("Sunday, November 1");
  });
});
