import { describe, expect, it, vi } from "vitest";
import { applyDisputeEvent, closedStatus, disputeOutcome } from "./disputes";
import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";
import type { Order } from "./types";

vi.mock("./notify", () => ({
  notifyDisputeOpened: vi.fn(async () => {}),
  notifyDisputeClosed: vi.fn(async () => {}),
  notifyOrderPaid: vi.fn(async () => {}),
}));

const NOW = "2026-11-01T12:00:00.000Z";
const DISPUTE = {
  id: "dp_1",
  amount: 1995,
  payment_intent: "pi_1",
  reason: "fraudulent",
  evidence_details: { due_by: 1_800_000_000 },
};

const ORDER = {
  id: "o1",
  amount_cents: 1995,
  refunded_cents: 0,
  payment_status: "paid",
  fulfillment_status: "queued",
  refund_note: null,
  stripe_payment_intent_id: "pi_1",
  livemode: true,
} as unknown as Order;

function fakeAdmin() {
  const updates: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const admin = {
    from: (table: string) =>
      table === "order_events"
        ? {
            insert: async (row: Record<string, unknown>) => {
              events.push(row);
              return { error: null };
            },
          }
        : {
            update: (row: Record<string, unknown>) => {
              updates.push(row);
              const chain = {
                eq: () => chain,
                select: () => ({ maybeSingle: async () => ({ data: { id: "o1" }, error: null }) }),
                then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
              };
              return chain;
            },
          },
  };
  return { admin: admin as never, updates, events };
}

describe("disputeOutcome", () => {
  it("opens with the columns, an event and a notice", () => {
    const outcome = disputeOutcome("charge.dispute.created", DISPUTE, "primary", NOW);
    expect(outcome.columns).toEqual({
      dispute_id: "dp_1",
      dispute_status: "open",
      disputed_at: NOW,
    });
    expect(outcome.event.kind).toBe("dispute_opened");
    expect(outcome.notify).toBe("opened");
    expect(outcome.refundCents).toBe(0);
  });

  it("writes only an event for funds moving", () => {
    for (const type of [
      "charge.dispute.funds_withdrawn",
      "charge.dispute.funds_reinstated",
    ] as const) {
      const outcome = disputeOutcome(type, DISPUTE, "primary", NOW);
      expect(outcome.columns).toEqual({});
      expect(outcome.notify).toBeNull();
      expect(outcome.event.kind).toBe("dispute_updated");
    }
  });

  it("leaves money alone when won or closed as a warning", () => {
    for (const status of ["won", "warning_closed"]) {
      const outcome = disputeOutcome(
        "charge.dispute.closed",
        { ...DISPUTE, status },
        "primary",
        NOW,
      );
      expect(outcome.refundCents).toBe(0);
      expect(outcome.columns).toEqual({ dispute_status: status });
      expect(outcome.notify).toBe("closed");
    }
  });

  it("records a lost one as money gone", () => {
    const outcome = disputeOutcome(
      "charge.dispute.closed",
      { ...DISPUTE, status: "lost" },
      "primary",
      NOW,
    );
    expect(outcome.refundCents).toBe(1995);
    expect(outcome.event.title).toBe("Chargeback closed: lost");
  });

  it("stamps duplicate_resolved_at for a dispute on the duplicate payment", () => {
    const outcome = disputeOutcome("charge.dispute.created", DISPUTE, "duplicate", NOW);
    expect(outcome.columns).toEqual({ duplicate_resolved_at: NOW });
    expect(outcome.notify).toBeNull();
    expect(outcome.refundCents).toBe(0);
  });
});

describe("closedStatus", () => {
  it("defaults an unknown word to the quiet one", () => {
    expect(closedStatus("needs_response")).toBe("warning_closed");
    expect(closedStatus(null)).toBe("warning_closed");
  });
});

describe("applyDisputeEvent", () => {
  it("writes the event internal and never visible", async () => {
    const fake = fakeAdmin();
    await applyDisputeEvent(
      fake.admin,
      ORDER,
      "charge.dispute.created",
      DISPUTE,
      "primary",
      NOW,
      DEFAULT_COMMERCE_SETTINGS,
    );
    expect(fake.updates[0]).toMatchObject({ dispute_status: "open" });
    expect(fake.events[0]).toMatchObject({ visible_to_customer: false, kind: "dispute_opened" });
  });

  it("records a lost chargeback through recordRefund, keeping it internal", async () => {
    const fake = fakeAdmin();
    await applyDisputeEvent(
      fake.admin,
      ORDER,
      "charge.dispute.closed",
      { ...DISPUTE, status: "lost" },
      "primary",
      NOW,
      DEFAULT_COMMERCE_SETTINGS,
    );
    const refund = fake.updates.find((u) => "refunded_cents" in u);
    expect(refund).toMatchObject({
      refunded_cents: 1995,
      refund_note: "Chargeback lost",
      payment_status: "refunded",
      fulfillment_status: "cancelled",
    });
    const refundEvent = fake.events.find((e) => e.kind === "refunded");
    expect(refundEvent).toMatchObject({ visible_to_customer: false });
  });

  it("does not touch money on a win", async () => {
    const fake = fakeAdmin();
    await applyDisputeEvent(
      fake.admin,
      ORDER,
      "charge.dispute.closed",
      { ...DISPUTE, status: "won" },
      "primary",
      NOW,
      DEFAULT_COMMERCE_SETTINGS,
    );
    expect(fake.updates.some((u) => "refunded_cents" in u)).toBe(false);
  });
});
