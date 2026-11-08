import { describe, it, expect } from "vitest";
import { addDays, currentEasternGameDate, isConsecutiveDay, isValidGameDate } from "./game-date";

describe("currentEasternGameDate: DST boundaries", () => {
  it("maps 2026-03-08T06:30:00Z (1:30 AM EST, spring-forward night) to 2026-03-08", () => {
    expect(currentEasternGameDate(new Date("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
  });

  it("maps 2026-11-01T05:30:00Z (1:30 AM EDT, just before fall-back) to 2026-11-01", () => {
    expect(currentEasternGameDate(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
  });

  it("EST midnight boundary: 04:59Z stays the prior day, 05:01Z rolls to the new day", () => {
    // America/New_York is EST (UTC-5) in mid-January; local midnight is 05:00Z.
    expect(currentEasternGameDate(new Date("2026-01-15T04:59:00Z"))).toBe("2026-01-14");
    expect(currentEasternGameDate(new Date("2026-01-15T05:01:00Z"))).toBe("2026-01-15");
  });

  it("EDT midnight boundary: 03:59Z stays the prior day, 04:01Z rolls to the new day", () => {
    // America/New_York is EDT (UTC-4) in mid-July; local midnight is 04:00Z.
    expect(currentEasternGameDate(new Date("2026-07-15T03:59:00Z"))).toBe("2026-07-14");
    expect(currentEasternGameDate(new Date("2026-07-15T04:01:00Z"))).toBe("2026-07-15");
  });
});

describe("isConsecutiveDay", () => {
  it("true for adjacent calendar days in a normal month", () => {
    expect(isConsecutiveDay("2026-06-01", "2026-06-02")).toBe(true);
  });

  it("false for the same day", () => {
    expect(isConsecutiveDay("2026-06-02", "2026-06-02")).toBe(false);
  });

  it("false for a gap of more than one day", () => {
    expect(isConsecutiveDay("2026-06-01", "2026-06-03")).toBe(false);
  });

  it("false when next is before prev", () => {
    expect(isConsecutiveDay("2026-06-02", "2026-06-01")).toBe(false);
  });

  it("holds across the spring-forward date pair 2026-03-08 to 2026-03-09", () => {
    expect(isConsecutiveDay("2026-03-08", "2026-03-09")).toBe(true);
  });

  it("holds across the fall-back date pair 2026-10-31 to 2026-11-01", () => {
    expect(isConsecutiveDay("2026-10-31", "2026-11-01")).toBe(true);
  });

  it("holds across a Feb 28 to Mar 1 non-leap-year rollover", () => {
    // 2026 is not a leap year, so February has 28 days.
    expect(isConsecutiveDay("2026-02-28", "2026-03-01")).toBe(true);
  });

  it("holds across a month with 31 days rolling into the next month", () => {
    expect(isConsecutiveDay("2026-07-31", "2026-08-01")).toBe(true);
  });

  it("holds across a year boundary", () => {
    expect(isConsecutiveDay("2026-12-31", "2027-01-01")).toBe(true);
  });
});

describe("addDays", () => {
  it("crosses the spring-forward change", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-03-09", -2)).toBe("2026-03-07");
  });

  it("crosses the fall-back change", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("returns the same date for zero and crosses a year", () => {
    expect(addDays("2026-11-07", 0)).toBe("2026-11-07");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("isValidGameDate", () => {
  it("accepts real calendar dates, a leap day included", () => {
    expect(isValidGameDate("2026-11-08")).toBe(true);
    expect(isValidGameDate("2024-02-29")).toBe(true);
  });

  it("rejects a well-formed string that is not a date", () => {
    expect(isValidGameDate("2026-13-45")).toBe(false);
    expect(isValidGameDate("2026-02-30")).toBe(false);
    expect(isValidGameDate("2025-02-29")).toBe(false);
  });

  it("rejects anything not shaped YYYY-MM-DD", () => {
    expect(isValidGameDate("2026-1-8")).toBe(false);
    expect(isValidGameDate("11/08/2026")).toBe(false);
    expect(isValidGameDate("")).toBe(false);
  });
});
