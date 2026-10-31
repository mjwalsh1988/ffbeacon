"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { bustMemo } from "@/lib/memo-ttl";
import { createAdminClient } from "@/lib/supabase/server";
import { loadSleeperHandleForUser } from "@/lib/sleeper-handle/resolve";
import { loadRosters } from "@/lib/power-pulse/load";
import { buildTeamReviewContext, readLeagueRow } from "@/lib/commerce/context";
import { couponInputSchema, saveCoupon } from "@/lib/commerce/coupons";
import { lookupCustomers, searchCustomers } from "@/lib/commerce/customers";
import {
  beginAttachment,
  deleteDeliverable,
  finalizeAttachment,
  listDeliverables,
  publishAll,
  retryAttachment,
  saveSection,
} from "@/lib/commerce/deliverables";
import { OFFER_MEMO_KEY } from "@/lib/commerce/offer";
import {
  createOrder,
  emailCustomer,
  insertEvent,
  markPaidIfWon,
  readOrder,
  recordRefund,
  sendReceipt,
} from "@/lib/commerce/orders";
import { reconcileStripeOrder } from "@/lib/commerce/reconcile";
import {
  loadActiveProducts,
  priceCentsFromText,
  productInputSchema,
  saveProduct,
  snapshotProduct,
} from "@/lib/commerce/products";
import {
  COMMERCE_SETTINGS_MEMO_KEY,
  loadCommerceSettings,
  saveCommerceSettings,
  validateCommerceSettings,
} from "@/lib/commerce/settings";
import { closeOpenSession } from "@/lib/commerce/stripe";
import {
  canTransitionFulfillment,
  canTransitionPayment,
  FULFILLMENT_LABEL,
} from "@/lib/commerce/transitions";
import type { FulfillmentStatus, Order, OrderDeliverable } from "@/lib/commerce/types";
import type { OrderEmailExtra, OrderEmailTemplate } from "@/lib/email/order-emails";

/**
 * Every admin action. Each calls requireAdmin first, then validates, then writes.
 * Admin actions are not metered: requireAdmin is the door.
 *
 * Refunds are RECORDED here and never performed: the money moves in the processor,
 * and nothing in this file can send it anywhere.
 */

const BASE = "/admin/orders";
const UUID = /^[0-9a-f-]{36}$/;

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const NOT_FOUND: ActionResult = { ok: false, error: "That order was not found." };

function orderPage(orderId: string): string {
  return `${BASE}/${orderId}`;
}

function refresh(orderId: string): void {
  revalidatePath(orderPage(orderId));
  revalidatePath(BASE);
  revalidatePath(`/my-beacon/orders/${orderId}`);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function setFulfillmentStatusAction(
  orderId: unknown,
  to: unknown,
  note: unknown,
  notify: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > 1000) return { ok: false, error: "Keep the note under 1000 characters." };
  if (notify === true && !text) return { ok: false, error: "Type a note to email the customer." };

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  const target = to as FulfillmentStatus;
  if (!(target in FULFILLMENT_LABEL) || !canTransitionFulfillment(order.fulfillment_status, target)) {
    return { ok: false, error: "That status change is not allowed from here." };
  }
  // Delivery is publishDeliveryAction, which publishes and sends the email, and
  // paid is the payment's to set. An unpaid order is cancelled from the Payment
  // panel, which also closes its Stripe session.
  if (target === "delivered" || order.fulfillment_status === "pending_payment") {
    return { ok: false, error: "That status change is not allowed from here." };
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("orders")
    .update({
      fulfillment_status: target,
      ...(target === "in_progress" && !order.started_at ? { started_at: now } : {}),
    })
    .eq("id", order.id)
    .eq("fulfillment_status", order.fulfillment_status)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The status changed under you. Refresh and try again." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "status_changed",
    actor: "admin",
    actorUserId: userId,
    title:
      target === "in_progress"
        ? "Michael started your review"
        : `Status changed to ${FULFILLMENT_LABEL[target].word}`,
    body: text || null,
    data: { from: order.fulfillment_status, to: target },
  });

  if (notify === true) {
    after(async () => {
      await emailCustomer(admin, order, "E4", { note: text, toStatus: target }, "admin", userId);
    });
  }
  refresh(order.id);
  return { ok: true, message: `Status updated to ${FULFILLMENT_LABEL[target].word}.` };
}

