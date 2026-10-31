import { describe, expect, it } from "vitest";
import { amountMatches, canReconcile, paymentIntentIdOf } from "./reconcile";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ORDER = {
  payment_method: "stripe",
  payment_status: "unpaid",
  stripe_session_id: "cs_test_a1b2c3d4e5f6g7h8",
  created_at: "2026-11-04T10:00:00Z",
  stripe_session_expires_at: "2026-11-04T11:00:00Z",
} as const;

describe("canReconcile", () => {
  it("asks Stripe about a fresh unpaid or expired card order with a session", () => {
    expect(canReconcile(ORDER, NOW)).toBe(true);
    expect(canReconcile({ ...ORDER, payment_status: "expired" }, NOW)).toBe(true);
  });

  it("never asks about a manual order, a paid order or an order with no session", () => {
    expect(canReconcile({ ...ORDER, payment_method: "paypal" }, NOW)).toBe(false);
    expect(canReconcile({ ...ORDER, payment_status: "paid" }, NOW)).toBe(false);
    expect(canReconcile({ ...ORDER, payment_status: "cancelled" }, NOW)).toBe(false);
    expect(canReconcile({ ...ORDER, stripe_session_id: null }, NOW)).toBe(false);
  });

  it("measures the window from the current session, not only from the order", () => {
    // Placed five days ago, so the order itself is outside the 48 hour window.
    const placed = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const stale = { ...ORDER, created_at: placed, stripe_session_expires_at: placed };
    expect(canReconcile(stale, NOW)).toBe(false);

    // The reader came back today and opened a fresh card page. That session is
    // what a missed webhook would have reported on, so it is still asked about.
    const reopened = {
      ...ORDER,
      created_at: placed,
      stripe_session_expires_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    };
    expect(canReconcile(reopened, NOW)).toBe(true);
  });

  it("falls back to the order's own age when the session expiry is unknown", () => {
    expect(canReconcile({ ...ORDER, stripe_session_expires_at: null }, NOW)).toBe(true);
    const old = new Date(NOW.getTime() - 3 * DAY).toISOString();
    expect(
      canReconcile({ ...ORDER, created_at: old, stripe_session_expires_at: null }, NOW),
    ).toBe(false);
  });
});

describe("amountMatches", () => {
  it("requires the exact amount in US dollars", () => {
    expect(amountMatches({ amount_cents: 1995 }, { amount_total: 1995, currency: "usd" })).toBe(true);
    expect(amountMatches({ amount_cents: 1995 }, { amount_total: 1995, currency: "USD" })).toBe(true);
    expect(amountMatches({ amount_cents: 1995 }, { amount_total: 1990, currency: "usd" })).toBe(false);
    expect(amountMatches({ amount_cents: 1995 }, { amount_total: 1995, currency: "cad" })).toBe(false);
    expect(amountMatches({ amount_cents: 1995 }, { amount_total: null, currency: "usd" })).toBe(false);
  });
});

describe("paymentIntentIdOf", () => {
  it("reads a string or an expanded object and nothing else", () => {
    expect(paymentIntentIdOf("pi_123")).toBe("pi_123");
    expect(paymentIntentIdOf({ id: "pi_123" })).toBe("pi_123");
    expect(paymentIntentIdOf({ id: 4 })).toBeNull();
    expect(paymentIntentIdOf(null)).toBeNull();
    expect(paymentIntentIdOf(undefined)).toBeNull();
  });
});
