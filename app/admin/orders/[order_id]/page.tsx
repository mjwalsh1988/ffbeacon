import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadSleeperHandleForUser } from "@/lib/sleeper-handle/resolve";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import { lookupCustomers } from "@/lib/commerce/customers";
import { isoToEasternLocal } from "@/lib/commerce/eastern-input";
import { TEAM_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import { loadCustomerHistory, loadOrderForAdmin } from "@/lib/commerce/orders";
import { stripeDashboardUrl, stripeDisputeUrl } from "@/lib/commerce/stripe";
import {
  disputeChip,
  FREE_CHIP,
  FULFILLMENT_LABEL,
  paymentChip,
  progressStep,
  TEST_CHIP,
} from "@/lib/commerce/transitions";
import type { Order, OrderEvent } from "@/lib/commerce/types";
import { Panel } from "@/components/dashboard-panel";
import { Leader } from "@/components/league-blueprint/sheet";
import { OrdersSubnav } from "@/components/admin/orders-subnav";
import { DeliverableEditor } from "@/components/admin/deliverable-editor";
import { InternalNotesPanel } from "@/components/admin/internal-notes-panel";
import { OrderBanners, type BannerData } from "@/components/admin/order-banners";
import { OrderEmailComposer } from "@/components/admin/order-email-composer";
import { OrderPaymentPanel } from "@/components/admin/order-payment-panel";
import { OrderTimelineAdmin } from "@/components/admin/order-timeline-admin";
import { OrderWorkflowPanel } from "@/components/admin/order-workflow-panel";
import { OrderProgress } from "@/components/commerce/order-progress";
import { StatusChip } from "@/components/commerce/status-chip";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order" };

const LINK =
  "inline-flex min-h-11 items-center break-all font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function latestData(events: OrderEvent[], kind: OrderEvent["kind"]): Record<string, unknown> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === kind) return (events[i].data ?? {}) as Record<string, unknown>;
  }
  return null;
}

function bannerData(order: Order, events: OrderEvent[], now: Date): BannerData {
  const opened = latestData(events, "dispute_opened");
  const duplicate = latestData(events, "duplicate_payment");
  const mismatch = latestData(events, "payment_mismatch");
  const due = typeof opened?.dueBy === "number" ? new Date(opened.dueBy * 1000).toISOString() : null;
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const receiptStale =
    order.payment_status === "paid" &&
    order.receipt_email_status !== "sent" &&
    order.paid_at != null &&
    (order.receipt_email_status !== "pending" || new Date(order.paid_at).getTime() < hourAgo);

  return {
    orderId: order.id,
    amountCents: order.amount_cents,
    dispute: {
      open: order.dispute_status === "open",
      reason: typeof opened?.reason === "string" ? opened.reason : null,
      dueByIso: due,
      url: order.stripe_payment_intent_id
        ? stripeDisputeUrl(order.stripe_payment_intent_id, order.livemode)
        : null,
    },
    duplicate:
      order.duplicate_payment_intent_id && !order.duplicate_resolved_at
        ? {
            paymentIntentId: order.duplicate_payment_intent_id,
            amountCents: typeof duplicate?.amount === "number" ? duplicate.amount : order.amount_cents,
            url: stripeDashboardUrl(order.duplicate_payment_intent_id, order.livemode),
          }
        : null,
    mismatch:
      order.mismatch_amount_cents != null
        ? {
            reportedCents: order.mismatch_amount_cents,
            paymentIntentId:
              typeof mismatch?.paymentIntentId === "string" ? mismatch.paymentIntentId : null,
          }
        : null,
    receipt: receiptStale
      ? { status: order.receipt_email_status, error: order.receipt_email_error }
      : null,
  };
}

