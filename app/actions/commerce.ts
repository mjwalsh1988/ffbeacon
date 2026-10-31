"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { resolveSourceSlug } from "@/lib/preferences";
import { stripeConfigured } from "@/lib/stripe/client";
import { normalizeCode, resolveCoupon } from "@/lib/commerce/coupons";
import { buildTeamReviewContext, readLeagueRow } from "@/lib/commerce/context";
import { createOrderInputSchema, intakeSchema } from "@/lib/commerce/intake";
import {
  checkPrice,
  countOpenOrders,
  createOrder,
  emailCustomer,
  findOpenDuplicate,
  insertEvent,
  markPaidIfWon,
  readOrder,
} from "@/lib/commerce/orders";
import { loadActiveProducts, snapshotProduct } from "@/lib/commerce/products";
import { notifyOrderPlaced, notifyPaymentReported, notifyQuestionsAdded } from "@/lib/commerce/notify";
import { reconcileStripeOrder } from "@/lib/commerce/reconcile";
import { loadCommerceSettings } from "@/lib/commerce/settings";
import { closeOpenSession, startStripeCheckout } from "@/lib/commerce/stripe";
import { canTransitionPayment } from "@/lib/commerce/transitions";
import type { Json } from "@/lib/database.types";
import type { Coupon, Order } from "@/lib/commerce/types";

/**
 * Everything a customer can do to an order.
 *
 * The order of the checks is deliberate. Validation is free, so it runs first and
 * garbage never costs a reader their budget; the rate limit is claimed immediately
 * before the expensive step. Server actions are protected by Next's own origin
 * check. The price is never taken from the browser: `expectedCents` is the price
 * the form displayed, compared and never used.
 *
 * Every action on an existing order re-reads it with the service role client and
 * compares `user_id` to the session user before doing anything.
 */

const STRIPE_RETRY_PER_MINUTE = 6;
const UUID = /^[0-9a-f-]{36}$/;

const NOT_YOURS = "We could not find that order.";
const RESET_FAILED = "We could not reset the card payment page. Try again in a minute.";
const SETTLING = "Your bank is still confirming the payment. Nothing more to do; this page updates when it lands.";
const OPEN_FAILED = "We could not open the card payment page. Try again, or pay with PayPal or Venmo.";

export type CreateOrderResult =
  | { ok: true; redirect: string }
  | { ok: false; code: "signin"; next: string; message: string }
  | { ok: false; code: "stale"; message: string }
  | { ok: false; code: "refused"; message: string };

function refused(message: string): CreateOrderResult {
  return { ok: false, code: "refused", message };
}

function orderPath(orderId: string, query = ""): string {
  return `/my-beacon/orders/${orderId}${query}`;
}

