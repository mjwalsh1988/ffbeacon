import { describe, expect, it } from "vitest";
import { dayRange, easternDateKey, monthGrid, monthLabel, monthRange, parseDateKey, parseMonthKey, shiftMonth } from "./calendar";

describe("relay calendar arithmetic", () => {
  it("assigns a late-evening Eastern post to its Eastern day, not its UTC day", () => {
    // 10:30 PM EDT on the 16th is 02:30 UTC on the 17th.
    expect(easternDateKey("2026-09-17T02:30:00Z")).toBe("2026-09-16");
    expect(easternDateKey("2026-09-16T12:00:00Z")).toBe("2026-09-16");
  });

  it("builds September 2026 as five full weeks starting on Sunday the 30th of August", () => {
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toEqual({ key: "2026-08-30", day: 30, inMonth: false });
    expect(grid[0][2]).toEqual({ key: "2026-09-01", day: 1, inMonth: true });
    expect(grid[4][6]).toEqual({ key: "2026-10-03", day: 3, inMonth: false });
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it("bounds a day and a month by Eastern midnight on both sides of a DST change", () => {
    const day = dayRange(2026, 11, 1);
    // EDT midnight on Nov 1 is 04:00 UTC; the clocks go back that morning, so
    // the day is 25 hours long and ends at 05:00 UTC on the 2nd.
    expect(day.start).toBe("2026-11-01T04:00:00.000Z");
    expect(day.end).toBe("2026-11-02T05:00:00.000Z");
    const month = monthRange(2026, 11);
    expect(month.start).toBe("2026-11-01T04:00:00.000Z");
    expect(month.end).toBe("2026-12-01T05:00:00.000Z");
  });

  it("parses and refuses month and date keys from the address", () => {
    expect(parseMonthKey("2026-09")).toEqual({ year: 2026, month: 9 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("sept")).toBeNull();
    expect(parseDateKey("2026-09-31")).toBeNull();
    expect(parseDateKey("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it("shifts across a year boundary and labels the month", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthLabel(2026, 9)).toBe("September 2026");
  });
});
