/**
 * The order state machine. Two columns, two machines, one module: every action
 * checks a transition here and nowhere else, and the test file pins the tables.
 *
 * A PARTIAL refund is not a transition: `refunded_cents` grows and payment_status
 * stays `paid`. A chargeback is not a payment status either: `dispute_status` is
 * its own column and its own chip, drawn beside the payment chip on admin surfaces
 * only.
 *
 * Pure, and safe in a client component.
 */

import type { DisputeStatus, FulfillmentStatus, PaymentStatus } from "./types";

const PAYMENT_MOVES: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["paid", "expired", "cancelled"],
  awaiting_confirmation: ["paid", "expired", "cancelled"],
  expired: ["unpaid", "paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

const FULFILLMENT_MOVES: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  pending_payment: ["queued", "cancelled"],
  queued: ["in_progress", "delivered", "cancelled"],
  in_progress: ["delivered", "queued", "cancelled"],
  delivered: ["in_progress"],
  cancelled: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_MOVES[from].includes(to);
}

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_MOVES[from].includes(to);
}

/** The statuses an admin may move an order to from where it is. */
export function fulfillmentMovesFrom(from: FulfillmentStatus): FulfillmentStatus[] {
  return [...FULFILLMENT_MOVES[from]];
}

export type StepState = "complete" | "current" | "upcoming" | "failed";

export type ProgressStep = {
  key: "ordered" | "paid" | "in_progress" | "delivered";
  label: string;
  state: StepState;
};

type ProgressInput = {
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
};

function paidStep(status: PaymentStatus): StepState {
  if (status === "paid" || status === "refunded") return "complete";
  if (status === "unpaid" || status === "awaiting_confirmation") return "current";
  return "failed";
}

function inProgressStep(status: FulfillmentStatus): StepState {
  if (status === "delivered") return "complete";
  if (status === "in_progress") return "current";
  return "upcoming";
}

/** The customer's four-step tracker. */
export function progressStep(order: ProgressInput): ProgressStep[] {
  const delivered = order.fulfillment_status === "delivered";
  // A refunded order that never delivered crosses its last step out.
  const neverDelivered = order.payment_status === "refunded" && !delivered;
  return [
    { key: "ordered", label: "Ordered", state: "complete" },
    { key: "paid", label: "Paid", state: paidStep(order.payment_status) },
    {
      key: "in_progress",
      label: "In progress",
      state: inProgressStep(order.fulfillment_status),
    },
    {
      key: "delivered",
      label: "Delivered",
      state: delivered ? "complete" : neverDelivered ? "failed" : "upcoming",
    },
  ];
}

export type Tone = "positive" | "warning" | "danger" | "cyan" | "purple" | "muted";

export type Chip = { word: string; tone: Tone };

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, Chip> = {
  pending_payment: { word: "Not started", tone: "muted" },
  queued: { word: "In the queue", tone: "purple" },
  in_progress: { word: "In progress", tone: "cyan" },
  delivered: { word: "Delivered", tone: "positive" },
  cancelled: { word: "Canceled", tone: "muted" },
};

type ChipInput = {
  payment_status: PaymentStatus;
  refunded_cents: number;
};

/** The payment chip. `awaiting_confirmation` reads differently to the admin. */
export function paymentChip(order: ChipInput, audience: "customer" | "admin"): Chip {
  switch (order.payment_status) {
    case "unpaid":
      return { word: "Awaiting card payment", tone: "warning" };
    case "awaiting_confirmation":
      return {
        word: audience === "admin" ? "Awaiting confirmation" : "Awaiting your payment",
        tone: "warning",
      };
    case "paid":
      return order.refunded_cents > 0
        ? { word: "Paid, partly refunded", tone: "warning" }
        : { word: "Paid", tone: "positive" };
    case "expired":
      return { word: "Payment expired", tone: "muted" };
    case "cancelled":
      return { word: "Canceled", tone: "muted" };
    case "refunded":
      return { word: "Refunded", tone: "danger" };
  }
}

/** Admin surfaces only: a chargeback is never drawn for the customer. */
export function disputeChip(status: DisputeStatus | null): Chip | null {
  switch (status) {
    case "open":
      return { word: "Chargeback open", tone: "danger" };
    case "won":
      return { word: "Chargeback won", tone: "positive" };
    case "lost":
      return { word: "Chargeback lost", tone: "danger" };
    case "warning_closed":
      return { word: "Inquiry closed", tone: "muted" };
    default:
      return null;
  }
}

export const FREE_CHIP: Chip = { word: "Free", tone: "muted" };
export const TEST_CHIP: Chip = { word: "Test", tone: "warning" };
