import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, id: "e1" })));
vi.mock("./email/cron-failure-emails", () => ({ sendCronFailureEmail: sendMock }));

import {
  CRON_ALERT_COOLDOWN_HOURS,
  decideAlert,
  maybeAlertCronFailure,
  resetAlertMemoForTests,
} from "./cron-alerts";

/** The one cooldown lookup maybeAlertCronFailure issues, answered with `rows`. */
function lookupClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: string[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    not: (column: string) => {
      calls.push(column);
      return chain;
    },
    limit: () => Promise.resolve(result),
  };
  const client = { from: () => chain } as unknown as Parameters<typeof maybeAlertCronFailure>[0];
  return { client, calls };
}

const args = {
  jobName: "sync-ktc",
  label: "KTC value sync",
  startedAt: "2026-09-29T07:00:00.000Z",
  error: "wrote 0 player_value_history rows",
  partial: false,
  nowMs: Date.parse("2026-09-29T07:00:30.000Z"),
};

describe("decideAlert", () => {
  it("sends on a first failure and holds inside the cooldown", () => {
    expect(decideAlert("sync-ktc", false)).toEqual({ send: true });
    expect(decideAlert("sync-ktc", true).send).toBe(false);
  });

  it("never alerts cron-health on itself, which reports through its digest", () => {
    expect(decideAlert("cron-health", false).send).toBe(false);
  });
});

describe("maybeAlertCronFailure", () => {
  beforeEach(() => {
    resetAlertMemoForTests();
    sendMock.mockClear();
  });

  it("sends and returns the marker time when nothing alerted in the cooldown", async () => {
    const { client, calls } = lookupClient({ data: [], error: null });
    const marked = await maybeAlertCronFailure(client, args);
    expect(marked).toBe("2026-09-29T07:00:30.000Z");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["result->>alertEmailedAt"]);
  });

  it("stays silent when the ledger already holds an alert inside the cooldown", async () => {
    const { client } = lookupClient({ data: [{ id: "earlier" }], error: null });
    expect(await maybeAlertCronFailure(client, args)).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends once per instance per cooldown when the ledger cannot be read", async () => {
    const { client } = lookupClient({ data: null, error: { message: "connection refused" } });
    expect(await maybeAlertCronFailure(client, args)).not.toBeNull();
    expect(await maybeAlertCronFailure(client, { ...args, nowMs: args.nowMs + 60_000 })).toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const later = args.nowMs + (CRON_ALERT_COOLDOWN_HOURS + 1) * 3_600_000;
    expect(await maybeAlertCronFailure(client, { ...args, nowMs: later })).not.toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not start a cooldown when the send itself failed", async () => {
    sendMock.mockResolvedValueOnce({ ok: false, skipped: true } as never);
    const { client } = lookupClient({ data: [], error: null });
    expect(await maybeAlertCronFailure(client, args)).toBeNull();
    expect(await maybeAlertCronFailure(client, args)).not.toBeNull();
  });
});