export async function confirmManualPaymentAction(
  orderId: unknown,
  reference: unknown,
  paidAtIso?: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const ref = typeof reference === "string" ? reference.trim() : "";
  if (ref.length > 120) return { ok: false, error: "Keep the reference under 120 characters." };
  const paidAt =
    typeof paidAtIso === "string" && paidAtIso && !Number.isNaN(Date.parse(paidAtIso))
      ? new Date(paidAtIso).toISOString()
      : new Date().toISOString();

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  const settings = await loadCommerceSettings(admin);

  // Confirming a card order must not leave its page payable. A mismatch is already
  // a completed session, and confirming it anyway is the point of that button.
  if (order.payment_method === "stripe" && order.mismatch_amount_cents == null) {
    const closed = await closeOpenSession(order);
    if (closed === "paid") {
      const result = await reconcileStripeOrder(admin, order, settings);
      if (result === "paid") {
        refresh(order.id);
        return { ok: true, message: "Stripe had this payment. Recorded." };
      }
      // Stripe says the session is paid but the read-back declined (outside its
      // window, or throttled). The admin is looking at the payment, so the manual
      // confirm below records it rather than reporting a write that never happened.
    }
    if (closed === "pending") {
      return { ok: false, error: "Stripe is still confirming this payment. Wait for it." };
    }
    if (closed === "failed") {
      return { ok: false, error: "We could not reset the card payment page. Try again in a minute." };
    }
  }

  const marked = await markPaidIfWon(admin, order, settings, {
    paidVia: "manual",
    reference: ref || null,
    paidAtIso: paidAt,
    // A card order confirmed by hand still needs its intent, or a later refund or
    // chargeback could not find the order.
    paymentIntentId: ref.startsWith("pi_") ? ref : null,
    actor: "admin",
    actorUserId: userId,
    title: "Payment confirmed",
    via: order.payment_method,
  });
  if (!marked.won) {
    return {
      ok: false,
      error: marked.error ?? "This order is not waiting for a payment. Refresh the page.",
    };
  }
  after(marked.followUp);
  refresh(order.id);
  return { ok: true, message: "Payment confirmed." };
}

export async function markPaymentNotFoundAction(
  orderId: unknown,
  note: unknown,
  notify: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > 1000) return { ok: false, error: "Keep the note under 1000 characters." };

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  if (order.payment_status !== "awaiting_confirmation") {
    return { ok: false, error: "This order is not waiting for a confirmation." };
  }

  // The customer gets a fresh window: the cron must not close this order an hour
  // after the email asking them to check the payment.
  const settings = await loadCommerceSettings(admin);
  const expiresAt = new Date(
    Date.now() + settings.payments.manualExpiryDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: moved, error } = await admin
    .from("orders")
    .update({ customer_reported_paid_at: null, expires_at: expiresAt, reminder_sent_at: null })
    .eq("id", order.id)
    .eq("payment_status", "awaiting_confirmation")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  // Another admin confirmed or cancelled it between the page load and this press.
  // Writing the event and the email now would tell a paid customer we lost their money.
  if (!moved) return { ok: false, error: "The order changed under you. Refresh and try again." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_not_found",
    actor: "admin",
    actorUserId: userId,
    title: "We could not find this payment yet",
    body: text || null,
  });
  if (notify === true) {
    after(async () => {
      await emailCustomer(admin, order, "E7", { failure: "not-found", note: text }, "admin", userId);
    });
  }
  refresh(order.id);
  return { ok: true, message: "Marked as not received." };
}

export async function cancelOrderAction(
  orderId: unknown,
  note: unknown,
  notify: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > 1000) return { ok: false, error: "Keep the note under 1000 characters." };

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  if (!canTransitionPayment(order.payment_status, "cancelled")) {
    return { ok: false, error: "A paid order cannot be canceled. Record a refund instead." };
  }

  if (order.payment_method === "stripe") {
    const closed = await closeOpenSession(order);
    if (closed === "paid") {
      await reconcileStripeOrder(admin, order, await loadCommerceSettings(admin));
      refresh(order.id);
      return { ok: false, error: "This order has just been paid. Refresh the page." };
    }
    if (closed === "pending") {
      return { ok: false, error: "Stripe is still confirming this payment. Wait for it." };
    }
    if (closed === "failed") {
      return { ok: false, error: "We could not reset the card payment page. Try again in a minute." };
    }
  }

  const { data, error } = await admin
    .from("orders")
    .update({
      payment_status: "cancelled",
      fulfillment_status: "cancelled",
      cancelled_at: new Date().toISOString(),
      mismatch_amount_cents: null,
    })
    .eq("id", order.id)
    .in("payment_status", ["unpaid", "awaiting_confirmation", "expired"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The order changed under you. Refresh and try again." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "payment_cancelled",
    actor: "admin",
    actorUserId: userId,
    title: "Order canceled",
    body: text || null,
  });
  if (notify === true) {
    after(async () => {
      await emailCustomer(admin, order, "E9", { note: text }, "admin", userId);
    });
  }
  refresh(order.id);
  return { ok: true, message: "Order canceled." };
}