export async function createOrderAction(raw: unknown): Promise<CreateOrderResult> {
  const parsed = createOrderInputSchema.safeParse(raw);
  if (!parsed.success) return refused("Check the form and try again.");
  const input = parsed.data;

  // 1. Session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const back = `/leagues/${input.sleeperLeagueId}/review?roster=${input.rosterId}`;
    return {
      ok: false,
      code: "signin",
      message: "Sign in to order.",
      next: `/login?next=${encodeURIComponent(back)}`,
    };
  }

  // 2. Settings.
  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  if (!settings.storefront.enabled) return refused("Reviews are not on sale right now.");
  const method = input.paymentMethod;
  const methodOff =
    (method === "stripe" && (!settings.payments.stripe || !stripeConfigured())) ||
    (method === "paypal" && !settings.payments.paypal) ||
    (method === "venmo" && !settings.payments.venmo);
  if (methodOff) return refused("That payment method is switched off at the moment. Pick another.");

  // 3. Product.
  const products = await loadActiveProducts(admin);
  const product = products.find((p) => p.slug === input.productSlug);
  if (!product) return refused("That review is no longer offered.");

  // 4. Capacity.
  const open = await countOpenOrders(admin, settings);
  if (settings.storefront.fullyBooked || open >= settings.storefront.maxOpenOrders) {
    return refused(settings.storefront.fullyBookedMessage);
  }

  // 5. League and roster.
  const league = await readLeagueRow(admin, input.sleeperLeagueId);
  const missingTeam = "We could not find that team. Open the league again and try once more.";
  if (!league) return refused(missingTeam);

  // 7. Coupon. (6, the intake, passed with the shape: the schema trims and caps.)
  let coupon: Coupon | null = null;
  let discountCents = 0;
  if (input.couponCode.trim() !== "") {
    if (!settings.coupons.enabled) return refused("That code is not valid.");
    const resolved = await resolveCoupon(admin, input.couponCode, product, user.id);
    if (!resolved.ok) return refused(resolved.message);
    coupon = resolved.coupon;
    discountCents = resolved.discountCents;
  }

  // 8. Price.
  const price = checkPrice({
    listPriceCents: product.price_cents,
    discountCents,
    expectedCents: input.expectedCents,
    paymentMethod: method,
  });
  if (!price.ok) {
    return {
      ok: false,
      code: "stale",
      message: "The price changed while this page was open. Review it and order again.",
    };
  }

  // 9. Duplicate guard. A paid order for the same team is not a duplicate.
  const existing = await findOpenDuplicate(admin, {
    userId: user.id,
    productId: product.id,
    sleeperLeagueId: input.sleeperLeagueId,
    rosterId: input.rosterId,
  });
  if (existing) return { ok: true, redirect: orderPath(existing) };

  // 10. Rate limit.
  const allowed = await claimRateLimitSlot({
    bucket: "order-checkout",
    max: settings.rateLimits.checkoutPerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return refused("That is a lot of orders in one minute. Give it a moment and try again.");

  // 11. Context.
  const source = await resolveSourceSlug(supabase, input.sourceSlug ?? undefined);
  const context = await buildTeamReviewContext(admin, league, input.rosterId, source.slug);
  if (!context) return refused(missingTeam);

  // 12. The insert.
  const now = Date.now();
  const paymentMethod = price.complimentary ? "complimentary" : (method as Order["payment_method"]);
  const manual = paymentMethod === "paypal" || paymentMethod === "venmo";
  const expiresAt = price.complimentary
    ? null
    : new Date(
        now +
          (manual
            ? settings.payments.manualExpiryDays * 24 * 60 * 60 * 1000
            : settings.payments.stripeUnpaidExpiryHours * 60 * 60 * 1000),
      ).toISOString();

  const order = await createOrder(admin, {
    userId: user.id,
    product,
    snapshot: snapshotProduct(product),
    origin: "customer",
    listPriceCents: product.price_cents,
    discountCents,
    amountCents: price.amountCents,
    paymentMethod,
    paymentStatus: manual ? "awaiting_confirmation" : "unpaid",
    expiresAt,
    couponId: coupon?.id ?? null,
    couponCode: coupon?.code ?? null,
    context,
    intake: { ...input.intake, contact: "email" },
    createdActor: "system",
    createdTitle: "Order placed",
  });
  if (!order) return refused("We could not place the order. Try again in a moment.");

  // 13. A code that covers the whole price: no payment step.
  if (price.complimentary) {
    const marked = await markPaidIfWon(admin, order, settings, {
      paidVia: "coupon",
      reference: coupon?.code ?? null,
      actor: "system",
      title: "No payment needed",
      via: "coupon",
    });
    if (marked.won) after(marked.followUp);
    return { ok: true, redirect: orderPath(order.id) };
  }

  // 14. Stripe. On failure the order stays unpaid, and the order page says so.
  if (paymentMethod === "stripe") {
    const started = await startStripeCheckout(admin, order, user.email ?? null, settings);
    if (started.kind === "redirect") return { ok: true, redirect: started.url };
    return { ok: true, redirect: orderPath(order.id, "?pay=failed") };
  }

  // 15. PayPal or Venmo.
  const word = paymentMethod === "paypal" ? "PayPal" : "Venmo";
  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_pending",
    actor: "system",
    title: `Waiting for your ${word} payment`,
  });
  after(async () => {
    await emailCustomer(admin, order, "E2");
    await notifyOrderPlaced(admin, order, settings);
  });
  return { ok: true, redirect: orderPath(order.id) };
}

