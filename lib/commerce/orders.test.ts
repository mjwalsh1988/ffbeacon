import { describe, expect, it } from "vitest";
import { checkPrice, refundDecision, searchKind, type RefundFields } from "./orders";

describe("checkPrice", () => {
  const base = {
    listPriceCents: 1995,
    discountCents: 0,
    expectedCents: 1995,
    paymentMethod: "stripe" as const,
  };

  it("accepts the price the server computes", () => {
    expect(checkPrice(base)).toEqual({ ok: true, amountCents: 1995, complimentary: false });
  });

  it("refuses a stale expected price, in either direction", () => {
    expect(checkPrice({ ...base, expectedCents: 995 }).ok).toBe(false);
    expect(checkPrice({ ...base, expectedCents: 2995 }).ok).toBe(false);
  });

  it("applies the discount before comparing", () => {
    expect(checkPrice({ ...base, discountCents: 400, expectedCents: 1595 })).toMatchObject({
      ok: true,
      amountCents: 1595,
    });
  });

  it("refuses a zero total with a payment method", () => {
    expect(
      checkPrice({ ...base, discountCents: 1995, expectedCents: 0, paymentMethod: "stripe" }).ok,
    ).toBe(false);
  });

  it("accepts a zero total with method none, as complimentary", () => {
    expect(
      checkPrice({ ...base, discountCents: 1995, expectedCents: 0, paymentMethod: "none" }),
    ).toEqual({ ok: true, amountCents: 0, complimentary: true });
  });

  it("refuses method none on anything above zero", () => {
    expect(checkPrice({ ...base, paymentMethod: "none" }).ok).toBe(false);
  });

  it("never goes below zero", () => {
    expect(
      checkPrice({ ...base, discountCents: 5000, expectedCents: 0, paymentMethod: "none" }),
    ).toMatchObject({ ok: true, amountCents: 0 });
  });
});

describe("refundDecision", () => {
  const paid: RefundFields = {
    amount_cents: 1995,
    refunded_cents: 0,
    payment_status: "paid",
    fulfillment_status: "queued",
  };

  it("records a partial refund and keeps the status", () => {
    expect(refundDecision(paid, 500)).toEqual({
      apply: true,
      deltaCents: 500,
      totalCents: 500,
      full: false,
      paymentStatus: "paid",
      fulfillmentStatus: "queued",
    });
  });

  it("then the rest makes it refunded and cancels unfinished work", () => {
    const after = { ...paid, refunded_cents: 500 };
    expect(refundDecision(after, 1495)).toMatchObject({
      apply: true,
      totalCents: 1995,
      full: true,
      paymentStatus: "refunded",
      fulfillmentStatus: "cancelled",
    });
  });

  it("keeps a delivered order delivered", () => {
    expect(refundDecision({ ...paid, fulfillment_status: "delivered" }, 1995)).toMatchObject({
      fulfillmentStatus: "delivered",
      paymentStatus: "refunded",
    });
  });

  it("writes nothing on a redelivery with the same total", () => {
    const after = { ...paid, refunded_cents: 500 };
    expect(refundDecision(after, 500 - after.refunded_cents)).toEqual({ apply: false });
  });

  it("never passes the amount paid", () => {
    expect(refundDecision({ ...paid, refunded_cents: 1900 }, 500)).toMatchObject({
      deltaCents: 95,
      totalCents: 1995,
    });
    expect(
      refundDecision({ ...paid, refunded_cents: 1995, payment_status: "refunded" }, 100),
    ).toEqual({ apply: false });
  });

  it("refuses an order nothing was paid on", () => {
    expect(refundDecision({ ...paid, payment_status: "unpaid" }, 100)).toEqual({ apply: false });
    expect(refundDecision({ ...paid, payment_status: "cancelled" }, 100)).toEqual({
      apply: false,
    });
  });
});

describe("searchKind", () => {
  it("routes by shape", () => {
    expect(searchKind("FFB-100001")).toBe("order-number");
    expect(searchKind(" ffb-100001 ")).toBe("order-number");
    expect(searchKind("0b7f1c2e-7c1e-4a0e-9f25-0a7e9d6c1b11")).toBe("id");
    expect(searchKind("mjwalsh")).toBe("email");
    expect(searchKind("a")).toBeNull();
  });

  it("does not read a short order number as an order number", () => {
    expect(searchKind("FFB-12")).toBe("email");
  });
});
