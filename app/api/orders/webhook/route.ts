import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyStripeSignature } from "@/lib/donate/webhook-signature";
import { redactStripeEvent } from "@/lib/donate/redact";
import { loadCommerceSettings, type CommerceSettings } from "@/lib/commerce/settings";
import {
  applyDisputeEvent,
  DISPUTE_EVENTS,
  type DisputeEventType,
  type StripeDispute,
} from "@/lib/commerce/disputes";
import {
  emailCustomer,
  insertEvent,
  markPaidIfWon,
  readOrder,
  recordRefund,
} from "@/lib/commerce/orders";
import { notifyDuplicatePayment } from "@/lib/commerce/notify";
import {
  amountMatches,
  expireStripeOrder,
  paymentIntentIdOf,
  recordMismatch,
} from "@/lib/commerce/reconcile";
import { stripeDashboardUrl } from "@/lib/commerce/stripe";
import type { Order } from "@/lib/commerce/types";

/**
 * POST /api/orders/webhook
 *
 * Stripe tells us what happened to an order's money. Its own endpoint with its own
 * signing secret, so a mistake here cannot stop donation receipts.
 *
 * THE SIGNATURE IS CHECKED FIRST, on the raw body, and fails closed without the
 * secret. See lib/donate/webhook-signature.ts.
 *
 * EVERY EVENT IS RECORDED BY ID BEFORE IT IS ACTED ON (payment_webhook_events), so
 * a redelivery writes no second timeline row. A row with a null `completed_at` is
 * an earlier delivery that is in flight or died, and it is processed again: every
 * write below is idempotent on its own.
 *
 * THE AMOUNT IS CHECKED BEFORE ANY PAID TRANSITION. A session whose amount or
 * currency differs from the order is recorded and reported, and the admin decides.
 *
 * WHAT THE CODES MEAN. Stripe retries every non-2xx with backoff for three days. 400
 * says this request was never valid, 500 says try us again and is used only for a
 * database write that must be retried, and 200 says we are finished with this
 * event. Anything answered 200 is never retried, so a 200 must never hide work that
 * could still be recovered.
 */

// The signature is over the raw body, so this must run on Node with the body read
// as text. Parsing and re-serializing the JSON changes the bytes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

const HANDLED_EVENTS = new Set<string>([
  ...SESSION_EVENTS,
  "charge.refunded",
  ...DISPUTE_EVENTS,
]);

const UUID = /^[0-9a-f-]{36}$/;

type StripeSession = {
  id?: string;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  status?: string | null;
  payment_intent?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
};

type StripeCharge = {
  id?: string;
  payment_intent?: string | { id?: string } | null;
  amount_refunded?: number;
};

type StripeEvent = {
  id?: string;
  type?: string;
  created?: number;
  livemode?: boolean;
  data?: { object?: unknown };
};

type Admin = ReturnType<typeof createAdminClient>;

type Handled = { handled: boolean; reason?: string; orderId?: string | null };

/** The dedupe ledger. Null means carry on; a response means stop here. */
async function claimEvent(
  admin: Admin,
  event: StripeEvent & { id: string; type: string },
): Promise<NextResponse | null> {
  const { error } = await admin.from("payment_webhook_events").insert({
    provider: "stripe",
    event_id: event.id,
    endpoint: "orders",
    event_type: event.type,
    livemode: event.livemode ?? null,
  });
  if (!error) return null;
  if (error.code !== "23505") {
    console.error("[orders] could not record the event", error.message);
    return NextResponse.json({ received: false }, { status: 500 });
  }

  const { data } = await admin
    .from("payment_webhook_events")
    .select("completed_at")
    .eq("provider", "stripe")
    .eq("event_id", event.id)
    .maybeSingle();
  if (data?.completed_at) {
    return NextResponse.json({ received: true, handled: false, reason: "duplicate-event" });
  }
  return null;
}

async function finish(admin: Admin, eventId: string, result: Handled): Promise<NextResponse> {
  const { error } = await admin
    .from("payment_webhook_events")
    .update({
      completed_at: new Date().toISOString(),
      outcome: (result.reason ?? (result.handled ? "handled" : "ignored")).slice(0, 80),
      order_id: result.orderId ?? null,
    })
    .eq("provider", "stripe")
    .eq("event_id", eventId);
  if (error) console.error("[orders] could not stamp the event", eventId, error.message);
  const { orderId: _orderId, ...body } = result;
  void _orderId;
  return NextResponse.json({ received: true, ...body });
}

async function findOrderForSession(admin: Admin, session: StripeSession): Promise<Order | null> {
  const { data } = await admin
    .from("orders")
    .select("*")
    .eq("stripe_session_id", session.id as string)
    .maybeSingle();
  if (data) return data as unknown as Order;

  // A retried session: the stored id has moved on. Checked as a uuid before it
  // goes anywhere near a query, because the metadata is a free-form map.
  const fallback = session.metadata?.order_id;
  if (typeof fallback === "string" && UUID.test(fallback)) return readOrder(admin, fallback);
  return null;
}