export type CouponPreview =
  | { ok: true; discountCents: number; amountCents: number; code: string }
  | { ok: false; message: string };

/**
 * What a code would take off, for the form. Never trusted: `createOrderAction`
 * resolves the code again. The claim comes after the shape check, so junk costs
 * nothing, and it is what stops the table being enumerated.
 */
export async function previewCouponAction(
  productSlug: unknown,
  code: unknown,
): Promise<CouponPreview> {
  if (typeof productSlug !== "string" || typeof code !== "string") {
    return { ok: false, message: "That code is not valid." };
  }
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, message: "That code is not valid." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to use a code." };

  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  if (!settings.coupons.enabled) return { ok: false, message: "That code is not valid." };

  const allowed = await claimRateLimitSlot({
    bucket: "order-coupon-preview",
    max: settings.rateLimits.couponPreviewPerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return { ok: false, message: "That is a lot of tries. Give it a minute." };

  const products = await loadActiveProducts(admin);
  const product = products.find((p) => p.slug === productSlug);
  if (!product) return { ok: false, message: "That review is no longer offered." };

  const result = await resolveCoupon(admin, normalized, product, user.id);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    discountCents: result.discountCents,
    amountCents: Math.max(0, product.price_cents - result.discountCents),
    code: normalized,
  };
}

type Owned = { userId: string; email: string | null; order: Order };

/** The session user's own order, or null. Read with the service role, then compared. */
async function ownedOrder(orderId: unknown): Promise<Owned | null> {
  if (typeof orderId !== "string" || !UUID.test(orderId)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const order = await readOrder(createAdminClient(), orderId);
  if (!order || order.user_id !== user.id) return null;
  return { userId: user.id, email: user.email ?? null, order };
}

export type ActionResult = { ok: true; redirect?: string } | { ok: false; message: string };

/**
 * Reopening an expired order is a new purchase in all but name: it released its
 * place and its code when it expired, so the door and the code are checked again.
 */
async function reopenRefusal(order: Order, userId: string): Promise<string | null> {
  if (order.payment_status !== "expired") return null;
  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  if (!settings.storefront.enabled) return "Reviews are not on sale right now.";
  const open = await countOpenOrders(admin, settings);
  if (settings.storefront.fullyBooked || open >= settings.storefront.maxOpenOrders) {
    return settings.storefront.fullyBookedMessage;
  }
  const products = await loadActiveProducts(admin);
  const product = products.find((p) => p.id === order.product_id);
  if (!product) return "That review is no longer offered.";
  if (order.coupon_code) {
    const coupon = await resolveCoupon(admin, order.coupon_code, product, userId);
    if (!coupon.ok) return `${coupon.message} Start a new order from the Blueprint.`;
  }
  return null;
}

function claimStripeRetry(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: "order-stripe-retry",
    max: STRIPE_RETRY_PER_MINUTE,
    windowSeconds: 60,
  });
}

/** The money has already arrived on the session: record it and go to the order. */
async function settleClosedSession(order: Order): Promise<ActionResult> {
  const admin = createAdminClient();
  await reconcileStripeOrder(admin, order, await loadCommerceSettings(admin));
  revalidatePath(orderPath(order.id));
  return { ok: true, redirect: orderPath(order.id) };
}