export async function recordRefundAction(
  orderId: unknown,
  amountCents: unknown,
  note: unknown,
  notify: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > 500) return { ok: false, error: "Keep the note under 500 characters." };

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  const left = order.amount_cents - order.refunded_cents;
  if (
    typeof amountCents !== "number" ||
    !Number.isInteger(amountCents) ||
    amountCents < 1 ||
    amountCents > left
  ) {
    return { ok: false, error: "Enter an amount between one cent and what is left to refund." };
  }

  const refundedAtIso = new Date().toISOString();
  const result = await recordRefund(admin, order, {
    deltaCents: amountCents,
    note: text || null,
    refundedAtIso,
    actor: "admin",
    actorUserId: userId,
    visibleToCustomer: true,
  });
  if (!result.applied) {
    return { ok: false, error: result.error ?? "Nothing was recorded. Refresh and try again." };
  }
  if (notify === true) {
    after(async () => {
      const fresh = (await readOrder(admin, order.id)) ?? order;
      await emailCustomer(
        admin,
        fresh,
        "E8",
        {
          refundDeltaCents: result.deltaCents,
          refundTotalCents: result.totalCents,
          refundedAtIso,
        },
        "admin",
        userId,
      );
    });
  }
  refresh(order.id);
  return { ok: true, message: "Refund recorded." };
}

export async function resolveDuplicatePaymentAction(orderId: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .update({ duplicate_resolved_at: new Date().toISOString() })
    .eq("id", orderId)
    .not("duplicate_payment_intent_id", "is", null)
    .is("duplicate_resolved_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "There is no open duplicate on this order." };

  await insertEvent(admin, {
    orderId,
    kind: "note",
    actor: "admin",
    actorUserId: userId,
    visible: false,
    title: "Duplicate payment marked refunded",
  });
  refresh(orderId);
  return { ok: true, message: "Duplicate marked refunded." };
}

function receiptable(order: Pick<Order, "payment_status">): boolean {
  return order.payment_status === "paid" || order.payment_status === "refunded";
}

export async function resendReceiptAction(orderId: unknown): Promise<ActionResult> {
  await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  // A stale tab must not send "Payment received" to someone who has not paid.
  if (!receiptable(order)) return { ok: false, error: "This order has not been paid, so there is no receipt to send." };
  const status = await sendReceipt(admin, orderId);
  refresh(orderId);
  if (status === "sent") return { ok: true, message: "Receipt sent." };
  return { ok: false, error: `The receipt was not sent (${status ?? "no order"}).` };
}

export async function addInternalNoteAction(
  orderId: unknown,
  body: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: "Type a note first." };
  if (text.length > 5000) return { ok: false, error: "Keep the note under 5000 characters." };

  await insertEvent(createAdminClient(), {
    orderId,
    kind: "note",
    actor: "admin",
    actorUserId: userId,
    visible: false,
    title: "Internal note",
    body: text,
  });
  refresh(orderId);
  return { ok: true, message: "Note saved." };
}

const sectionSchema = z.object({
  id: z.string().regex(UUID).nullable(),
  orderId: z.string().regex(UUID),
  title: z.string().trim().min(1, "Give the section a title.").max(120),
  body: z.string().max(20_000),
  sortOrder: z.number().int().min(0).max(100_000),
});

export async function saveDeliverableSectionAction(raw: unknown): Promise<ActionResult> {
  await requireAdmin(BASE);
  const parsed = sectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the section." };
  }
  const result = await saveSection(createAdminClient(), parsed.data);
  if (!result.ok) return result;
  refresh(parsed.data.orderId);
  return { ok: true, message: "Section saved." };
}

