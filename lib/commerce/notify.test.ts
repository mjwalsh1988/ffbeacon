import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "./types";

const sendEmail = vi.hoisted(() =>
  vi.fn(async (_args: unknown) => ({ ok: true as const, id: "re_1" })),
);
const lookupCustomers = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/send", () => ({ sendEmail }));
vi.mock("./customers", () => ({ lookupCustomers, searchCustomers: vi.fn() }));
vi.mock("./orders", () => ({
  readOrder: vi.fn(async () => ORDER),
  loadCustomerHistory: vi.fn(async () => ({ orderCount: 1, openChargebacksElsewhere: 0 })),
}));

import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";
import {
  adminEmailFor,
  notifyDuplicatePayment,
  notifyOrderPaid,
  notifyOrderPlaced,
  notifyPaymentReported,
} from "./notify";

const ORDER = {
  id: "o1",
  order_number: "FFB-100001",
  user_id: "u1",
  payment_method: "venmo",
  amount_cents: 1995,
  discount_cents: 0,
  coupon_code: null,
  due_at: "2026-11-06T12:00:00Z",
  external_payment_reference: null,
  product_snapshot: { name: "Premium Review" },
  context: { teamName: "Night Owls", leagueName: "The League" },
  intake: { questions: "" },
} as unknown as Order;

const admin = {} as never;

type SentArgs = { to: string; replyTo?: string | null };
const lastSend = () => sendEmail.mock.calls.at(-1)?.[0] as SentArgs;

beforeEach(() => {
  sendEmail.mockClear();
  lookupCustomers.mockReset();
  lookupCustomers.mockResolvedValue(
    new Map([["u1", { userId: "u1", email: "reader@example.com", displayName: "Reader" }]]),
  );
});

describe("admin notices", () => {
  it("go to the admin address with reply-to set to the customer", async () => {
    await notifyPaymentReported(admin, ORDER, DEFAULT_COMMERCE_SETTINGS);
    expect(lastSend().to).toBe(DEFAULT_COMMERCE_SETTINGS.notifications.adminEmail);
    expect(lastSend().replyTo).toBe("reader@example.com");
  });

  it("leave reply-to unset when the account has no address", async () => {
    lookupCustomers.mockResolvedValue(new Map());
    await notifyDuplicatePayment(admin, ORDER, DEFAULT_COMMERCE_SETTINGS, {
      firstUrl: "https://dashboard.stripe.com/payments/pi_1",
      secondUrl: "https://dashboard.stripe.com/payments/pi_2",
      amountCents: 1995,
    });
    expect(lastSend().replyTo).toBeUndefined();
  });

  it("respect the switches for A1 and A2 but not for A4", async () => {
    const quiet = {
      ...DEFAULT_COMMERCE_SETTINGS,
      notifications: { ...DEFAULT_COMMERCE_SETTINGS.notifications, notifyOnNew: false, notifyOnPaid: false },
    };
    await notifyOrderPlaced(admin, ORDER, quiet);
    await notifyOrderPaid(admin, ORDER.id, quiet);
    expect(sendEmail).not.toHaveBeenCalled();
    await notifyDuplicatePayment(admin, ORDER, quiet, {
      firstUrl: "a",
      secondUrl: "b",
      amountCents: 1,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("A2 carries the reply-to too", async () => {
    await notifyOrderPaid(admin, ORDER.id, DEFAULT_COMMERCE_SETTINGS);
    expect(lastSend().replyTo).toBe("reader@example.com");
  });
});

describe("adminEmailFor", () => {
  it("prefers the setting, then the environment, then the seller constant", () => {
    const prior = process.env.ADMIN_NOTIFICATION_EMAIL;
    process.env.ADMIN_NOTIFICATION_EMAIL = "env@example.com";
    expect(adminEmailFor(DEFAULT_COMMERCE_SETTINGS)).toBe(
      DEFAULT_COMMERCE_SETTINGS.notifications.adminEmail,
    );
    expect(adminEmailFor(null)).toBe("env@example.com");
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    expect(adminEmailFor(null)).toBe("michael@ffbeacon.com");
    if (prior !== undefined) process.env.ADMIN_NOTIFICATION_EMAIL = prior;
  });
});