export async function startStripeCheckoutAction(orderId: unknown): Promise<ActionResult> {
  const owned = await ownedOrder(orderId);
  if (!owned) return { ok: false, message: NOT_YOURS };
  const { order, email } = owned;
  if (
    order.payment_method !== "stripe" ||
    (order.payment_status !== "unpaid" && order.payment_status !== "expired")
  ) {
    return { ok: false, message: "This order is not waiting for a card payment." };
  }

  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  if (!settings.payments.stripe || !stripeConfigured()) {
    return { ok: false, message: "That payment method is switched off at the moment. Pick another." };
  }
  const refusal = await reopenRefusal(order, owned.userId);
  if (refusal) return { ok: false, message: refusal };
  if (!(await claimStripeRetry())) {
    return { ok: false, message: "That is a lot of tries in one minute. Give it a moment." };
  }

  const started = await startStripeCheckout(admin, order, email, settings);
  switch (started.kind) {
    case "redirect":
      return { ok: true, redirect: started.url };
    case "already-paid":
      return settleClosedSession(order);
    case "pending":
      return { ok: false, message: SETTLING };
    case "reset-failed":
      return { ok: false, message: RESET_FAILED };
    case "failed":
      return { ok: false, message: OPEN_FAILED };
  }
}

export async function switchPaymentMethodAction(
  orderId: unknown,
  method: unknown,
): Promise<ActionResult> {
  if (method !== "paypal" && method !== "venmo") {
    return { ok: false, message: "Pick PayPal or Venmo." };
  }
  const owned = await ownedOrder(orderId);
  if (!owned) return { ok: false, message: NOT_YOURS };
  const { order } = owned;
  if (
    order.payment_method !== "stripe" ||
    (order.payment_status !== "unpaid" && order.payment_status !== "expired")
  ) {
    return { ok: false, message: "This order cannot switch payment method now." };
  }

  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  if (!settings.payments[method]) {
    return { ok: false, message: "That payment method is switched off at the moment. Pick another." };
  }
  const refusal = await reopenRefusal(order, owned.userId);
  if (refusal) return { ok: false, message: refusal };
  if (!(await claimStripeRetry())) {
    return { ok: false, message: "That is a lot of tries in one minute. Give it a moment." };
  }

  const closed = await closeOpenSession(order);
  if (closed === "paid") return settleClosedSession(order);
  if (closed === "pending") return { ok: false, message: SETTLING };
  if (closed === "failed") return { ok: false, message: RESET_FAILED };

  const expiresAt = new Date(
    Date.now() + settings.payments.manualExpiryDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await admin
    .from("orders")
    .update({ payment_method: method, payment_status: "awaiting_confirmation", expires_at: expiresAt })
    .eq("id", order.id)
    .in("payment_status", ["unpaid", "expired"])
    .select("*")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "We could not switch that. Refresh and try again." };

  const word = method === "paypal" ? "PayPal" : "Venmo";
  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_pending",
    actor: "customer",
    actorUserId: owned.userId,
    title: `Waiting for your ${word} payment`,
  });
  const fresh = data as unknown as Order;
  after(async () => {
    await emailCustomer(admin, fresh, "E2");
  });
  revalidatePath(orderPath(order.id));
  return { ok: true };
}