/** One step up or down, by swapping sort orders with the neighbor. */
export async function moveDeliverableAction(
  orderId: unknown,
  deliverableId: unknown,
  direction: unknown,
): Promise<ActionResult> {
  await requireAdmin(BASE);
  if (!isUuid(orderId) || !isUuid(deliverableId)) return NOT_FOUND;
  const admin = createAdminClient();
  const rows = (await listDeliverables(admin, orderId)).filter((d) => d.kind === "section");
  const index = rows.findIndex((d) => d.id === deliverableId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= rows.length) return { ok: true };

  // Renumbered in full, so two sections that share a default order still move.
  const order = rows.map((d) => d.id);
  [order[index], order[swapWith]] = [order[swapWith], order[index]];
  for (let i = 0; i < order.length; i++) {
    const { error } = await admin
      .from("order_deliverables")
      .update({ sort_order: (i + 1) * 10 })
      .eq("id", order[i]);
    if (error) return { ok: false, error: error.message };
  }
  refresh(orderId);
  return { ok: true };
}

async function readDeliverable(id: string): Promise<OrderDeliverable | null> {
  const { data } = await createAdminClient()
    .from("order_deliverables")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as OrderDeliverable | null) ?? null;
}

export async function deleteDeliverableAction(deliverableId: unknown): Promise<ActionResult> {
  await requireAdmin(BASE);
  if (!isUuid(deliverableId)) return { ok: false, error: "That item was not found." };
  const row = await readDeliverable(deliverableId);
  if (!row) return { ok: false, error: "That item was not found." };
  const result = await deleteDeliverable(createAdminClient(), row);
  if (!result.ok) return result;
  refresh(row.order_id);
  return { ok: true, message: "Removed." };
}

export type UploadStart =
  | { ok: true; deliverableId: string; path: string; token: string }
  | { ok: false; error: string };

const uploadSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(100),
  size: z.number().int(),
});

export async function requestAttachmentUploadAction(
  orderId: unknown,
  raw: unknown,
): Promise<UploadStart> {
  await requireAdmin(BASE);
  if (!isUuid(orderId)) return { ok: false, error: "That order was not found." };
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That file type or size is not allowed." };
  const admin = createAdminClient();
  if (!(await readOrder(admin, orderId))) return { ok: false, error: "That order was not found." };
  return beginAttachment(admin, { orderId, ...parsed.data });
}

export async function retryAttachmentUploadAction(deliverableId: unknown): Promise<UploadStart> {
  await requireAdmin(BASE);
  if (!isUuid(deliverableId)) return { ok: false, error: "That file was not found." };
  const row = await readDeliverable(deliverableId);
  if (!row) return { ok: false, error: "That file was not found." };
  return retryAttachment(createAdminClient(), row);
}

export async function finalizeAttachmentAction(deliverableId: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(deliverableId)) return { ok: false, error: "That file was not found." };
  const row = await readDeliverable(deliverableId);
  if (!row) return { ok: false, error: "That file was not found." };

  const admin = createAdminClient();
  const result = await finalizeAttachment(admin, row);
  if (!result.ok) return result;
  await insertEvent(admin, {
    orderId: row.order_id,
    kind: "attachment_added",
    actor: "admin",
    actorUserId: userId,
    visible: false,
    title: `Attached ${row.file_name ?? row.title}`,
  });
  refresh(row.order_id);
  return { ok: true, message: `Uploaded ${row.file_name ?? row.title}.` };
}

async function firstSectionText(orderId: string): Promise<string> {
  const rows = await listDeliverables(createAdminClient(), orderId);
  return rows.find((d) => d.kind === "section")?.body ?? "";
}

