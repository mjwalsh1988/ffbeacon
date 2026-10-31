import "server-only";

/**
 * Stripe for orders: one hosted Checkout session per order, and only one payable.
 *
 * BEFORE A SESSION IS CREATED, the current one is closed. Stripe answers 200 for an
 * open session and 400 for one that is already expired or complete, and only a
 * retrieve can say which: `complete` means the customer has ALREADY PAID on it and
 * the webhook has not landed, so no new session is made and the reconcile runs
 * instead. That is what makes a double charge impossible rather than merely
 * unlikely, and the same decision guards a method switch and a cancel.
 *
 * No `payment_method_types` (see lib/stripe/client.ts). No `submit_type`, so the
 * default button reads Pay.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { SITE } from "@/lib/site";
import {
  expireCheckoutSession,
  retrieveCheckoutSession,
  stripeRequest,
  type CheckoutSession,
} from "@/lib/stripe/client";
import type { CommerceSettings } from "./default-settings";
import { insertEvent } from "./orders";
import type { Order } from "./types";

type Client = SupabaseClient<Database>;

const SITE_ORIGIN = SITE.url.replace(/\/+$/, "");

/** Five minutes past Stripe's own expiry, so the cron never expires an order first. */
const ORDER_EXPIRY_GRACE_SECONDS = 5 * 60;

export type CloseDecision = "proceed" | "paid" | "pending" | "failed";

/**
 * Close the order's open session, if it has one.
 *
 *   proceed  Nothing payable is left. A new session, a switch or a cancel may go on.
 *   paid     The session is complete and paid. Reconcile, do nothing else.
 *   pending  The session is complete and a delayed method has not settled. Do nothing.
 *   failed   Stripe gave no usable answer, so nothing may go on.
 */
export async function closeOpenSession(
  order: Pick<Order, "stripe_session_id" | "payment_status">,
): Promise<CloseDecision> {
  // An expired order is asked too: the cron or a stale read can call an order
  // expired while a delayed payment on its session is still settling.
  const live = order.payment_status === "unpaid" || order.payment_status === "expired";
  if (!order.stripe_session_id || !live) return "proceed";

  const expired = await expireCheckoutSession(order.stripe_session_id);
  if (expired.ok) return "proceed";
  if (expired.reason !== "error" || expired.detail !== "already-closed") return "failed";

  const session = await retrieveCheckoutSession(order.stripe_session_id);
  if (!session.ok) return "failed";
  if (session.data.status === "expired") return "proceed";
  if (session.data.status === "complete") {
    const paid =
      session.data.payment_status === "paid" ||
      session.data.payment_status === "no_payment_required";
    return paid ? "paid" : "pending";
  }
  return "failed";
}

/** The session's life, in unix seconds, inside Stripe's own bounds. */
export function sessionExpiresAt(minutes: number, nowMs: number): number {
  const bounded = Math.min(1440, Math.max(30, minutes));
  return Math.floor(nowMs / 1000) + bounded * 60;
}

/** The same check the donation route makes on the one URL we send a browser to. */
export function isStripeHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return host === "checkout.stripe.com" || host.endsWith(".stripe.com");
}

export function buildSessionBody(
  order: Pick<Order, "id" | "order_number" | "amount_cents" | "product_snapshot" | "context">,
  email: string | null,
  expiresAt: number,
): Record<string, unknown> {
  const metadata = {
    product: "ffbeacon_order",
    order_id: order.id,
    order_number: order.order_number,
    product_slug: order.product_snapshot.slug,
  };
  return {
    mode: "payment",
    client_reference_id: order.id,
    expires_at: expiresAt,
    success_url: `${SITE_ORIGIN}/my-beacon/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_ORIGIN}/my-beacon/orders/${order.id}?pay=cancelled`,
    ...(email ? { customer_email: email } : {}),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: order.amount_cents,
          product_data: {
            name: `${order.product_snapshot.name} (Personal Team Review)`,
            description: `${order.context.teamName} in ${order.context.leagueName}, ${order.context.season}`,
          },
        },
      },
    ],
    payment_intent_data: {
      description: `FF Beacon order ${order.order_number}`,
      metadata,
    },
    metadata,
  };
}

export type StartCheckoutResult =
  | { kind: "redirect"; url: string }
  | { kind: "already-paid" }
  | { kind: "pending" }
  | { kind: "reset-failed" }
  | { kind: "failed" };

/**
 * Close any open session, create a fresh one, and store it.
 *
 * The idempotency key uses attempts + 1 and the column moves in the same update
 * that stores the session, so a retry makes a new session rather than replaying an
 * old key with a different body, which Stripe refuses.
 */
export async function startStripeCheckout(
  admin: Client,
  order: Order,
  email: string | null,
  settings: CommerceSettings,
): Promise<StartCheckoutResult> {
  const closed = await closeOpenSession(order);
  if (closed === "paid") return { kind: "already-paid" };
  if (closed === "pending") return { kind: "pending" };
  if (closed === "failed") return { kind: "reset-failed" };

  const attempt = order.stripe_session_attempts + 1;
  const expiresAt = sessionExpiresAt(settings.payments.stripeSessionMinutes, Date.now());
  const session = await stripeRequest<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    idempotencyKey: `order:${order.id}:${attempt}`,
    body: buildSessionBody(order, email, expiresAt),
  });
  if (!session.ok || !session.data.url) return { kind: "failed" };
  if (!isStripeHost(session.data.url)) {
    console.error("[orders] refusing to redirect to an unexpected host", order.order_number);
    return { kind: "failed" };
  }

  const stripeExpiry = session.data.expires_at ?? expiresAt;
  const { data: stored, error } = await admin
    .from("orders")
    .update({
      stripe_session_id: session.data.id,
      stripe_session_attempts: attempt,
      stripe_session_expires_at: new Date(stripeExpiry * 1000).toISOString(),
      payment_status: "unpaid",
      expires_at: new Date((stripeExpiry + ORDER_EXPIRY_GRACE_SECONDS) * 1000).toISOString(),
    })
    .eq("id", order.id)
    .in("payment_status", ["unpaid", "expired"])
    .select("id")
    .maybeSingle();
  if (error || !stored) {
    // Paid or cancelled while Stripe was answering, so the new session must not
    // stay payable.
    console.error("[orders] session write failed", order.order_number, error?.message);
    await expireCheckoutSession(session.data.id);
    return { kind: "failed" };
  }

  if (attempt === 1) {
    await insertEvent(admin, {
      orderId: order.id,
      kind: "payment_pending",
      actor: "system",
      title: "Card payment opened",
    });
  }
  return { kind: "redirect", url: session.data.url };
}

function paymentsBase(livemode: boolean | null): string {
  return livemode === false
    ? "https://dashboard.stripe.com/test/payments"
    : "https://dashboard.stripe.com/payments";
}

/** The payment in Stripe's Dashboard. */
export function stripeDashboardUrl(paymentIntentId: string, livemode: boolean | null): string {
  return `${paymentsBase(livemode)}/${encodeURIComponent(paymentIntentId)}`;
}

/** A chargeback lives on its payment in the Dashboard. */
export function stripeDisputeUrl(paymentIntentId: string, livemode: boolean | null): string {
  return stripeDashboardUrl(paymentIntentId, livemode);
}