async function findOrderByIntent(
  admin: Admin,
  paymentIntentId: string,
): Promise<{ order: Order; target: "primary" | "duplicate" } | null> {
  const primary = await admin
    .from("orders")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (primary.data) return { order: primary.data as unknown as Order, target: "primary" };

  const duplicate = await admin
    .from("orders")
    .select("*")
    .eq("duplicate_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (duplicate.data) return { order: duplicate.data as unknown as Order, target: "duplicate" };
  return null;
}

function eventIso(event: StripeEvent): string {
  return typeof event.created === "number"
    ? new Date(event.created * 1000).toISOString()
    : new Date().toISOString();
}

/** The paid path. Amount first, then the one transition, then the second-payment check. */
async function handlePaidSession(
  admin: Admin,
  event: StripeEvent,
  session: StripeSession & { id: string },
  order: Order,
  settings: CommerceSettings,
): Promise<Handled> {
  const livemode = event.livemode ?? null;
  const paymentIntentId = paymentIntentIdOf(session.payment_intent);

  if (!amountMatches(order, session)) {
    await recordMismatch(admin, order, settings, session, livemode);
    return { handled: true, reason: "amount-mismatch", orderId: order.id };
  }

  const marked = await markPaidIfWon(admin, order, settings, {
    paidVia: "stripe-webhook",
    paidAtIso: eventIso(event),
    paymentIntentId,
    livemode,
    metadata: redactStripeEvent(event),
    actor: "system",
    title: "Payment received",
    via: "stripe",
  });
  if (marked.won) {
    after(marked.followUp);
    return { handled: true, orderId: order.id };
  }
  if (marked.error) throw new Error(marked.error);

  const fresh = (await readOrder(admin, order.id)) ?? order;

  // The admin confirmed this card order by hand before the event landed. This is
  // that same payment, and the id is what a later refund or chargeback is found by.
  if (
    fresh.payment_status === "paid" &&
    fresh.payment_method === "stripe" &&
    !fresh.stripe_payment_intent_id &&
    paymentIntentId
  ) {
    const { error } = await admin
      .from("orders")
      .update({ stripe_payment_intent_id: paymentIntentId, livemode })
      .eq("id", fresh.id);
    if (error) throw new Error(error.message);
    return { handled: false, reason: "already-paid", orderId: order.id };
  }

  const isSecondPayment =
    paymentIntentId != null &&
    paymentIntentId !== fresh.stripe_payment_intent_id &&
    paymentIntentId !== fresh.duplicate_payment_intent_id;
  if (isSecondPayment) {
    const { error } = await admin
      .from("orders")
      .update({ duplicate_payment_intent_id: paymentIntentId })
      .eq("id", fresh.id);
    if (error) throw new Error(error.message);
    await insertEvent(admin, {
      orderId: fresh.id,
      kind: "duplicate_payment",
      actor: "system",
      visible: false,
      title: "A second payment arrived for this order",
      data: { paymentIntentId, amount: session.amount_total ?? null },
    });
    after(() =>
      notifyDuplicatePayment(admin, fresh, settings, {
        firstUrl: fresh.stripe_payment_intent_id
          ? stripeDashboardUrl(fresh.stripe_payment_intent_id, livemode)
          : "No first payment on record",
        secondUrl: stripeDashboardUrl(paymentIntentId, livemode),
        amountCents: session.amount_total ?? 0,
      }),
    );
    return { handled: true, reason: "duplicate-payment", orderId: order.id };
  }
  return { handled: false, reason: "already-paid", orderId: order.id };
}

async function handleSessionEvent(
  admin: Admin,
  event: StripeEvent & { type: string },
  settings: CommerceSettings,
): Promise<Handled> {
  const session = (event.data?.object ?? {}) as StripeSession;
  if (session.metadata?.product !== "ffbeacon_order") {
    return { handled: false, reason: "not-an-order" };
  }
  if (!session.id || typeof session.id !== "string") {
    console.warn("[orders] webhook event carried no session id");
    return { handled: false, reason: "no-session" };
  }
  const order = await findOrderForSession(admin, session);
  if (!order) {
    // A 500 would retry forever on an order that was deleted by hand.
    console.warn("[orders] no order for session", session.id);
    return { handled: false, reason: "no-order" };
  }
  const known = session as StripeSession & { id: string };

  if (event.type === "checkout.session.expired") {
    if (order.payment_status === "unpaid" && order.stripe_session_id === session.id) {
      await expireStripeOrder(admin, order);
      return { handled: true, reason: "expired", orderId: order.id };
    }
    return { handled: false, reason: "not-current", orderId: order.id };
  }

  if (event.type === "checkout.session.async_payment_failed") {
    if (order.payment_status !== "unpaid") {
      return { handled: false, reason: "not-unpaid", orderId: order.id };
    }
    await insertEvent(admin, {
      orderId: order.id,
      kind: "payment_not_found",
      actor: "system",
      title: "The card payment did not go through",
    });
    after(async () => {
      await emailCustomer(admin, order, "E7", { failure: "card" });
    });
    return { handled: true, reason: "async-failed", orderId: order.id };
  }

  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    return handlePaidSession(admin, event, known, order, settings);
  }

  // A delayed method: Checkout finished and the money has not arrived.
  const { data: latest } = await admin
    .from("order_events")
    .select("kind, body")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const body = "Your bank is still confirming the payment.";
  if (!(latest?.kind === "payment_pending" && latest?.body === body)) {
    await insertEvent(admin, {
      orderId: order.id,
      kind: "payment_pending",
      actor: "system",
      title: "Payment in progress",
      body,
    });
  }
  return { handled: true, reason: "delayed", orderId: order.id };
}

