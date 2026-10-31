import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "./types";

const sendEmail = vi.fn();
vi.mock("@/lib/email/send", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import { markPaidIfWon, receiptTemplate, sendReceipt } from "./orders";
import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";

const ORDER = {
  id: "o1",
  order_number: "FFB-100001",
  user_id: "u1",
  payment_method: "stripe",
  origin: "customer",
  amount_cents: 1995,
  list_price_cents: 1995,
  discount_cents: 0,
  coupon_code: null,
  paid_at: "2026-11-01T12:00:00Z",
  due_at: "2026-11-06T12:00:00Z",
  receipt_email_attempts: 2,
  receipt_email_sent_at: null,
  product_snapshot: { name: "Premium Review", turnaround_days: 5, tier_rank: 2 },
  context: { teamName: "Night Owls", leagueName: "The League" },
  intake: { questions: "" },
} as unknown as Order;

function fakeAdmin(options: { email?: string | null; rpc?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (name: string) => {
    if (name === "try_mark_order_paid") return { data: options.rpc ?? true, error: null };
    return {
      data:
        options.email === null
          ? []
          : [
              {
                user_id: "u1",
                email: options.email ?? "reader@example.com",
                meta_display_name: null,
                created_at: "t",
              },
            ],
      error: null,
    };
  });
  const admin = {
    rpc,
    from: (table: string) => {
      if (table === "order_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            events.push(row);
            return { error: null };
          },
        };
      }
      if (table === "user_preferences") {
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: ORDER, error: null }),
            eq: () => ({ neq: async () => ({ count: 0 }) }),
          }),
        }),
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { admin: admin as never, updates, events, rpc };
}

beforeEach(() => {
  sendEmail.mockReset();
});

describe("sendReceipt", () => {
  it("writes sent and increments attempts", async () => {
    sendEmail.mockResolvedValue({ ok: true, id: "re_1" });
    const fake = fakeAdmin();
    expect(await sendReceipt(fake.admin, "o1")).toBe("sent");
    expect(fake.updates[0]).toMatchObject({
      receipt_email_status: "sent",
      receipt_email_attempts: 3,
      receipt_email_error: null,
    });
    expect(fake.updates[0].receipt_email_sent_at).toEqual(expect.any(String));
    expect(fake.events[0]).toMatchObject({ kind: "email_sent" });
  });

  it("writes failed with the error", async () => {
    sendEmail.mockResolvedValue({ ok: false, skipped: false, error: "Resend error 500" });
    const fake = fakeAdmin();
    expect(await sendReceipt(fake.admin, "o1")).toBe("failed");
    expect(fake.updates[0]).toMatchObject({
      receipt_email_status: "failed",
      receipt_email_attempts: 3,
      receipt_email_error: "Resend error 500",
      receipt_email_sent_at: null,
    });
  });

  it("writes skipped when Resend is not configured", async () => {
    sendEmail.mockResolvedValue({ ok: false, skipped: true });
    const fake = fakeAdmin();
    expect(await sendReceipt(fake.admin, "o1")).toBe("skipped");
    expect(fake.updates[0]).toMatchObject({
      receipt_email_status: "skipped",
      receipt_email_error: "RESEND_API_KEY is not configured",
    });
  });

  it("fails without sending when the account has no address", async () => {
    const fake = fakeAdmin({ email: null });
    expect(await sendReceipt(fake.admin, "o1")).toBe("failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never passes a replyTo to a customer", async () => {
    sendEmail.mockResolvedValue({ ok: true, id: "re_1" });
    await sendReceipt(fakeAdmin().admin, "o1");
    expect((sendEmail.mock.calls[0][0] as { replyTo?: unknown }).replyTo).toBeUndefined();
  });
});

describe("receiptTemplate", () => {
  it("chooses by origin and method", () => {
    expect(receiptTemplate({ origin: "customer", payment_method: "stripe" })).toBe("E1");
    expect(receiptTemplate({ origin: "customer", payment_method: "complimentary" })).toBe("E1");
    expect(receiptTemplate({ origin: "customer", payment_method: "venmo" })).toBe("E3");
    expect(receiptTemplate({ origin: "customer", payment_method: "paypal" })).toBe("E3");
    expect(receiptTemplate({ origin: "admin", payment_method: "complimentary" })).toBe("E13");
  });
});

describe("markPaidIfWon", () => {
  const args = { paidVia: "manual", actor: "admin", title: "Payment confirmed", via: "venmo" } as const;

  it("writes the paid event and hands back the follow-up only when it wins", async () => {
    const fake = fakeAdmin({ rpc: true });
    const result = await markPaidIfWon(fake.admin, { id: "o1" }, DEFAULT_COMMERCE_SETTINGS, args);
    expect(result.won).toBe(true);
    expect(fake.events[0]).toMatchObject({ kind: "paid", title: "Payment confirmed" });
  });

  it("writes nothing and sends nothing when it loses", async () => {
    const fake = fakeAdmin({ rpc: false });
    const result = await markPaidIfWon(fake.admin, { id: "o1" }, DEFAULT_COMMERCE_SETTINGS, args);
    expect(result).toEqual({ won: false, error: null });
    expect(fake.events).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
