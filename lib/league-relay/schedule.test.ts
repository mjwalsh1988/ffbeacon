import { describe, it, expect } from "vitest";
import {
  describeHour,
  describePreviewSchedule,
  describeRecapSchedule,
  easternMoment,
  isPreviewWindow,
  isRecapWindow,
} from "./schedule";

/**
 * The windows have to be EASTERN and they have to be RESOLVED rather than
 * offset. Vercel schedules in UTC and the UTC-to-Eastern offset moves twice a
 * year, so the tests that matter here are the two either side of a daylight
 * saving boundary: a fixed UTC instant that is 11am Eastern in November is 10am
 * Eastern in July, and an admin who asked for 11am would never be told.
 */

describe("easternMoment", () => {
  it("reads a summer instant in EDT, which is UTC-4", () => {
    // 2026-09-02 is a Wednesday. 15:00 UTC is 11:00 EDT.
    const m = easternMoment(new Date("2026-09-02T15:00:00Z"));
    expect(m.date).toBe("2026-09-02");
    expect(m.hour).toBe(11);
    expect(m.weekday).toBe(3);
    expect(m.hourKey).toBe("2026-09-02-11");
  });

  it("reads a winter instant in EST, which is UTC-5", () => {
    // The SAME UTC hour, five months later, is an hour earlier in Eastern.
    // This is the whole reason the schedule is not a UTC cron expression.
    const m = easternMoment(new Date("2026-12-02T15:00:00Z"));
    expect(m.hour).toBe(10);
    expect(m.weekday).toBe(3);
  });

  it("puts a late-evening Eastern instant on the right calendar day", () => {
    // 03:00 UTC on the 3rd is 23:00 EDT on the 2nd. A naive UTC read would file
    // this under Thursday and post a Wednesday preview a day late.
    const m = easternMoment(new Date("2026-09-03T03:00:00Z"));
    expect(m.date).toBe("2026-09-02");
    expect(m.weekday).toBe(3);
    expect(m.hour).toBe(23);
  });

  it("folds midnight to hour 0 rather than 24", () => {
    const m = easternMoment(new Date("2026-09-02T04:00:00Z"));
    expect(m.hour).toBe(0);
    expect(m.hourKey.endsWith("-00")).toBe(true);
  });
});

describe("isPreviewWindow", () => {
  const cfg = { preview_weekday: 3, preview_hour: 11 };

  it("fires on the chosen Eastern weekday and hour", () => {
    expect(isPreviewWindow(new Date("2026-09-02T15:00:00Z"), cfg)).toBe(true);
  });

  it("fires on every tick inside that hour, since the ledger stops the repeats", () => {
    expect(isPreviewWindow(new Date("2026-09-02T15:45:00Z"), cfg)).toBe(true);
  });

  it("does not fire an hour either side", () => {
    expect(isPreviewWindow(new Date("2026-09-02T14:00:00Z"), cfg)).toBe(false);
    expect(isPreviewWindow(new Date("2026-09-02T16:00:00Z"), cfg)).toBe(false);
  });

  it("does not fire on another weekday", () => {
    expect(isPreviewWindow(new Date("2026-09-03T15:00:00Z"), cfg)).toBe(false);
  });

  it("still fires at 11am Eastern in December, when the UTC hour has moved", () => {
    // 16:00 UTC is 11:00 EST. A cron pinned to 15:00 UTC would have missed it.
    expect(isPreviewWindow(new Date("2026-12-02T16:00:00Z"), cfg)).toBe(true);
  });
});

describe("isRecapWindow", () => {
  const cfg = { recap_weekday: 2, recap_start_hour: 11, recap_end_hour: 16 };

  it("covers the whole range on the chosen weekday", () => {
    // 2026-09-01 is a Tuesday.
    expect(isRecapWindow(new Date("2026-09-01T15:00:00Z"), cfg)).toBe(true); // 11am
    expect(isRecapWindow(new Date("2026-09-01T20:00:00Z"), cfg)).toBe(true); // 4pm
  });

  it("is inclusive at both ends", () => {
    expect(isRecapWindow(new Date("2026-09-01T14:59:00Z"), cfg)).toBe(false); // 10:59am
    expect(isRecapWindow(new Date("2026-09-01T21:00:00Z"), cfg)).toBe(false); // 5pm
  });

  it("does not fire on another weekday", () => {
    expect(isRecapWindow(new Date("2026-09-02T15:00:00Z"), cfg)).toBe(false);
  });
});

describe("the admin-panel sentences", () => {
  it("names the hour in plain twelve-hour time", () => {
    expect(describeHour(0)).toBe("12:00 AM");
    expect(describeHour(11)).toBe("11:00 AM");
    expect(describeHour(12)).toBe("12:00 PM");
    expect(describeHour(20)).toBe("8:00 PM");
  });

  it("says plainly when nothing will post", () => {
    expect(
      describePreviewSchedule({
        preview_weekday: 3,
        preview_hour: 11,
        preview_headline: false,
        preview_undercard: false,
      }),
    ).toContain("nothing will post");
  });

  it("says how many recap slots a week has room for", () => {
    expect(
      describeRecapSchedule({ recap_weekday: 2, recap_start_hour: 11, recap_end_hour: 16 }),
    ).toContain("6 games");
  });
});
