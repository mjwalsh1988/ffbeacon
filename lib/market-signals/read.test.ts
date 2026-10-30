import { describe, expect, it } from "vitest";
import { isSignalCurrent } from "./read";

describe("isSignalCurrent", () => {
  const now = new Date("2026-10-29T15:00:00Z");

  it("keeps a row from today or inside staleDays", () => {
    expect(isSignalCurrent("2026-10-29", 3, now)).toBe(true);
    expect(isSignalCurrent("2026-10-26", 3, now)).toBe(true);
  });

  it("drops a row older than staleDays, so a player a source stopped pricing loses his call", () => {
    expect(isSignalCurrent("2026-10-25", 3, now)).toBe(false);
    expect(isSignalCurrent("2026-09-03", 3, now)).toBe(false);
  });

  it("counts calendar days in UTC, the day the job stamps", () => {
    const lateEastern = new Date("2026-10-30T03:30:00Z");
    expect(isSignalCurrent("2026-10-27", 3, lateEastern)).toBe(true);
    expect(isSignalCurrent("2026-10-26", 3, lateEastern)).toBe(false);
  });
});