export async function publishDeliveryAction(
  orderId: unknown,
  options: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const { acknowledgeChargeback, notify } = (options ?? {}) as {
    acknowledgeChargeback?: unknown;
    notify?: unknown;
  };

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  if (order.payment_status !== "paid") {
    return { ok: false, error: "Only a paid order can be delivered." };
  }
  if (order.dispute_status === "open" && acknowledgeChargeback !== true) {
    return { ok: false, error: "Tick the box to confirm you know a chargeback is open." };
  }

  const rows = await listDeliverables(admin, order.id);
  if (!rows.some((d) => d.kind === "section")) {
    return { ok: false, error: "Add at least one section first." };
  }
  if (rows.some((d) => d.upload_state === "pending")) {
    return { ok: false, error: "An upload did not finish. Retry or remove it first." };
  }

  const now = new Date().toISOString();
  const firstDelivery = !order.delivered_at;
  if (order.fulfillment_status !== "delivered") {
    if (!canTransitionFulfillment(order.fulfillment_status, "delivered")) {
      return { ok: false, error: "That order cannot be delivered from where it is." };
    }
    // Conditional on the status that was read, so two admins publishing at once
    // produce one delivery, one event and one email.
    let move = admin
      .from("orders")
      .update({
        fulfillment_status: "delivered",
        delivered_at: order.delivered_at ?? now,
        started_at: order.started_at ?? now,
      })
      .eq("id", order.id)
      .eq("fulfillment_status", order.fulfillment_status);
    if (firstDelivery) move = move.is("delivered_at", null);
    const { data: moved, error } = await move.select("id").maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!moved) return { ok: false, error: "The order changed under you. Refresh and try again." };
  }
  await publishAll(admin, order.id, now);

  if (firstDelivery) {
    await insertEvent(admin, {
      orderId: order.id,
      kind: "delivered",
      actor: "admin",
      actorUserId: userId,
      title: "Your review is ready",
    });
    const first = rows.find((d) => d.kind === "section")?.body ?? "";
    after(async () => {
      await emailCustomer(admin, order, "E5", { firstSection: first.slice(0, 1300) }, "admin", userId);
    });
    refresh(order.id);
    return { ok: true, message: "Published and marked delivered." };
  }

  await insertEvent(admin, {
    orderId: order.id,
    kind: "delivery_updated",
    actor: "admin",
    actorUserId: userId,
    title: "Michael updated your review",
  });
  if (notify === true) {
    after(async () => {
      await emailCustomer(admin, order, "E12", {}, "admin", userId);
    });
  }
  refresh(order.id);
  return { ok: true, message: "Changes saved." };
}

export async function resendDeliveryEmailAction(orderId: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;
  if (order.fulfillment_status !== "delivered") {
    return { ok: false, error: "This order has not been delivered." };
  }
  const first = await firstSectionText(order.id);
  const sent = await emailCustomer(admin, order, "E5", { firstSection: first.slice(0, 1300) }, "admin", userId);
  refresh(order.id);
  return sent.status === "sent"
    ? { ok: true, message: "Delivery email sent." }
    : { ok: false, error: sent.error ?? "The email was not sent." };
}

/** Rebuild a failed email from what its event recorded. */
export async function resendEventEmailAction(eventId: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(eventId)) return { ok: false, error: "That email was not found." };
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("order_events")
    .select("order_id, kind, data")
    .eq("id", eventId)
    .maybeSingle();
  const data = event?.data as { template?: OrderEmailTemplate; extra?: OrderEmailExtra } | null;
  if (!event || event.kind !== "email_sent" || !data?.template) {
    return { ok: false, error: "That email cannot be rebuilt." };
  }
  const order = await readOrder(admin, event.order_id);
  if (!order) return NOT_FOUND;

  const receipt = data.template === "E1" || data.template === "E3" || data.template === "E13";
  if (receipt && !receiptable(order)) {
    return { ok: false, error: "This order has not been paid, so there is no receipt to send." };
  }
  const status = receipt
    ? await sendReceipt(admin, order.id, data.extra)
    : (await emailCustomer(admin, order, data.template, data.extra ?? {}, "admin", userId)).status;
  refresh(order.id);
  return status === "sent"
    ? { ok: true, message: "Email sent." }
    : { ok: false, error: `The email was not sent (${status ?? "no order"}).` };
}

export async function sendOrderEmailAction(
  orderId: unknown,
  subject: unknown,
  body: unknown,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(BASE);
  if (!isUuid(orderId)) return NOT_FOUND;
  const subjectText = typeof subject === "string" ? subject.trim() : "";
  const bodyText = typeof body === "string" ? body.trim() : "";
  if (!subjectText || subjectText.length > 160) {
    return { ok: false, error: "A subject is 1 to 160 characters." };
  }
  if (!bodyText || bodyText.length > 8000) {
    return { ok: false, error: "A message is 1 to 8000 characters." };
  }

  const admin = createAdminClient();
  const order = await readOrder(admin, orderId);
  if (!order) return NOT_FOUND;

  const sent = await emailCustomer(
    admin,
    order,
    "E11",
    { subject: subjectText, body: bodyText },
    "admin",
    userId,
  );
  const { error } = await admin.from("order_messages").insert({
    order_id: order.id,
    subject: subjectText,
    body_text: bodyText,
    sent_by: userId,
    status: sent.status,
    resend_message_id: sent.resendId,
    error: sent.error,
  });
  if (error) console.error("[orders] message write failed", order.order_number, error.message);
  refresh(order.id);
  return sent.status === "sent"
    ? { ok: true, message: "Email sent." }
    : { ok: false, error: sent.error ?? "The email was not sent." };
}

