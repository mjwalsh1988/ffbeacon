import { describe, it, expect } from "vitest";
import { CRON_JOBS, describeCronSchedule } from "./cron-runs";

// Two reference instants either side of the daylight-saving boundary.
const SUMMER = Date.UTC(2026, 7, 1); // August, Eastern is EDT (UTC-4)
const WINTER = Date.UTC(2026, 0, 15); // January, Eastern is EST (UTC-5)

describe("describeCronSchedule", () => {
  it("converts a UTC cron hour into Eastern time", () => {
    expect(describeCronSchedule("0 7 * * *", SUMMER)).toBe("Daily, 3:00 AM EDT");
    expect(describeCronSchedule("30 9 * * *", SUMMER)).toBe("Daily, 5:30 AM EDT");
    expect(describeCronSchedule("0 14 * * *", SUMMER)).toBe("Daily, 10:00 AM EDT");
  });

  it("follows daylight saving instead of hardcoding a zone", () => {
    // Same cron, one hour earlier in Eastern terms once the clocks go back.
    // This is the case a hand-written "3:00 AM ET" label gets wrong for roughly
    // half the year.
    expect(describeCronSchedule("0 7 * * *", SUMMER)).toBe("Daily, 3:00 AM EDT");
    expect(describeCronSchedule("0 7 * * *", WINTER)).toBe("Daily, 2:00 AM EST");
  });

  it("keeps a daily job's Eastern time even when it lands on the previous UTC day", () => {
    // 02:00 UTC is the prior evening in Eastern. The job still runs once a day
    // at that Eastern time, so time-of-day alone stays truthful.
    expect(describeCronSchedule("0 2 * * *", SUMMER)).toBe("Daily, 10:00 PM EDT");
  });

  it("names the months when a job does not run year round", () => {
    expect(describeCronSchedule("0 9 * 1,2,8,9,10,11,12 *", SUMMER)).toBe(
      "Daily, 5:00 AM EDT, Jan, Feb, Aug, Sep, Oct, Nov, Dec only",
    );
  });

  it("describes sub-hourly jobs without a time of day", () => {
    expect(describeCronSchedule("* * * * *", SUMMER)).toBe("Every minute");
    expect(describeCronSchedule("*/5 * * * *", SUMMER)).toBe("Every 5 minutes");
    expect(describeCronSchedule("15 * * * *", SUMMER)).toBe("Hourly at :15");
  });

  it("says so plainly when a route has no schedule", () => {
    expect(describeCronSchedule("", SUMMER)).toBe("Not scheduled");
    expect(describeCronSchedule("   ", SUMMER)).toBe("Not scheduled");
  });

  it("falls back to the raw expression rather than inventing a time", () => {
    expect(describeCronSchedule("bogus", SUMMER)).toBe("bogus");
    expect(describeCronSchedule("0 abc * * *", SUMMER)).toBe("0 abc * * *");
  });
});

describe("CRON_JOBS registry", () => {
  it("gives every job a describable schedule", () => {
    for (const job of CRON_JOBS) {
      const described = describeCronSchedule(job.schedule, SUMMER);
      expect(described, `${job.name} produced a raw expression`).not.toBe(job.schedule);
      expect(described.length).toBeGreaterThan(0);
    }
  });

  it("never renders a UTC time in the admin panel", () => {
    for (const job of CRON_JOBS) {
      expect(describeCronSchedule(job.schedule, SUMMER)).not.toMatch(/UTC/);
    }
  });

  it("has one entry per job name, with no duplicates", () => {
    const names = CRON_JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
