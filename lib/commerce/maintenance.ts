/**
 * The hourly order housekeeping. Six bounded steps over orders, never leagues, and
 * nothing recomputed. A step that fails does not stop the next one; the run reports
 * the failure at the end.
 *
 * A REPORTED manual payment is never expired here: it stays in Needs attention until
 * the admin decides. A customer who says they paid is owed a person's answer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { CommerceSettings } from "./default-settings";
import { clearAbandonedUploads } from "./deliverables";
import { emailCustomer, insertEvent, sendReceipt } from "./orders";
import { expireStripeOrder } from "./reconcile";
import { retrieveCheckoutSession } from "@/lib/stripe/client";
import type { Order } from "./types";

type Client = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MaintenanceResult = {
  reminders: number;
  expiredManual: number;
  expiredStripe: number;
  receiptsRetried: number;
  uploadsCleared: number;
  eventsPruned: number;
  /** True when the deadline stopped a step before its rows ran out. */
  partial: boolean;
};

/** The wall clock budget. Every per-row loop asks before each row. */
type Clock = { outOfTime: () => boolean };

/** The run's own budget, inside the route's 60 second maxDuration. */
export const MAINTENANCE_BUDGET_MS = 45_000;

async function sendReminders(
  admin: Client,
  settings: CommerceSettings,
  now: Date,
  clock: Clock,
): Promise<number> {
  // Keyed on the payment window rather than on created_at, so an order whose window
  // was restarted (Not received, or a switch from card to PayPal on day four) gets
  // its reminder on day three of the NEW window, not within the hour.
  const daysBeforeClose = settings.payments.manualExpiryDays - settings.payments.manualReminderDay;
  const threshold = new Date(now.getTime() + daysBeforeClose * DAY_MS).toISOString();
  const { data, error } = await admin
    .from("orders")
    .select("*")
    .eq("payment_status", "awaiting_confirmation")
    .is("customer_reported_paid_at", null)
    .is("reminder_sent_at", null)
    .lt("expires_at", threshold)
    .limit(50);
  if (error) throw new Error(error.message);

  let sent = 0;
  for (const row of (data ?? []) as unknown as Order[]) {
    if (clock.outOfTime()) break;
    // Claimed before the send, so a retried run cannot remind twice.
    const { data: claimed, error: claimError } = await admin
      .from("orders")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", row.id)
      .is("reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) continue;

    const result = await emailCustomer(admin, row, "E6");
    // The customer-visible note says the reminder went out only when it did; a
    // failed send is already on the timeline as an internal row with a Resend.
    if (result.status === "sent") {
      await insertEvent(admin, {
        orderId: row.id,
        kind: "note",
        actor: "system",
        title: "Reminder email sent",
      });
    }
    sent += 1;
  }
  return sent;
}

async function expireManual(admin: Client, now: Date, clock: Clock): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("*")
    .eq("payment_status", "awaiting_confirmation")
    .is("customer_reported_paid_at", null)
    .lt("expires_at", now.toISOString())
    .limit(100);
  if (error) throw new Error(error.message);

  let expired = 0;
  for (const row of (data ?? []) as unknown as Order[]) {
    if (clock.outOfTime()) break;
    const { data: won, error: writeError } = await admin
      .from("orders")
      .update({ payment_status: "expired", fulfillment_status: "cancelled" })
      .eq("id", row.id)
      .eq("payment_status", "awaiting_confirmation")
      .is("customer_reported_paid_at", null)
      .select("id")
      .maybeSingle();
    if (writeError) throw new Error(writeError.message);
    if (!won) continue;

    await insertEvent(admin, {
      orderId: row.id,
      kind: "payment_expired",
      actor: "system",
      title: "This order closed because no payment arrived",
    });
    await emailCustomer(admin, row, "E10");
    expired += 1;
  }
  return expired;
}

/** Normally finds nothing: Stripe's own expired event gets there first. */
async function expireStripe(admin: Client, now: Date, clock: Clock): Promise<number> {
  const { data, error } = await admin
    .from("orders")
    .select("id, stripe_session_id")
    .eq("payment_method", "stripe")
    .eq("payment_status", "unpaid")
    .lt("expires_at", now.toISOString())
    .limit(100);
  if (error) throw new Error(error.message);

  let expired = 0;
  for (const row of data ?? []) {
    if (clock.outOfTime()) break;
    // A complete session is a delayed payment still settling, and a failed read
    // says nothing. Either way the order stays open.
    if (row.stripe_session_id) {
      const session = await retrieveCheckoutSession(row.stripe_session_id);
      if (!session.ok || session.data.status !== "expired") continue;
    }
    if (await expireStripeOrder(admin, row)) expired += 1;
  }
  return expired;
}

/** The status row is the whole guard; no event is read. `skipped` is retried too. */
async function retryReceipts(
  admin: Client,
  settings: CommerceSettings,
  now: Date,
  clock: Clock,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - settings.emails.receiptRetryAfterMinutes * 60 * 1000,
  ).toISOString();
  const { data, error } = await admin
    .from("orders")
    .select("id")
    .eq("payment_status", "paid")
    .in("receipt_email_status", ["pending", "failed", "skipped"])
    .lt("paid_at", cutoff)
    .lt("receipt_email_attempts", settings.emails.receiptRetryMax)
    .limit(50);
  if (error) throw new Error(error.message);

  let retried = 0;
  for (const row of data ?? []) {
    if (clock.outOfTime()) break;
    await sendReceipt(admin, row.id);
    retried += 1;
  }
  return retried;
}

async function pruneLedger(admin: Client, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const { count, error } = await admin
    .from("payment_webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * `deadlineMs` is a wall clock instant (Date.now() based, not `now`), after which
 * no per-row loop starts another row. After an email or webhook outage the four
 * row loops could otherwise queue about 1,500 round trips and 200 outbound calls
 * behind a 60 second function limit, get killed mid-run, and never reach the
 * prune. The next hourly tick picks up where this one stopped: every row is
 * claimed before its send, so nothing is done twice.
 */
export async function runOrderMaintenance(
  admin: Client,
  settings: CommerceSettings,
  now: Date = new Date(),
  deadlineMs: number = Date.now() + MAINTENANCE_BUDGET_MS,
): Promise<MaintenanceResult> {
  const failures: string[] = [];
  let partial = false;
  const clock: Clock = {
    outOfTime: () => {
      if (Date.now() < deadlineMs) return false;
      partial = true;
      return true;
    },
  };
  const step = async (name: string, work: () => Promise<number>): Promise<number> => {
    try {
      return await work();
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  };

  const result: MaintenanceResult = {
    reminders: await step("reminders", () => sendReminders(admin, settings, now, clock)),
    expiredManual: await step("manual expiry", () => expireManual(admin, now, clock)),
    expiredStripe: await step("stripe expiry", () => expireStripe(admin, now, clock)),
    receiptsRetried: await step("receipts", () => retryReceipts(admin, settings, now, clock)),
    uploadsCleared: await step("uploads", () => clearAbandonedUploads(admin, now)),
    eventsPruned: await step("ledger", () => pruneLedger(admin, now)),
    partial: false,
  };
  result.partial = partial;

  if (failures.length > 0) throw new Error(failures.join("; "));
  return result;
}