export async function cancelOwnOrderAction(orderId: unknown): Promise<ActionResult> {
  const owned = await ownedOrder(orderId);
  if (!owned) return { ok: false, message: NOT_YOURS };
  const { order } = owned;
  if (!canTransitionPayment(order.payment_status, "cancelled")) {
    return { ok: false, message: "This order cannot be canceled here." };
  }
  // A reported PayPal or Venmo payment may already be on its way. Cancelling here
  // would leave money with nowhere to land, so the admin decides instead.
  if (order.customer_reported_paid_at) {
    return {
      ok: false,
      message:
        "You said the payment was sent, so this order waits for Michael to check. Write to michael@ffbeacon.com if you want it canceled.",
    };
  }
  if (!(await claimStripeRetry())) {
    return { ok: false, message: "That is a lot of tries in one minute. Give it a moment." };
  }

  // The abandoned page must not stay payable. A complete answer means the money
  // has arrived, so the cancel is refused rather than ignored.
  if (order.payment_method === "stripe") {
    const closed = await closeOpenSession(order);
    if (closed === "paid") {
      await settleClosedSession(order);
      return { ok: false, message: "This order has just been paid. Refresh the page." };
    }
    if (closed === "pending") return { ok: false, message: SETTLING };
    if (closed === "failed") return { ok: false, message: RESET_FAILED };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .update({
      payment_status: "cancelled",
      fulfillment_status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .in("payment_status", ["unpaid", "awaiting_confirmation", "expired"])
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "We could not cancel that. Refresh and try again." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_cancelled",
    actor: "customer",
    actorUserId: owned.userId,
    title: "You canceled this order",
  });
  revalidatePath(orderPath(order.id));
  return { ok: true };
}

export async function reportManualPaymentAction(
  orderId: unknown,
  reference: unknown,
): Promise<ActionResult> {
  const text = typeof reference === "string" ? reference.trim() : "";
  if (text.length > 120) return { ok: false, message: "Keep that under 120 characters." };

  const owned = await ownedOrder(orderId);
  if (!owned) return { ok: false, message: NOT_YOURS };
  const { order } = owned;
  if (order.payment_status !== "awaiting_confirmation") {
    return { ok: false, message: "This order is not waiting for a payment." };
  }
  if (order.customer_reported_paid_at) return { ok: false, message: "Already reported." };

  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  const allowed = await claimRateLimitSlot({
    bucket: "order-report",
    max: settings.rateLimits.reportPaymentPerMinute,
    windowSeconds: 60,
  });
  if (!allowed) return { ok: false, message: "That is a lot of tries in one minute. Give it a moment." };

  const { data, error } = await admin
    .from("orders")
    .update({
      customer_reported_paid_at: new Date().toISOString(),
      external_payment_reference: text || null,
    })
    .eq("id", order.id)
    .eq("payment_status", "awaiting_confirmation")
    .is("customer_reported_paid_at", null)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, message: "We could not save that. Try again." };
  if (!data) return { ok: false, message: "Already reported." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_reported",
    actor: "customer",
    actorUserId: owned.userId,
    title: "You said the payment was sent",
  });
  const fresh = data as unknown as Order;
  after(() => notifyPaymentReported(admin, fresh, settings));
  revalidatePath(orderPath(order.id));
  return { ok: true };
}

/** A customer's answers on a complimentary order, while the review is still queued. */
export async function updateIntakeAction(orderId: unknown, raw: unknown): Promise<ActionResult> {
  const parsed = intakeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Check the form and try again." };

  const owned = await ownedOrder(orderId);
  if (!owned) return { ok: false, message: NOT_YOURS };
  const { order } = owned;
  if (order.intake.providedBy !== "admin") {
    return { ok: false, message: "The questions on this order are already set." };
  }
  if (order.fulfillment_status !== "queued") {
    return { ok: false, message: "Michael has started, so the questions are fixed." };
  }

  const admin = createAdminClient();
  const settings = await loadCommerceSettings(admin);
  const intake = { ...parsed.data, contact: "email", providedBy: "admin" };
  const { data, error } = await admin
    .from("orders")
    .update({ intake: intake as unknown as Json })
    .eq("id", order.id)
    .eq("fulfillment_status", "queued")
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, message: "We could not save that. Try again." };
  if (!data) return { ok: false, message: "Michael has started, so the questions are fixed." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "intake_updated",
    actor: "customer",
    actorUserId: owned.userId,
    title: "You added your questions",
  });
  const fresh = data as unknown as Order;
  after(() => notifyQuestionsAdded(admin, fresh, settings));
  revalidatePath(orderPath(order.id));
  return { ok: true };
}
