import { describe, expect, it } from "vitest";
import {
  canTransitionFulfillment,
  canTransitionPayment,
  disputeChip,
  FULFILLMENT_LABEL,
  paymentChip,
  progressStep,
} from "./transitions";
import type { FulfillmentStatus, PaymentStatus } from "./types";

const PAYMENT: PaymentStatus[] = [
  "unpaid",
  "awaiting_confirmation",
  "paid",
  "expired",
  "cancelled",
  "refunded",
];
const FULFILLMENT: FulfillmentStatus[] = [
  "pending_payment",
  "queued",
  "in_progress",
  "delivered",
  "cancelled",
];

describe("payment transitions", () => {
  const allowed: Record<PaymentStatus, PaymentStatus[]> = {
    unpaid: ["paid", "expired", "cancelled"],
    awaiting_confirmation: ["paid", "expired", "cancelled"],
    expired: ["unpaid", "paid", "cancelled"],
    paid: ["refunded"],
    cancelled: [],
    refunded: [],
  };

  it("pins every allowed and every forbidden move", () => {
    for (const from of PAYMENT) {
      for (const to of PAYMENT) {
        expect(canTransitionPayment(from, to), `${from} to ${to}`).toBe(
          allowed[from].includes(to),
        );
      }
    }
  });

  it("refuses a cancel of a paid order, which is what stops a customer cancelling one", () => {
    expect(canTransitionPayment("paid", "cancelled")).toBe(false);
  });
});

describe("fulfillment transitions", () => {
  const allowed: Record<FulfillmentStatus, FulfillmentStatus[]> = {
    pending_payment: ["queued", "cancelled"],
    queued: ["in_progress", "delivered", "cancelled"],
    in_progress: ["delivered", "queued", "cancelled"],
    delivered: ["in_progress"],
    cancelled: [],
  };

  it("pins every allowed and every forbidden move", () => {
    for (const from of FULFILLMENT) {
      for (const to of FULFILLMENT) {
        expect(canTransitionFulfillment(from, to), `${from} to ${to}`).toBe(
          allowed[from].includes(to),
        );
      }
    }
  });
});

describe("progressStep", () => {
  const states = (payment_status: PaymentStatus, fulfillment_status: FulfillmentStatus) =>
    progressStep({ payment_status, fulfillment_status }).map((s) => s.state);

  it("marks an unpaid order at step two", () => {
    expect(states("unpaid", "pending_payment")).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(states("awaiting_confirmation", "pending_payment")[1]).toBe("current");
  });

  it("marks expired and cancelled as failed at step two", () => {
    expect(states("expired", "pending_payment")[1]).toBe("failed");
    expect(states("cancelled", "cancelled")[1]).toBe("failed");
  });

  it("walks a paid order through the queue to delivery", () => {
    expect(states("paid", "queued")).toEqual(["complete", "complete", "upcoming", "upcoming"]);
    expect(states("paid", "in_progress")).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
    ]);
    expect(states("paid", "delivered")).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
    ]);
  });

  it("crosses the last step only when a refunded order never delivered", () => {
    expect(states("refunded", "cancelled")[3]).toBe("failed");
    expect(states("refunded", "delivered")[3]).toBe("complete");
  });
});

describe("chips", () => {
  it("words a partial refund and keeps the payment status", () => {
    expect(paymentChip({ payment_status: "paid", refunded_cents: 100 }, "customer")).toEqual({
      word: "Paid, partly refunded",
      tone: "warning",
    });
    expect(paymentChip({ payment_status: "paid", refunded_cents: 0 }, "customer").word).toBe(
      "Paid",
    );
  });

  it("reads awaiting confirmation by audience", () => {
    const order = { payment_status: "awaiting_confirmation" as const, refunded_cents: 0 };
    expect(paymentChip(order, "customer").word).toBe("Awaiting your payment");
    expect(paymentChip(order, "admin").word).toBe("Awaiting confirmation");
  });

  it("words every chargeback state and nothing for none", () => {
    expect(disputeChip("open")?.word).toBe("Chargeback open");
    expect(disputeChip("won")?.tone).toBe("positive");
    expect(disputeChip("lost")?.word).toBe("Chargeback lost");
    expect(disputeChip("warning_closed")?.word).toBe("Inquiry closed");
    expect(disputeChip(null)).toBeNull();
  });

  it("names every fulfillment state", () => {
    for (const s of FULFILLMENT) expect(FULFILLMENT_LABEL[s].word.length).toBeGreaterThan(0);
  });
});
