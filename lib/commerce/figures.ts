/**
 * The admin's figures, pure over rows.
 *
 * Needs attention is defined TWICE on purpose and held together by a test:
 * `needsAttention` decides one order in memory and `attentionFilter` is the same
 * predicate as a PostgREST filter for the tab query. The test evaluates the
 * filter string over a table of orders and asserts the two always agree.
 *
 * Revenue excludes test mode (`livemode` false) and sums what was kept
 * (`amount_cents - refunded_cents`), so a complimentary order adds zero by
 * construction and a refund comes off the week the payment landed.
 */

import { SITE_TIME_ZONE } from "@/lib/datetime";
import type { DisputeStatus, FulfillmentStatus, PaymentStatus, ReceiptEmailStatus } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type AttentionFields = {
  payment_status: PaymentStatus;
  customer_reported_paid_at: string | null;
  due_at: string | null;
  fulfillment_status: FulfillmentStatus;
  dispute_status: DisputeStatus | null;
  duplicate_payment_intent_id: string | null;
  duplicate_resolved_at: string | null;
  mismatch_amount_cents: number | null;
  receipt_email_status: ReceiptEmailStatus | null;
  paid_at: string | null;
};

export const ATTENTION_COLUMNS =
  "payment_status, customer_reported_paid_at, due_at, fulfillment_status, dispute_status, duplicate_payment_intent_id, duplicate_resolved_at, mismatch_amount_cents, receipt_email_status, paid_at";

export type AttentionReason =
  | "reported"
  | "overdue"
  | "chargeback"
  | "duplicate"
  | "mismatch"
  | "receipt";

/** Why an order needs a look, in the order the hint names them. */
export function attentionReasons(order: AttentionFields, now: Date): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const nowMs = now.getTime();
  if (order.payment_status === "awaiting_confirmation" && order.customer_reported_paid_at) {
    reasons.push("reported");
  }
  if (
    order.due_at &&
    new Date(order.due_at).getTime() < nowMs &&
    (order.fulfillment_status === "queued" || order.fulfillment_status === "in_progress")
  ) {
    reasons.push("overdue");
  }
  if (order.dispute_status === "open") reasons.push("chargeback");
  if (order.duplicate_payment_intent_id && !order.duplicate_resolved_at) reasons.push("duplicate");
  if (order.mismatch_amount_cents != null) reasons.push("mismatch");
  if (
    order.payment_status === "paid" &&
    order.receipt_email_status !== "sent" &&
    order.paid_at &&
    new Date(order.paid_at).getTime() < nowMs - HOUR_MS
  ) {
    reasons.push("receipt");
  }
  return reasons;
}

export function needsAttention(order: AttentionFields, now: Date): boolean {
  return attentionReasons(order, now).length > 0;
}

/**
 * The same predicate for `.or()`. Timestamps are double-quoted because a colon and
 * a period are reserved inside a PostgREST logical filter.
 */
export function attentionFilter(now: Date): string {
  const nowIso = now.toISOString();
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  return [
    "and(payment_status.eq.awaiting_confirmation,customer_reported_paid_at.not.is.null)",
    `and(due_at.lt."${nowIso}",fulfillment_status.in.(queued,in_progress))`,
    "dispute_status.eq.open",
    "and(duplicate_payment_intent_id.not.is.null,duplicate_resolved_at.is.null)",
    "mismatch_amount_cents.not.is.null",
    `and(payment_status.eq.paid,paid_at.lt."${hourAgo}",or(receipt_email_status.is.null,receipt_email_status.neq.sent))`,
  ].join(",");
}

const REASON_WORDS: Record<AttentionReason, [string, string]> = {
  reported: ["reported payment", "reported payments"],
  overdue: ["overdue", "overdue"],
  chargeback: ["chargeback", "chargebacks"],
  duplicate: ["duplicate payment", "duplicate payments"],
  mismatch: ["amount mismatch", "amount mismatches"],
  receipt: ["receipt not sent", "receipts not sent"],
};

/** "1 reported payment, 1 overdue, 1 chargeback", or null when nothing is waiting. */
export function attentionHint(orders: AttentionFields[], now: Date): string | null {
  const counts = new Map<AttentionReason, number>();
  for (const order of orders) {
    for (const reason of attentionReasons(order, now)) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  const parts: string[] = [];
  for (const reason of Object.keys(REASON_WORDS) as AttentionReason[]) {
    const n = counts.get(reason);
    if (n) parts.push(`${n} ${REASON_WORDS[reason][n === 1 ? 0 : 1]}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

export type RevenueRow = {
  amount_cents: number;
  refunded_cents: number;
  paid_at: string | null;
  livemode: boolean | null;
  payment_status: PaymentStatus;
};

export type WeekBucket = {
  /** The Monday that starts the week, as an Eastern calendar date. */
  weekStart: string;
  orders: number;
  revenueCents: number;
  refundedCents: number;
};

const EASTERN_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Whole calendar days since the epoch for the Eastern date of an instant. */
function easternDayNumber(date: Date): number {
  const [y, m, d] = EASTERN_YMD.format(date).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function dayNumberToYmd(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function countsTowardRevenue(row: RevenueRow): boolean {
  return (
    row.paid_at != null &&
    row.livemode !== false &&
    (row.payment_status === "paid" || row.payment_status === "refunded")
  );
}

/** Revenue kept over the last `days` days. */
export function revenueOver(rows: RevenueRow[], now: Date, days: number): number {
  const since = now.getTime() - days * DAY_MS;
  let total = 0;
  for (const row of rows) {
    if (!countsTowardRevenue(row)) continue;
    if (new Date(row.paid_at as string).getTime() < since) continue;
    total += row.amount_cents - row.refunded_cents;
  }
  return total;
}

/**
 * Twelve weeks ending Sunday, Eastern, oldest first. Counted in calendar days
 * rather than milliseconds, so a daylight saving change cannot move an order
 * across a week line.
 */
export function revenueWeeks(rows: RevenueRow[], now: Date, weeks = 12): WeekBucket[] {
  const today = easternDayNumber(now);
  // The epoch was a Thursday, so day number 4 was a Monday.
  const mondayOffset = ((today - 4) % 7 + 7) % 7;
  const thisMonday = today - mondayOffset;
  const firstMonday = thisMonday - (weeks - 1) * 7;

  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: dayNumberToYmd(firstMonday + i * 7),
    orders: 0,
    revenueCents: 0,
    refundedCents: 0,
  }));

  for (const row of rows) {
    if (!countsTowardRevenue(row)) continue;
    const day = easternDayNumber(new Date(row.paid_at as string));
    const index = Math.floor((day - firstMonday) / 7);
    if (index < 0 || index >= weeks) continue;
    const bucket = buckets[index];
    bucket.orders += 1;
    bucket.revenueCents += row.amount_cents - row.refunded_cents;
    bucket.refundedCents += row.refunded_cents;
  }
  return buckets;
}

/** Mean days from paid to delivered, one decimal, or null with none delivered. */
export function turnaroundDays(
  rows: Array<{ paid_at: string | null; delivered_at: string | null }>,
): number | null {
  const spans: number[] = [];
  for (const row of rows) {
    if (!row.paid_at || !row.delivered_at) continue;
    spans.push((new Date(row.delivered_at).getTime() - new Date(row.paid_at).getTime()) / DAY_MS);
  }
  if (spans.length === 0) return null;
  const mean = spans.reduce((sum, n) => sum + n, 0) / spans.length;
  return Math.round(mean * 10) / 10;
}
