import { describe, expect, it } from "vitest";
import { liveWeekFromKickoffs, weekRolloverMs } from "./nfl-week";

describe("weekRolloverMs", () => {
  it("ends a Monday night week at midnight Eastern, daylight time", () => {
    // Monday Sep 28 2026, 8:15 PM EDT.
    expect(weekRolloverMs("2026-09-29T00:15:00Z")).toBe(Date.parse("2026-09-29T04:00:00Z"));
  });

  it("ends a Monday night week at midnight Eastern, standard time", () => {
    // Monday Nov 30 2026, 8:15 PM EST.
    expect(weekRolloverMs("2026-12-01T01:15:00Z")).toBe(Date.parse("2026-12-01T05:00:00Z"));
  });

  it("handles the week the clocks go back", () => {
    // Monday Nov 2 2026, 8:15 PM EST; daylight time ended the Sunday before.
    expect(weekRolloverMs("2026-11-03T01:15:00Z")).toBe(Date.parse("2026-11-03T05:00:00Z"));
  });

  it("crosses a month and a year boundary", () => {
    // Monday Jan 4 2027 game, and a Dec 31 kickoff.
    expect(weekRolloverMs("2027-01-05T01:15:00Z")).toBe(Date.parse("2027-01-05T05:00:00Z"));
    expect(weekRolloverMs("2027-01-01T01:15:00Z")).toBe(Date.parse("2027-01-01T05:00:00Z"));
  });

  it("returns null for an unreadable timestamp", () => {
    expect(weekRolloverMs("not a date")).toBeNull();
  });
});

describe("liveWeekFromKickoffs", () => {
  const lastKickoff = new Map([
    [1, "2026-09-15T00:15:00Z"],
    [2, "2026-09-22T00:15:00Z"],
    [3, "2026-09-29T00:15:00Z"],
    [4, "2026-10-06T00:15:00Z"],
  ]);

  it("keeps week 3 after Thursday's game and through the Sunday slate", () => {
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-09-25T05:00:00Z"))).toBe(3);
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-09-28T03:00:00Z"))).toBe(3);
  });

  it("keeps week 3 through Monday 11:59 PM Eastern and moves at midnight", () => {
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-09-29T03:59:59Z"))).toBe(3);
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-09-29T04:00:00Z"))).toBe(4);
  });

  it("is the first week on the slate before the season starts", () => {
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-08-01T00:00:00Z"))).toBe(1);
  });

  it("is one past the last week once everything has rolled over", () => {
    expect(liveWeekFromKickoffs(lastKickoff, Date.parse("2026-12-01T00:00:00Z"))).toBe(5);
    const full = new Map<number, string>();
    for (let w = 1; w <= 18; w += 1) {
      full.set(w, new Date(Date.parse("2026-09-15T00:15:00Z") + (w - 1) * 7 * 86400000).toISOString());
    }
    expect(liveWeekFromKickoffs(full, Date.parse("2027-02-01T00:00:00Z"))).toBe(19);
  });

  it("refuses to skip a week the calendar has no kickoff for", () => {
    // Week 3 missing: during week 3 the answer must not jump to 4.
    const gap = new Map([
      [1, "2026-09-15T00:15:00Z"],
      [2, "2026-09-22T00:15:00Z"],
      [4, "2026-10-06T00:15:00Z"],
    ]);
    expect(liveWeekFromKickoffs(gap, Date.parse("2026-09-26T12:00:00Z"))).toBeNull();
    // Before the gap the calendar still answers.
    expect(liveWeekFromKickoffs(gap, Date.parse("2026-09-18T12:00:00Z"))).toBe(2);
  });

  it("returns null with no calendar, so the caller falls back", () => {
    expect(liveWeekFromKickoffs(new Map(), Date.now())).toBeNull();
  });
});