export default async function AdminOrderPage({ params }: { params: Promise<{ order_id: string }> }) {
  const { order_id: orderId } = await params;
  await requireAdmin(`/admin/orders/${orderId}`);
  if (!/^[0-9a-f-]{36}$/.test(orderId)) notFound();

  const admin = createAdminClient();
  const detail = await loadOrderForAdmin(admin, orderId);
  if (!detail) notFound();
  const { order, events, messages, deliverables } = detail;

  const [customers, history, handle] = await Promise.all([
    lookupCustomers(admin, [order.user_id]),
    loadCustomerHistory(admin, order.user_id, order.id),
    order.user_id ? loadSleeperHandleForUser(admin, order.user_id) : null,
  ]);
  const customer = order.user_id ? customers.get(order.user_id) : undefined;

  const now = new Date();
  const dispute = disputeChip(order.dispute_status);
  const { context, intake, product_snapshot: product } = order;
  const snapshot = context.blueprint;
  const record = snapshot?.view.header.record;
  const notes = events
    .filter((e) => e.kind === "note" && !e.visible_to_customer)
    .reverse()
    .map((e) => ({ id: e.id, created_at: e.created_at, body: e.body, title: e.title }));
  const direction =
    TEAM_REVIEW_QUESTIONS.direction.options.find((o) => o.value === intake.direction)?.label ?? "Not sure";

  return (
    <div className="mx-auto max-w-7xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Orders</p>
      <h1 id="order-heading" tabIndex={-1} className="mt-1 break-words font-mono text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        Order {order.order_number}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip chip={paymentChip(order, "admin")} />
        <StatusChip chip={FULFILLMENT_LABEL[order.fulfillment_status]} />
        {dispute && <StatusChip chip={dispute} />}
        {order.amount_cents === 0 && <StatusChip chip={FREE_CHIP} />}
        {order.livemode === false && <StatusChip chip={TEST_CHIP} />}
      </div>
      <p className="mt-3 font-mono text-4xl font-black tabular-nums text-ink">{formatMoney(order.amount_cents)}</p>
      <p className="mt-1 text-sm text-ink-muted">Placed {formatEastern(order.created_at)}</p>
      <OrdersSubnav />

      <OrderBanners data={bannerData(order, events, now)} />

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Panel id="customer" title="Customer">
            <dl>
              <Leader label="Name">{customer?.displayName ?? "Deleted account"}</Leader>
              <Leader label="Email">
                {customer?.email ? (
                  <a href={`mailto:${customer.email}`} className={LINK}>
                    {customer.email}
                  </a>
                ) : (
                  "No address"
                )}
              </Leader>
              {handle && <Leader label="Sleeper">@{handle.username}</Leader>}
              {customer?.memberSince && (
                <Leader label="Member since">{formatEasternDate(customer.memberSince)}</Leader>
              )}
              <Leader label="Orders">
                {customer?.email ? (
                  <Link
                    href={`/admin/orders?q=${encodeURIComponent(customer.email)}` as Route}
                    className={LINK}
                    aria-label={`${history.orderCount} orders from this customer`}
                  >
                    {history.orderCount}
                  </Link>
                ) : (
                  history.orderCount
                )}
              </Leader>
            </dl>
            {history.openChargebacksElsewhere > 0 && (
              <p className="mt-2 text-sm font-semibold text-signal-danger">
                {history.openChargebacksElsewhere} open chargeback
                {history.openChargebacksElsewhere === 1 ? "" : "s"} on another order
              </p>
            )}
          </Panel>

          <Panel id="order" title="Order">
            <dl>
              <Leader label="Product">{`${product.name}, tier ${product.tier_rank}`}</Leader>
              <Leader label="List price">{formatMoney(order.list_price_cents)}</Leader>
              {order.origin === "admin" ? (
                <Leader label="Discount">Complimentary, created by you</Leader>
              ) : (
                order.discount_cents > 0 && (
                  <Leader label="Discount">
                    {formatMoney(order.discount_cents)} off{order.coupon_code ? ` with ${order.coupon_code}` : ""}
                  </Leader>
                )
              )}
              <Leader label="Amount">{formatMoney(order.amount_cents)}</Leader>
              <Leader label="Method">{order.payment_method}</Leader>
              <Leader label="Payment">{paymentChip(order, "admin").word}</Leader>
              {order.refunded_cents > 0 && (
                <Leader label="Refunded so far">{formatMoney(order.refunded_cents)}</Leader>
              )}
              {order.paid_at && <Leader label="Paid at">{formatEastern(order.paid_at)}</Leader>}
              {order.paid_via && <Leader label="Paid via">{order.paid_via}</Leader>}
              {order.stripe_session_id && (
                <Leader label="Stripe session">
                  <span className="break-all font-mono text-xs">{order.stripe_session_id}</span>
                </Leader>
              )}
              {order.stripe_payment_intent_id && (
                <Leader label="Payment intent">
                  <a
                    href={stripeDashboardUrl(order.stripe_payment_intent_id, order.livemode)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${LINK} font-mono text-xs`}
                  >
                    {order.stripe_payment_intent_id}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Leader>
              )}
              {order.external_payment_reference && (
                <Leader label="Reference">{order.external_payment_reference}</Leader>
              )}
              {order.due_at && <Leader label="Due by">{formatEastern(order.due_at)}</Leader>}
              <Leader label="Turnaround">{`${product.turnaround_days} days`}</Leader>
            </dl>
          </Panel>

          <Panel id="team" title="Team">
            <dl>
              <Leader label="Team">{context.teamName}</Leader>
              <Leader label="League">{`${context.leagueName}, ${context.season}`}</Leader>
              {record && (
                <Leader label="Record">{`${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`}</Leader>
              )}
              <Leader label="Format">{context.formatDisplay}</Leader>
              <Leader label="Values">{context.sourceDisplay}</Leader>
              {snapshot ? (
                <>
                  <Leader label="Overall grade">{`${snapshot.overall.toFixed(1)} of 10`}</Leader>
                  {snapshot.statusLabel && <Leader label="Standing">{snapshot.statusLabel}</Leader>}
                </>
              ) : (
                <Leader label="Blueprint">No Blueprint was built at order time</Leader>
              )}
            </dl>
            <ul role="list" className="mt-2 flex flex-wrap gap-x-4">
              {(
                [
                  ["Blueprint", context.links.blueprint],
                  ["Overview", context.links.overview],
                  ["Lineups", context.links.lineups],
                  ["Trade Ideas", context.links.tradeIdeas],
                ] as const
              ).map(([label, href]) => (
                <li key={label}>
                  <Link href={href as Route} className={LINK}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel id="intake" title="Intake">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Direction</dt>
                <dd className="mt-0.5 text-ink">{direction}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Questions</dt>
                <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{intake.questions || "None given."}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Off limits</dt>
                <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{intake.offLimits || "None given."}</dd>
              </div>
            </dl>
          </Panel>

          <Panel id="internal-notes" title="Internal notes">
            <InternalNotesPanel orderId={order.id} notes={notes} />
          </Panel>
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-3">
          <Panel id="workflow" title="Workflow">
            <OrderProgress steps={progressStep(order)} />
            <div className="mt-5 border-t border-line pt-4">
              <OrderWorkflowPanel
                orderId={order.id}
                status={order.fulfillment_status}
                paid={order.payment_status === "paid"}
              />
            </div>
          </Panel>

          <Panel id="payment" title="Payment">
            <OrderPaymentPanel
              orderId={order.id}
              method={order.payment_method}
              paymentStatus={order.payment_status}
              amountCents={order.amount_cents}
              refundedCents={order.refunded_cents}
              refundedAt={order.refunded_at}
              reportedAt={order.customer_reported_paid_at}
              reference={order.external_payment_reference}
              nowEastern={isoToEasternLocal(now.toISOString())}
            />
          </Panel>

          <Panel id="deliverable" title="Deliverable">
            <DeliverableEditor
              orderId={order.id}
              deliverables={deliverables}
              disputeOpen={order.dispute_status === "open"}
              delivered={order.fulfillment_status === "delivered"}
              everDelivered={order.delivered_at != null}
              paid={order.payment_status === "paid"}
            />
          </Panel>

          <Panel id="email" title="Email the customer">
            <OrderEmailComposer orderId={order.id} />
          </Panel>

          <Panel id="timeline" title="Timeline">
            <OrderTimelineAdmin events={events} messages={messages} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
