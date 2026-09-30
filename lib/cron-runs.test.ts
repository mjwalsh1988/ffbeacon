import { describe, it, expect, vi } from "vitest";

const alertMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock("./cron-alerts", () => ({
  ALERT_MARKER_KEY: "alertEmailedAt",
  maybeAlertCronFailure: alertMock,
}));

import {
  CRON_JOBS,
  CronTimeBudgetError,
  describeCronSchedule,
  failedStepsOf,
  recordCronRun,
  withTimeBudget,
} from "./cron-runs";

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

describe("failedStepsOf", () => {
  it("reads a non-empty failedSteps list and ignores anything else", () => {
    expect(failedStepsOf({ failedSteps: ["defenseSplits: timeout"] })).toEqual(["defenseSplits: timeout"]);
    expect(failedStepsOf({ failedSteps: [] })).toEqual([]);
    expect(failedStepsOf({ failedSteps: "nope" })).toEqual([]);
    expect(failedStepsOf({ ok: true })).toEqual([]);
    expect(failedStepsOf(null)).toEqual([]);
  });
});

describe("withTimeBudget", () => {
  it("passes a result through when the work beats the budget", async () => {
    await expect(withTimeBudget(Promise.resolve(7), 1_000, "job")).resolves.toBe(7);
  });

  it("rejects with CronTimeBudgetError when the work runs long", async () => {
    const never = new Promise<number>(() => {});
    await expect(withTimeBudget(never, 20, "job")).rejects.toBeInstanceOf(CronTimeBudgetError);
  });
});

/**
 * A stand-in for the admin client that records every cron_runs write, enough
 * for recordCronRun's insert, select-id and update calls.
 */
function ledgerClient() {
  const writes: Array<{ op: "insert" | "update"; payload: Record<string, unknown> }> = [];
  const client = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        writes.push({ op: "insert", payload });
        const done = Promise.resolve({ data: { id: "run-1" }, error: null });
        return Object.assign(done, {
          select: () => ({ single: () => Promise.resolve({ data: { id: "run-1" }, error: null }) }),
        });
      },
      update: (payload: Record<string, unknown>) => {
        writes.push({ op: "update", payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  };
  return { client: client as unknown as Parameters<typeof recordCronRun>[0], writes };
}

describe("recordCronRun", () => {
  it("records a run with a failed step as an error, keeps the result, and alerts", async () => {
    alertMock.mockResolvedValueOnce("2026-09-29T09:05:00.000Z");
    const { client, writes } = ledgerClient();
    const result = await recordCronRun(client, "sync-sleeper-stats", async () => ({
      ok: true,
      failedSteps: ["defenseSplits: canceling statement due to statement timeout"],
    }));
    expect(result.failedSteps).toHaveLength(1);
    const final = writes.find((w) => w.op === "update")!.payload;
    expect(final.status).toBe("error");
    expect(String(final.error)).toContain("defenseSplits");
    expect((final.result as Record<string, unknown>).alertEmailedAt).toBe("2026-09-29T09:05:00.000Z");
    expect((final.result as Record<string, unknown>).failedSteps).toBeDefined();
    expect(alertMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ jobName: "sync-sleeper-stats", partial: true }),
    );
  });

  it("records a clean run as a success and sends nothing", async () => {
    alertMock.mockClear();
    const { client, writes } = ledgerClient();
    await recordCronRun(client, "sync-ktc", async () => ({ ok: true, failedSteps: [] }));
    expect(writes.find((w) => w.op === "update")!.payload.status).toBe("success");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("records a blown time budget as an error before rethrowing", async () => {
    alertMock.mockResolvedValueOnce(null);
    const { client, writes } = ledgerClient();
    await expect(
      recordCronRun(client, "beacon-brief-worker", () => new Promise(() => {}), { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(CronTimeBudgetError);
    const final = writes.find((w) => w.op === "update")!.payload;
    expect(final.status).toBe("error");
    expect(String(final.error)).toContain("time budget");
  });

  it("alerts on a failure even on the quiet path", async () => {
    alertMock.mockClear();
    alertMock.mockResolvedValueOnce(null);
    const { client, writes } = ledgerClient();
    await expect(
      recordCronRun(client, "league-sync-worker", async () => {
        throw new Error("boom");
      }, { quietWhen: () => true }),
    ).rejects.toThrow("boom");
    expect(writes[0].payload.status).toBe("error");
    expect(alertMock).toHaveBeenCalledTimes(1);
  });
});