/** The product form posts dollars as text; the server turns them into cents once. */
function parseProduct(raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const price = priceCentsFromText(typeof body.priceText === "string" ? body.priceText : "");
  if (!price.ok) return { ok: false as const, error: price.error };
  const parsed = productInputSchema.safeParse({ ...body, priceCents: price.cents });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false as const, error: `${issue?.path?.join(".") ?? "product"}: ${issue?.message ?? "invalid"}` };
  }
  return { ok: true as const, input: parsed.data };
}

function productsChanged(): void {
  bustMemo(OFFER_MEMO_KEY);
  revalidatePath(`${BASE}/products`);
}

export async function saveProductAction(raw: unknown): Promise<ActionResult> {
  await requireAdmin(`${BASE}/products`);
  const parsed = parseProduct(raw);
  if (!parsed.ok) return parsed;
  const result = await saveProduct(createAdminClient(), parsed.input);
  if (!result.ok) return result;
  productsChanged();
  return { ok: true, message: "Saved." };
}

export async function createProductAction(raw: unknown): Promise<ActionResult> {
  await requireAdmin(`${BASE}/products`);
  const parsed = parseProduct(raw);
  if (!parsed.ok) return parsed;
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("products")
    .select("id")
    .eq("slug", parsed.input.slug)
    .maybeSingle();
  if (existing) return { ok: false, error: "A product with that slug already exists." };
  const result = await saveProduct(admin, parsed.input);
  if (!result.ok) return result;
  productsChanged();
  return { ok: true, message: "Product added." };
}

