/**
 * Chargebacks. Screens say chargeback, Stripe says dispute.
 *
 * Four events, each found by the payment intent. No customer email on any of them:
 * the conversation is between the cardholder, their bank and Stripe, and every
 * timeline row here is internal. The fulfillment status is left alone, because the
 * admin decides and a delivered review is not undelivered.
 *
 * `disputeOutcome` is the pure decision; `applyDisputeEvent` makes the writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatMoney } from "./constants";
import type { CommerceSettings } from "./default-settings";
import { insertEvent, recordRefund } from "./orders";
import { notifyDisputeClosed, notifyDisputeOpened } from "./notify";
import { stripeDisputeUrl } from "./stripe";
import type { DisputeStatus, Order } from "./types";

type Client = SupabaseClient<Database>;

export const DISPUTE_EVENTS = [
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export type DisputeEventType = (typeof DISPUTE_EVENTS)[number];

export type StripeDispute = {
  id?: string;
  amount?: number;
  payment_intent?: string | { id?: string } | null;
  reason?: string | null;
  status?: string | null;
  evidence_details?: { due_by?: number | null } | null;
};

export function closedStatus(status: string | null | undefined): DisputeStatus {
  if (status === "won" || status === "lost" || status === "warning_closed") return status;
  return "warning_closed";
}

function closedWord(status: DisputeStatus): "won" | "lost" | "closed" {
  return status === "won" || status === "lost" ? status : "closed";
}

export type DisputeTarget = "primary" | "duplicate";

export type DisputeOutcome = {
  /** What the row gets before anything else. */
  columns: Partial<Pick<Order, "dispute_id" | "dispute_status" | "disputed_at" | "duplicate_resolved_at">>;
  event: { kind: "dispute_opened" | "dispute_updated" | "dispute_closed" | "note"; title: string };
  /** Cents to record as gone. */
  refundCents: number;
  notify: "opened" | "closed" | null;
};

/** The decision for one event. Pure. */
export function disputeOutcome(
  type: DisputeEventType,
  dispute: StripeDispute,
  target: DisputeTarget,
  eventIso: string,
): DisputeOutcome {
  if (target === "duplicate") {
    return {
      columns: { duplicate_resolved_at: eventIso },
      event: { kind: "note", title: "A chargeback landed on the duplicate payment" },
      refundCents: 0,
      notify: null,
    };
  }

  switch (type) {
    case "charge.dispute.created":
      return {
        columns: {
          dispute_id: dispute.id ?? null,
          dispute_status: "open",
          disputed_at: eventIso,
        },
        event: { kind: "dispute_opened", title: "Chargeback opened" },
        refundCents: 0,
        notify: "opened",
      };
    case "charge.dispute.funds_withdrawn":
      return {
        columns: {},
        event: { kind: "dispute_updated", title: "Stripe withdrew the disputed funds" },
        refundCents: 0,
        notify: null,
      };
    case "charge.dispute.funds_reinstated":
      return {
        columns: {},
        event: { kind: "dispute_updated", title: "Stripe returned the disputed funds" },
        refundCents: 0,
        notify: null,
      };
    case "charge.dispute.closed": {
      const status = closedStatus(dispute.status);
      return {
        columns: { dispute_status: status },
        event: { kind: "dispute_closed", title: `Chargeback closed: ${closedWord(status)}` },
        refundCents: status === "lost" ? (dispute.amount ?? 0) : 0,
        notify: "closed",
      };
    }
  }
}

function dueByIso(dispute: StripeDispute): string | null {
  const due = dispute.evidence_details?.due_by;
  return typeof due === "number" ? new Date(due * 1000).toISOString() : null;
}

export type DisputeNotice = () => Promise<void>;

/**
 * Apply one event to one order. Returns the notice for the caller to run in
 * `after()`, or null. A redelivered event cannot double a refund: `recordRefund`
 * stops at the amount paid and the webhook ledger stops the delivery first.
 */
export async function applyDisputeEvent(
  admin: Client,
  order: Order,
  type: DisputeEventType,
  dispute: StripeDispute,
  target: DisputeTarget,
  eventIso: string,
  settings: CommerceSettings,
): Promise<DisputeNotice | null> {
  const outcome = disputeOutcome(type, dispute, target, eventIso);

  if (Object.keys(outcome.columns).length > 0) {
    const { error } = await admin.from("orders").update(outcome.columns).eq("id", order.id);
    if (error) throw new Error(error.message);
  }

  await insertEvent(admin, {
    orderId: order.id,
    kind: outcome.event.kind,
    actor: "system",
    visible: false,
    title: outcome.event.title,
    data: {
      disputeId: dispute.id ?? null,
      amount: dispute.amount ?? null,
      reason: dispute.reason ?? null,
      dueBy: dispute.evidence_details?.due_by ?? null,
    },
  });

  let recorded = "Nothing else was recorded.";
  if (outcome.refundCents > 0) {
    const result = await recordRefund(admin, order, {
      deltaCents: outcome.refundCents,
      note: "Chargeback lost",
      refundedAtIso: eventIso,
      actor: "system",
      visibleToCustomer: false,
    });
    if (result.applied) {
      recorded = `${formatMoney(result.deltaCents)} recorded as money gone.`;
    } else if (result.error) {
      throw new Error(result.error);
    }
  }

  const paymentIntent = order.stripe_payment_intent_id;
  if (outcome.notify === "opened") {
    return () =>
      notifyDisputeOpened(admin, order, settings, {
        amountCents: dispute.amount ?? 0,
        reason: dispute.reason ?? null,
        dueByIso: dueByIso(dispute),
        disputeUrl: paymentIntent ? stripeDisputeUrl(paymentIntent, order.livemode) : null,
        fulfillment: order.fulfillment_status,
      });
  }
  if (outcome.notify === "closed") {
    const status = closedStatus(dispute.status);
    return () =>
      notifyDisputeClosed(admin, order, settings, { outcome: closedWord(status), recorded });
  }
  return null;
}
