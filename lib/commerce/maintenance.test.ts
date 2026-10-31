import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";

const emailCustomer = vi.hoisted(() => vi.fn(async () => ({ status: "sent" })));
const sendReceipt = vi.hoisted(() => vi.fn(async () => "sent"));
const insertEvent = vi.hoisted(() => vi.fn(async () => {}));
const clearAbandonedUploads = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("./orders", () => ({ emailCustomer, sendReceipt, insertEvent }));
vi.mock("./deliverables", () => ({ clearAbandonedUploads }));
vi.mock("./reconcile", () => ({
  expireStripeOrder: async () => true,
}));

import { runOrderMaintenance } from "./maintenance";

type Row = Record<string, unknown>;
const NOW = new Date("2026-11-10T12:00:00Z");

/** Enough of PostgREST to evaluate the filters this module uses. */
function fakeAdmin(orders: Row[], ledger: Row[] = []) {
  const limits: number[] = [];
  const admin = {
    from(table: string) {
      const rows = table === "orders" ? orders : ledger;
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let remove = false;
      const run = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        if (remove) hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
        return hit;
      };
      const builder = {
        select: () => builder,
        update: (p: Row) => {
          patch = p;
          return builder;
        },
        delete: () => {
          remove = true;
          return builder;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), builder),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), builder),
        lt: (c: string, v: string | number) =>
          (filters.push((r) => r[c] != null && (r[c] as string) < v), builder),
        limit: (n: number) => (limits.push(n), builder),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; count: number; error: null }) => void) => {
          const hit = run();
          resolve({ data: hit, count: hit.length, error: null });
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, limits };
}

const manual = (patch: Row = {}): Row => ({
  id: "o1",
  payment_status: "awaiting_confirmation",
  payment_method: "venmo",
  customer_reported_paid_at: null,
  reminder_sent_at: null,
  created_at: "2026-11-05T12:00:00Z",
  expires_at: "2026-11-12T12:00:00Z",
  ...patch,
});

const run = (admin: never) => runOrderMaintenance(admin, DEFAULT_COMMERCE_SETTINGS, NOW);

beforeEach(() => {
  emailCustomer.mockClear();
  sendReceipt.mockClear();
  insertEvent.mockClear();
  clearAbandonedUploads.mockClear();
});

describe("runOrderMaintenance", () => {
  it("sends the reminder once", async () => {
    const orders = [manual()];
    const { admin } = fakeAdmin(orders);
    expect((await run(admin)).reminders).toBe(1);
    expect(emailCustomer).toHaveBeenCalledWith(admin, expect.anything(), "E6");
    expect((await run(admin)).reminders).toBe(0);
    expect(emailCustomer).toHaveBeenCalledTimes(1);
  });

  it("does not remind before the day", async () => {
    // Placed yesterday: the window closes in six days, the reminder is on day three.
    const { admin } = fakeAdmin([
      manual({ created_at: "2026-11-09T12:00:00Z", expires_at: "2026-11-16T12:00:00Z" }),
    ]);
    expect((await run(admin)).reminders).toBe(0);
  });

  it("keys the reminder on the payment window, not on when the order was placed", async () => {
    // Placed two weeks ago, but Not received restarted the window yesterday, so
    // the reminder waits for day three of the new window.
    const restarted = manual({ created_at: "2026-10-27T12:00:00Z", expires_at: "2026-11-16T12:00:00Z" });
    expect((await run(fakeAdmin([restarted]).admin)).reminders).toBe(0);
  });

  it("stops between rows once the deadline has passed and says so", async () => {
    const orders = [manual({ id: "o1" }), manual({ id: "o2" })];
    const { admin } = fakeAdmin(orders);
    const result = await runOrderMaintenance(admin, DEFAULT_COMMERCE_SETTINGS, NOW, Date.now() - 1);
    expect(result.reminders).toBe(0);
    expect(result.partial).toBe(true);
    expect(emailCustomer).not.toHaveBeenCalled();
  });

  it("writes the visible reminder note only when the email went out", async () => {
    emailCustomer.mockResolvedValueOnce({ status: "failed" } as never);
    const { admin } = fakeAdmin([manual()]);
    expect((await run(admin)).reminders).toBe(1);
    expect(insertEvent).not.toHaveBeenCalledWith(admin, expect.objectContaining({ title: "Reminder email sent" }));
  });

  it("expires an unreported manual order and emails E10", async () => {
    const orders = [manual({ expires_at: "2026-11-09T00:00:00Z", reminder_sent_at: "x" })];
    const { admin } = fakeAdmin(orders);
    expect((await run(admin)).expiredManual).toBe(1);
    expect(orders[0]).toMatchObject({ payment_status: "expired", fulfillment_status: "cancelled" });
    expect(emailCustomer).toHaveBeenCalledWith(admin, expect.anything(), "E10");
  });

  it("never expires a reported order", async () => {
    const orders = [
      manual({ expires_at: "2026-11-09T00:00:00Z", customer_reported_paid_at: "2026-11-06T00:00:00Z" }),
    ];
    const { admin } = fakeAdmin(orders);
    expect((await run(admin)).expiredManual).toBe(0);
    expect(orders[0].payment_status).toBe("awaiting_confirmation");
  });

  it("expires a card order past its time", async () => {
    const { admin } = fakeAdmin([
      { id: "o2", payment_method: "stripe", payment_status: "unpaid", expires_at: "2026-11-09T00:00:00Z" },
    ]);
    expect((await run(admin)).expiredStripe).toBe(1);
  });

  it("retries a receipt inside the cap and after the delay, including skipped", async () => {
    const paid = (patch: Row): Row => ({
      id: "r",
      payment_status: "paid",
      receipt_email_status: "failed",
      receipt_email_attempts: 1,
      paid_at: "2026-11-10T11:00:00Z",
      ...patch,
    });
    const { admin } = fakeAdmin([
      paid({ id: "due" }),
      paid({ id: "skipped", receipt_email_status: "skipped" }),
      paid({ id: "too-soon", paid_at: "2026-11-10T11:55:00Z" }),
      paid({ id: "capped", receipt_email_attempts: 3 }),
      paid({ id: "done", receipt_email_status: "sent" }),
    ]);
    expect((await run(admin)).receiptsRetried).toBe(2);
    expect(sendReceipt.mock.calls.map((c) => (c as unknown as string[])[1])).toEqual(["due", "skipped"]);
  });

  it("clears uploads and prunes the ledger past 90 days", async () => {
    clearAbandonedUploads.mockResolvedValueOnce(2);
    const ledger = [{ received_at: "2026-01-01T00:00:00Z" }, { received_at: "2026-11-01T00:00:00Z" }];
    const { admin } = fakeAdmin([], ledger);
    const result = await run(admin);
    expect(result.uploadsCleared).toBe(2);
    expect(result.eventsPruned).toBe(1);
    expect(ledger).toHaveLength(1);
  });

  it("holds its limits", async () => {
    const { admin, limits } = fakeAdmin([]);
    await run(admin);
    expect(limits).toEqual([50, 100, 100, 50]);
  });

  it("runs every step and reports a failure at the end", async () => {
    clearAbandonedUploads.mockRejectedValueOnce(new Error("storage down"));
    const ledger = [{ received_at: "2026-01-01T00:00:00Z" }];
    const { admin } = fakeAdmin([], ledger);
    await expect(run(admin)).rejects.toThrow("uploads: storage down");
    expect(ledger).toHaveLength(0);
  });
});
