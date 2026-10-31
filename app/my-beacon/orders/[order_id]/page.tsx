import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadOfferState } from "@/lib/commerce/offer";
import { loadOrderForOwner } from "@/lib/commerce/orders";
import { canReconcile, reconcileStripeOrder } from "@/lib/commerce/reconcile";
import { OrderPaidTracker } from "@/components/commerce/order-paid-tracker";
import { OrderSheet } from "@/components/commerce/order-sheet";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

const CONFIRMING = "We are still confirming your payment. This page updates when it lands.";

/**
 * One order. Read with the SESSION client, so a foreign id returns nothing and the
 * page 404s. When a card payment has not been recorded yet, the page asks Stripe
 * rather than waiting on the webhook; `?session_id=` only decides what the page
 * says, and is never used to look anything up.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ order_id: string }>;
  searchParams: Promise<{ pay?: string; session_id?: string }>;
}) {
  const { order_id: orderId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(orderId)) notFound();

  const supabase = await createClient();
  let detail = await loadOrderForOwner(supabase, orderId);
  if (!detail) notFound();

  const admin = createAdminClient();
  const offer = await loadOfferState(admin);

  let confirming = false;
  if (canReconcile(detail.order, new Date())) {
    const result = await reconcileStripeOrder(admin, detail.order, offer.settings);
    if (result === "paid") {
      detail = (await loadOrderForOwner(supabase, orderId)) ?? detail;
    } else if (sp.session_id && sp.session_id === detail.order.stripe_session_id) {
      confirming = detail.order.payment_status === "unpaid";
    } else if (result === "throttled") {
      confirming = true;
    }
  }

  const payNotice = confirming
    ? CONFIRMING
    : sp.pay === "cancelled"
      ? "You backed out of the payment page. Nothing was charged."
      : sp.pay === "failed"
        ? "We could not open the card payment page. Try again, or pay with PayPal or Venmo."
        : null;

  const { order } = detail;
  const paid = order.payment_status === "paid" && order.paid_at != null;

  return (
    <>
      {paid && (
        <OrderPaidTracker
          orderId={order.id}
          paidAt={order.paid_at as string}
          tier={order.product_snapshot.slug}
          method={order.payment_method}
          value={order.amount_cents / 100}
        />
      )}
      <OrderSheet detail={detail} methods={offer.availability.methods} payNotice={payNotice} />
    </>
  );
}
