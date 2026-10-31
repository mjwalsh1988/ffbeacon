/**
 * The admin's notices, A1 to A7.
 *
 * The ONE place in the store that sets `replyTo`: a notice is addressed to Michael
 * and a reply from his inbox should reach the customer. Customer messages never set
 * it, so they take the default. lib/email/reply-to-guard.test.ts names this file
 * and nothing else in lib/commerce.
 *
 * The duplicate, mismatch and chargeback notices have no switch: they are always
 * sent. Logs carry order numbers, never an address.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sendEmail } from "@/lib/email/send";
import {
  buildAdminAmountMismatch,
  buildAdminDisputeClosed,
  buildAdminDisputeOpened,
  buildAdminDuplicatePayment,
  buildAdminOrderPaid,
  buildAdminOrderPlaced,
  buildAdminPaymentReported,
  buildAdminQuestionsAdded,
  type BuiltEmail,
} from "@/lib/email/order-emails";
import { SELLER_EMAIL } from "./constants";
import { lookupCustomers } from "./customers";
import type { CommerceSettings } from "./default-settings";
import { loadCustomerHistory, readOrder } from "./orders";
import type { Order } from "./types";

type Client = SupabaseClient<Database>;

/** Settings first, the environment second, the constant third. */
export function adminEmailFor(settings: CommerceSettings | null): string {
  return (
    settings?.notifications.adminEmail ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    SELLER_EMAIL
  );
}

async function sendNotice(
  admin: Client,
  order: Pick<Order, "order_number" | "user_id">,
  settings: CommerceSettings | null,
  email: BuiltEmail,
): Promise<void> {
  let replyTo: string | null | undefined;
  if (order.user_id) {
    const customers = await lookupCustomers(admin, [order.user_id]);
    replyTo = customers.get(order.user_id)?.email ?? undefined;
  }
  const result = await sendEmail({
    to: adminEmailFor(settings),
    subject: email.subject,
    html: email.html,
    text: email.text,
    replyTo,
  });
  if (!result.ok && !result.skipped) {
    console.error("[orders] admin notice failed", order.order_number, result.error);
  }
}

/** A1, only when `notifyOnNew`. */
export async function notifyOrderPlaced(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
): Promise<void> {
  if (!settings.notifications.notifyOnNew) return;
  await sendNotice(admin, order, settings, buildAdminOrderPlaced(order));
}

/** A2, only when `notifyOnPaid`. */
export async function notifyOrderPaid(
  admin: Client,
  orderId: string,
  settings: CommerceSettings,
): Promise<void> {
  if (!settings.notifications.notifyOnPaid) return;
  const order = await readOrder(admin, orderId);
  if (!order) return;
  const [customers, history] = await Promise.all([
    lookupCustomers(admin, [order.user_id]),
    loadCustomerHistory(admin, order.user_id, order.id),
  ]);
  const customer = order.user_id ? customers.get(order.user_id) : undefined;
  await sendNotice(
    admin,
    order,
    settings,
    buildAdminOrderPaid(
      order,
      { displayName: customer?.displayName ?? "Unknown", email: customer?.email ?? null },
      history.openChargebacksElsewhere,
    ),
  );
}

/** A3, only when `notifyOnReported`. */
export async function notifyPaymentReported(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
): Promise<void> {
  if (!settings.notifications.notifyOnReported) return;
  await sendNotice(admin, order, settings, buildAdminPaymentReported(order));
}

export async function notifyQuestionsAdded(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
): Promise<void> {
  await sendNotice(admin, order, settings, buildAdminQuestionsAdded(order));
}

/** A4. Always sent. */
export async function notifyDuplicatePayment(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  args: Parameters<typeof buildAdminDuplicatePayment>[1],
): Promise<void> {
  await sendNotice(admin, order, settings, buildAdminDuplicatePayment(order, args));
}

/** A5. Always sent. */
export async function notifyAmountMismatch(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  args: Parameters<typeof buildAdminAmountMismatch>[1],
): Promise<void> {
  await sendNotice(admin, order, settings, buildAdminAmountMismatch(order, args));
}

/** A6. Always sent. */
export async function notifyDisputeOpened(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  args: Parameters<typeof buildAdminDisputeOpened>[1],
): Promise<void> {
  await sendNotice(admin, order, settings, buildAdminDisputeOpened(order, args));
}

/** A7. Always sent. */
export async function notifyDisputeClosed(
  admin: Client,
  order: Order,
  settings: CommerceSettings,
  args: Parameters<typeof buildAdminDisputeClosed>[1],
): Promise<void> {
  await sendNotice(admin, order, settings, buildAdminDisputeClosed(order, args));
}
