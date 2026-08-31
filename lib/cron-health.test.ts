import { describe, it, expect } from "vitest";
import {
  expectationFor,
  retentionDaysFor,
  findMissedJobs,
  isStaleRunning,
  HIGH_FREQUENCY_RETENTION_DAYS,
  STANDARD_RETENTION_DAYS,
  PRUNE_BATCH,
} from "./cron-health";

/** 2026-08-24T18:00:00Z. August, so the seasonal stats sync is in season. */
const AUG = Date.parse("2026-08-24T18:00:00Z");
/** 2026-06-24T18:00:00Z. June, which the stats sync deliberately skips. */
const JUN = Date.parse("2026-06-24T18:00:00Z");

const hoursAgo = (nowMs: number, h: number) =>
  new Date(nowMs - h * 3_600_000).toISOString();

describe("expectationFor", () => {
  it("gives a daily job a day plus grace", () => {
    expect(expectationFor("0 7 * * *", AUG)).toEqual({
      checked: true,
      maxGapHours: 26,
    });
  });

  it("gives per-minute and every-five-minute workers the same short window", () => {
    expect(expectationFor("* * * * *", AUG)).toEqual({ checked: true, maxGapHours: 3 });
    expect(expectationFor("*/5 * * * *", AUG)).toEqual({ checked: true, maxGapHours: 3 });
  });

  it("checks a seasonal job in season and leaves it alone out of season", () => {
    const stats = "0 9 * 1,2,8,9,10,11,12 *";
    expect(expectationFor(stats, AUG).checked).toBe(true);
    const off = expectationFor(stats, JUN);
    expect(off.checked).toBe(false);
    expect(off.checked === false && off.reason).toContain("season");
  });

  it("declines to guess at a schedule it cannot model", () => {
    // Nothing in CRON_JOBS uses these today. Inventing an answer would make the
    // first job that does produce a false alarm on its first quiet day.
    expect(expectationFor("0 7 1 * *", AUG).checked).toBe(false);
    expect(expectationFor("0 7 * * 1", AUG).checked).toBe(false);
    expect(expectationFor("nonsense", AUG).checked).toBe(false);
    expect(expectationFor("", AUG).checked).toBe(false);
  });
});

describe("retentionDaysFor", () => {
  it("keeps a week of the high-frequency workers and a year of everything else", () => {
    expect(retentionDaysFor("* * * * *")).toBe(HIGH_FREQUENCY_RETENTION_DAYS);
    expect(retentionDaysFor("*/5 * * * *")).toBe(HIGH_FREQUENCY_RETENTION_DAYS);
    expect(retentionDaysFor("0 7 * * *")).toBe(STANDARD_RETENTION_DAYS);
    expect(retentionDaysFor("0 9 * 1,2,8 *")).toBe(STANDARD_RETENTION_DAYS);
  });

  it("keeps the long window when it cannot read the schedule", () => {
    expect(retentionDaysFor("garbage")).toBe(STANDARD_RETENTION_DAYS);
  });
});

describe("findMissedJobs", () => {
  const jobs = [
    { name: "sync-ktc", label: "KTC value sync", schedule: "0 7 * * *" },
    { name: "recalculate-beacon", label: "FF Beacon value recalc", schedule: "30 9 * * *" },
    { name: "league-sync-worker", label: "Sync all worker", schedule: "* * * * *" },
  ];

  it("says nothing when everything has run recently", () => {
    const last = new Map([
      ["sync-ktc", hoursAgo(AUG, 11)],
      ["recalculate-beacon", hoursAgo(AUG, 8)],
      ["league-sync-worker", hoursAgo(AUG, 0.1)],
    ]);
    expect(findMissedJobs(jobs, last, AUG)).toEqual([]);
  });

  it("catches the 2026-08-14 shape: a daily job that simply never fired", () => {
    // The real incident. sync-ktc ran, recalculate-beacon did not, and nothing
    // in the ledger said so because a job that never starts writes no row.
    const last = new Map([
      ["sync-ktc", hoursAgo(AUG, 11)],
      ["recalculate-beacon", hoursAgo(AUG, 34)],
      ["league-sync-worker", hoursAgo(AUG, 0.1)],
    ]);
    const misses = findMissedJobs(jobs, last, AUG);
    expect(misses).toHaveLength(1);
    expect(misses[0].name).toBe("recalculate-beacon");
    expect(misses[0].hoursSince).toBeCloseTo(34, 5);
  });

  it("reports a job that has never run at all", () => {
    const misses = findMissedJobs(jobs, new Map(), AUG);
    expect(misses.map((m) => m.name).sort()).toEqual([
      "league-sync-worker",
      "recalculate-beacon",
      "sync-ktc",
    ]);
    expect(misses[0].lastRunAt).toBeNull();
    expect(misses[0].hoursSince).toBeNull();
  });

  it("holds a per-minute worker to a much shorter window than a nightly job", () => {
    const last = new Map([
      ["sync-ktc", hoursAgo(AUG, 11)],
      ["recalculate-beacon", hoursAgo(AUG, 8)],
      ["league-sync-worker", hoursAgo(AUG, 5)],
    ]);
    const misses = findMissedJobs(jobs, last, AUG);
    expect(misses.map((m) => m.name)).toEqual(["league-sync-worker"]);
  });

  it("ignores the job that is doing the checking", () => {
    const withSelf = [
      ...jobs,
      { name: "cron-health", label: "Cron health", schedule: "0 16 * * *" },
    ];
    const misses = findMissedJobs(withSelf, new Map(), AUG, new Set(["cron-health"]));
    expect(misses.map((m) => m.name)).not.toContain("cron-health");
  });
});

describe("isStaleRunning", () => {
  it("leaves a job that is still plausibly working alone", () => {
    expect(isStaleRunning(hoursAgo(AUG, 1), AUG)).toBe(false);
  });

  it("flags a run that never reported a finish", () => {
    expect(isStaleRunning(hoursAgo(AUG, 30), AUG)).toBe(true);
  });

  it("does not flag an unreadable timestamp", () => {
    expect(isStaleRunning("not a date", AUG)).toBe(false);
  });
});

/**
 * The prune batch size is not a taste, it is two hard limits at once, and it
 * shipped violating both. These assertions are the record of what the number
 * has to satisfy so nobody raises it again for throughput.
 */
describe("PRUNE_BATCH", () => {
  it("stays inside PostgREST's 1000-row response cap", () => {
    // Above the cap the select silently returns 1000, the loop reads the short
    // page as the last page, and it breaks after one iteration.
    expect(PRUNE_BATCH).toBeLessThanOrEqual(1000);
  });

  it("keeps the delete's id list inside the 16KB header limit", () => {
    // The delete names its rows by primary key in the query string. A uuid plus
    // its separator costs 39 characters there, measured against production.
    const BYTES_PER_ID = 39;
    const HEADER_LIMIT = 16 * 1024;
    expect(PRUNE_BATCH * BYTES_PER_ID).toBeLessThan(HEADER_LIMIT / 2);
  });

  it("is large enough that a nightly run makes real progress", () => {
    expect(PRUNE_BATCH).toBeGreaterThanOrEqual(100);
  });
});