async function handleRefund(
  admin: Admin,
  event: StripeEvent,
): Promise<Handled> {
  const charge = (event.data?.object ?? {}) as StripeCharge;
  const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
  if (!paymentIntentId) return { handled: false, reason: "no-payment-intent" };

  const found = await findOrderByIntent(admin, paymentIntentId);
  if (!found) return { handled: false, reason: "no-order" };
  const { order, target } = found;

  if (target === "duplicate") {
    if (!order.duplicate_resolved_at) {
      const { error } = await admin
        .from("orders")
        .update({ duplicate_resolved_at: eventIso(event) })
        .eq("id", order.id);
      if (error) throw new Error(error.message);
      await insertEvent(admin, {
        orderId: order.id,
        kind: "note",
        actor: "system",
        visible: false,
        title: "Duplicate payment refunded in Stripe",
      });
    }
    return { handled: true, reason: "duplicate-refunded", orderId: order.id };
  }

  const refundedAtIso = eventIso(event);
  const stripeTotal = Math.min(charge.amount_refunded ?? 0, order.amount_cents);
  const result = await recordRefund(admin, order, {
    deltaCents: stripeTotal - order.refunded_cents,
    note: null,
    refundedAtIso,
    actor: "system",
    visibleToCustomer: true,
  });
  if (!result.applied) {
    if (result.error) throw new Error(result.error);
    return { handled: false, reason: "refund-already-recorded", orderId: order.id };
  }
  after(async () => {
    const fresh = (await readOrder(admin, order.id)) ?? order;
    await emailCustomer(admin, fresh, "E8", {
      refundDeltaCents: result.deltaCents,
      refundTotalCents: result.totalCents,
      refundedAtIso,
    });
  });
  return { handled: true, reason: result.full ? "refunded" : "partly-refunded", orderId: order.id };
}

async function handleDispute(
  admin: Admin,
  event: StripeEvent & { type: string },
  settings: CommerceSettings,
): Promise<Handled> {
  const dispute = (event.data?.object ?? {}) as StripeDispute;
  const paymentIntentId = paymentIntentIdOf(dispute.payment_intent);
  if (!paymentIntentId) return { handled: false, reason: "no-payment-intent" };

  const found = await findOrderByIntent(admin, paymentIntentId);
  if (!found) return { handled: false, reason: "no-order" };

  const notice = await applyDisputeEvent(
    admin,
    found.order,
    event.type as DisputeEventType,
    dispute,
    found.target,
    eventIso(event),
    settings,
  );
  if (notice) after(notice);
  return { handled: true, reason: event.type, orderId: found.order.id };
}

export async function POST(req: Request) {
  // 1. RAW BODY FIRST, and never req.json().
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 2. VERIFY BEFORE ANYTHING ELSE.
  const verified = verifyStripeSignature({
    rawBody,
    header: req.headers.get("stripe-signature"),
    secret: process.env.STRIPE_ORDERS_WEBHOOK_SECRET,
  });
  if (!verified.ok) {
    if (verified.reason === "no-secret") {
      console.error(
        "[orders] STRIPE_ORDERS_WEBHOOK_SECRET is not set, so card orders cannot be " +
          "confirmed by webhook. Every webhook will be refused until it is configured.",
      );
    } else {
      console.warn("[orders] rejected an unverified webhook:", verified.reason);
    }
    return NextResponse.json({ received: false }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 3. Anything we do not handle is acknowledged and dropped.
  if (!event.type || !HANDLED_EVENTS.has(event.type) || !event.id) {
    return NextResponse.json({ received: true, handled: false });
  }
  const known = event as StripeEvent & { id: string; type: string };

  const admin = createAdminClient();

  // 4. THE LEDGER, before any other read.
  const stop = await claimEvent(admin, known);
  if (stop) return stop;

  try {
    const settings = await loadCommerceSettings(admin);
    let result: Handled;
    if (SESSION_EVENTS.has(known.type)) {
      result = await handleSessionEvent(admin, known, settings);
    } else if (known.type === "charge.refunded") {
      result = await handleRefund(admin, known);
    } else {
      result = await handleDispute(admin, known, settings);
    }
    return await finish(admin, known.id, result);
  } catch (err) {
    console.error("[orders] webhook write failed", known.id, err);
    // completed_at stays null, so the retry is processed again.
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