async function writeCoupon(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BASE}/coupons`);
  const parsed = couponInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the coupon." };
  }
  const result = await saveCoupon(createAdminClient(), parsed.data, userId);
  if (!result.ok) return result;
  revalidatePath(`${BASE}/coupons`);
  return { ok: true, message: "Saved." };
}

export async function saveCouponAction(raw: unknown): Promise<ActionResult> {
  return writeCoupon(raw);
}

export async function createCouponAction(raw: unknown): Promise<ActionResult> {
  return writeCoupon({ ...(raw as object), id: null });
}

export type CustomerMatch = { userId: string; email: string; displayName: string };

export async function searchCustomersAction(q: unknown): Promise<CustomerMatch[]> {
  await requireAdmin(`${BASE}/new`);
  if (typeof q !== "string") return [];
  const admin = createAdminClient();
  const matches = await searchCustomers(admin, q, 20);
  const customers = await lookupCustomers(admin, matches.map((m) => m.userId));
  return matches.map((m) => ({
    userId: m.userId,
    email: m.email,
    displayName: customers.get(m.userId)?.displayName ?? m.email,
  }));
}

export type LeagueTeams =
  | {
      ok: true;
      leagueName: string;
      teams: Array<{
        sleeperRosterId: number;
        rosterRowId: string;
        teamName: string;
        ownerHandle: string | null;
        record: { wins: number; losses: number; ties: number };
      }>;
      matchedRosterId: number | null;
    }
  | { ok: false; error: string };

/** Never syncs a league: the league must already have been opened in League Pulse. */
export async function loadLeagueTeamsAction(
  sleeperLeagueId: unknown,
  customerUserId: unknown,
): Promise<LeagueTeams> {
  await requireAdmin(`${BASE}/new`);
  if (typeof sleeperLeagueId !== "string" || !/^\d{1,20}$/.test(sleeperLeagueId)) {
    return { ok: false, error: "A Sleeper league id is digits only." };
  }
  const admin = createAdminClient();
  const league = await readLeagueRow(admin, sleeperLeagueId);
  if (!league) {
    return {
      ok: false,
      error: `That league has not been opened in League Pulse yet. Open it once at /leagues/${sleeperLeagueId}, then come back.`,
    };
  }
  const rosters = await loadRosters(admin, league.id);
  const handle = isUuid(customerUserId) ? await loadSleeperHandleForUser(admin, customerUserId) : null;
  const matched = handle?.sleeperUserId
    ? (rosters.find((r) => r.ownerUserId === handle.sleeperUserId)?.sleeperRosterId ?? null)
    : null;
  return {
    ok: true,
    leagueName: league.name,
    matchedRosterId: matched,
    teams: rosters
      .map((r) => ({
        sleeperRosterId: r.sleeperRosterId,
        rosterRowId: r.id,
        teamName: r.teamName,
        ownerHandle: r.ownerHandle,
        record: { wins: r.wins, losses: r.losses, ties: r.ties },
      }))
      .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId),
  };
}

const complimentarySchema = z.object({
  userId: z.string().regex(UUID),
  productSlug: z.string().min(1).max(60),
  sleeperLeagueId: z.string().regex(/^\d{1,20}$/),
  rosterId: z.number().int().min(1).max(99),
  customerNote: z.string().trim().max(1000),
  internalNote: z.string().trim().max(5000),
});

export type CreateComplimentaryResult = { ok: true; orderId: string } | { ok: false; error: string };

export async function createComplimentaryOrderAction(
  raw: unknown,
): Promise<CreateComplimentaryResult> {
  const { userId: adminId } = await requireAdmin(`${BASE}/new`);
  const parsed = complimentarySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check the form and try again." };
  const input = parsed.data;

  const admin = createAdminClient();
  const customers = await lookupCustomers(admin, [input.userId]);
  if (!customers.get(input.userId)?.email) {
    return { ok: false, error: "That customer was not found." };
  }

  const product = (await loadActiveProducts(admin)).find((p) => p.slug === input.productSlug);
  if (!product) return { ok: false, error: "That product is not active." };

  const league = await readLeagueRow(admin, input.sleeperLeagueId);
  if (!league) return { ok: false, error: "That league has not been opened in League Pulse yet." };
  const context = await buildTeamReviewContext(admin, league, input.rosterId, null);
  if (!context) return { ok: false, error: "That team is not in that league." };

  // Capacity is not checked: the admin is choosing to do the work.
  const order = await createOrder(admin, {
    userId: input.userId,
    product,
    snapshot: snapshotProduct(product),
    origin: "admin",
    listPriceCents: product.price_cents,
    discountCents: product.price_cents,
    amountCents: 0,
    paymentMethod: "complimentary",
    paymentStatus: "unpaid",
    expiresAt: null,
    couponId: null,
    couponCode: null,
    context,
    intake: { direction: "unsure", questions: "", offLimits: "", contact: "email", providedBy: "admin" },
    createdActor: "admin",
    createdActorUserId: adminId,
    createdTitle: "Michael created this order for you",
  });
  if (!order) return { ok: false, error: "The order could not be created." };

  if (input.internalNote) {
    await insertEvent(admin, {
      orderId: order.id,
      kind: "note",
      actor: "admin",
      actorUserId: adminId,
      visible: false,
      title: "Internal note",
      body: input.internalNote,
    });
  }

  const settings = await loadCommerceSettings(admin);
  const marked = await markPaidIfWon(admin, order, settings, {
    paidVia: "complimentary",
    actor: "admin",
    actorUserId: adminId,
    title: "Complimentary, no payment needed",
    via: "complimentary",
  });
  bustMemo(OFFER_MEMO_KEY);
  revalidatePath(BASE);
  if (!marked.won) {
    // The row exists but never reached paid, so the admin must hear it rather than
    // land on an order that says it is awaiting a payment nobody will make.
    return {
      ok: false,
      error: `Order ${order.order_number} was created but could not be marked paid. Open it from the list and confirm the payment by hand.`,
    };
  }
  // E13 only. The notice to the admin would be telling them what they just did.
  after(async () => {
    await sendReceipt(admin, order.id, { note: input.customerNote });
  });
  return { ok: true, orderId: order.id };
}

export async function saveCommerceSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BASE}/settings`);
  const validated = validateCommerceSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const result = await saveCommerceSettings(createAdminClient(), validated.settings, userId);
  if (!result.ok) return result;

  // Drops this instance's copies; other instances age out inside a minute.
  bustMemo(COMMERCE_SETTINGS_MEMO_KEY);
  bustMemo(OFFER_MEMO_KEY);
  revalidatePath(`${BASE}/settings`);
  revalidatePath(BASE);
  return { ok: true };
}
