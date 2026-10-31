import "server-only";

/**
 * Reconcile on view: the order page asks Stripe directly when the webhook has not
 * landed yet, and at the session complete answer in closeOpenSession.
 *
 * Shares `applySessionPaid` with the webhook, so the amount check runs first and
 * the paid path is one path. The `?session_id=` a browser carries is compared and
 * otherwise ignored; it is never used to look anything up.
 */

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { redactStripeEvent } from "@/lib/donate/redact";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { retrieveCheckoutSession, type CheckoutSession } from "@/lib/stripe/client";
import { checkoutOutcome } from "@/lib/stripe/outcome";
import type { CommerceSettings } from "./default-settings";
import { insertEvent, markPaidIfWon, readOrder } from "./orders";
import { notifyAmountMismatch } from "./notify";
import { stripeDashboardUrl } from "./stripe";
import type { Order } from "./types";

type Client = SupabaseClient<Database>;

const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function paymentIntentIdOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** The order must match what Stripe says was paid, in amount and currency. */
export function amountMatches(
  order: Pick<Order, "amount_cents">,
  session: { amount_total?: number | null; currency?: string | null },
): boolean {
  return (
    session.amount_total === order.amount_cents &&
    (session.currency ?? "").toLowerCase() === "usd"
  );
}

/**
 * Record a mismatch instead of a payment. This cannot happen through our own
 * checkout, which is exactly why it must be loud when it does.
 */
export async function recordMismatch(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  session: {
    id: string;
    amount_total?: number | null;
    currency?: string | null;
    payment_intent?: unknown;
  },
  livemode: boolean | null,
): Promise<void> {
  const reported = session.amount_total ?? 0;
  const paymentIntentId = paymentIntentIdOf(session.payment_intent);
  const { error } = await admin
    .from("orders")
    .update({ mismatch_amount_cents: reported })
    .eq("id", order.id);
  if (error) throw new Error(error.message);

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_mismatch",
    actor: "system",
    visible: false,
    title: "Stripe reported a different amount",
    data: {
      expected: order.amount_cents,
      reported,
      currency: session.currency ?? null,
      sessionId: session.id,
      paymentIntentId,
    },
  });
  after(() =>
    notifyAmountMismatch(admin, order, settings, {
      reportedCents: reported,
      currency: session.currency ?? null,
      sessionId: session.id,
      paymentUrl: paymentIntentId ? stripeDashboardUrl(paymentIntentId, livemode) : null,
    }),
  );
}

export function canReconcile(
  order: Pick<
    Order,
    "payment_method" | "payment_status" | "stripe_session_id" | "created_at" | "stripe_session_expires_at"
  >,
  now: Date,
): boolean {
  if (order.payment_method !== "stripe") return false;
  if (order.payment_status !== "unpaid" && order.payment_status !== "expired") return false;
  if (!order.stripe_session_id) return false;
  // The window is measured from the CURRENT session, not only from the order. A
  // reader who comes back on day three, opens a fresh card page and pays while the
  // webhook is down must still be found by the read-back.
  const created = new Date(order.created_at).getTime();
  const sessionEnd = order.stripe_session_expires_at
    ? new Date(order.stripe_session_expires_at).getTime()
    : created;
  return now.getTime() - Math.max(created, sessionEnd) <= RECONCILE_WINDOW_MS;
}

export type ReconcileResult = "paid" | "unchanged" | "throttled";

/** Ask Stripe about one session and act on the answer. */
export async function reconcileStripeOrder(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  if (!canReconcile(order, now) || !order.stripe_session_id) return "unchanged";

  const allowed = await claimRateLimitSlot({
    bucket: "order-reconcile",
    max: settings.rateLimits.reconcilePerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return "throttled";

  const result = await retrieveCheckoutSession(order.stripe_session_id);
  if (!result.ok) return "unchanged";
  const session: CheckoutSession = result.data;
  const outcome = checkoutOutcome(session);

  if (outcome === "paid") {
    const livemode = typeof session.livemode === "boolean" ? session.livemode : null;
    if (!amountMatches(order, session)) {
      // Already recorded means already reported; the admin has been told.
      const fresh = await readOrder(admin, order.id);
      if (fresh && fresh.mismatch_amount_cents == null) {
        await recordMismatch(admin, fresh, settings, session, livemode);
      }
      return "unchanged";
    }
    const marked = await markPaidIfWon(admin, order, settings, {
      paidVia: "stripe-reconcile",
      paymentIntentId: paymentIntentIdOf(session.payment_intent),
      livemode,
      metadata: redactStripeEvent({
        id: null,
        type: "reconcile",
        livemode,
        data: { object: session },
      }),
      actor: "system",
      title: "Payment received",
      via: "stripe",
    });
    if (marked.won) {
      after(marked.followUp);
      return "paid";
    }
    return "unchanged";
  }

  if (session.status === "expired" && order.payment_status === "unpaid") {
    await expireStripeOrder(admin, order);
  }
  return "unchanged";
}

/** Mark an unpaid card order expired, once. Shared with the webhook and the cron. */
export async function expireStripeOrder(
  admin: Client,
  order: Pick<Order, "id" | "stripe_session_id">,
): Promise<boolean> {
  let query = admin
    .from("orders")
    .update({ payment_status: "expired" })
    .eq("id", order.id)
    .eq("payment_status", "unpaid");
  if (order.stripe_session_id) query = query.eq("stripe_session_id", order.stripe_session_id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_expired",
    actor: "system",
    title: "The card payment page expired. You can open a new one from this page.",
  });
  return true;
}
