/**
 * One order, as one sheet: a letterhead with the amount in the place the Blueprint
 * puts its grade, then numbered sections. Everything here reached the page through
 * the reader's own session, so RLS has already decided what they can see.
 *
 * The heading is "Order FFB-100001" at h2, because My Beacon's layout holds the
 * page's h1 and every child page starts at h2.
 */

import Link from "next/link";
import type { Route } from "next";
import { formatEastern, formatEasternDate, formatEasternShortDate } from "@/lib/datetime";
import { REFUND_POLICY_SENTENCE, SELLER_EMAIL, formatMoney } from "@/lib/commerce/constants";
import { TEAM_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import type { OrderDetail } from "@/lib/commerce/orders";
import {
  FULFILLMENT_LABEL,
  FREE_CHIP,
  paymentChip,
  progressStep,
} from "@/lib/commerce/transitions";
import type { Order, OrderDeliverable, PaymentMethod } from "@/lib/commerce/types";
import { Leader, RULED, Sheet, SheetSection } from "@/components/league-blueprint/sheet";
import { IntakeUpdateForm } from "./intake-update-form";
import { OrderProgress } from "./order-progress";
import { OrderTimeline } from "./order-timeline";
import { PayPanel } from "./pay-panel";
import { RichTextView } from "./rich-text-view";
import { StatusChip } from "./status-chip";

const TITLE_ID = "order-title";

const METHOD_WORD: Record<PaymentMethod, string> = {
  stripe: "Card via Stripe",
  paypal: "PayPal",
  venmo: "Venmo",
  complimentary: "No payment needed",
};

function statusSentence(order: Order): string {
  const word = order.payment_method === "venmo" ? "Venmo" : "PayPal";
  switch (order.payment_status) {
    case "unpaid":
      return "Waiting for your card payment.";
    case "awaiting_confirmation":
      return order.customer_reported_paid_at
        ? `Michael confirms ${word} payments by hand, usually within a day. This page updates when he does.`
        : `Waiting for your ${word} payment.`;
    case "expired":
      return "The payment did not arrive in time. Nothing was charged.";
    case "cancelled":
      return "This order was canceled.";
    case "refunded":
      return `This order was refunded on ${formatEastern(order.refunded_at)}.`;
    case "paid":
      break;
  }
  switch (order.fulfillment_status) {
    case "queued":
      return `Michael has it in his queue. Expect it by ${formatEastern(order.due_at)}.`;
    case "in_progress":
      return `Michael is working on it. Expect it by ${formatEastern(order.due_at)}.`;
    case "delivered":
      return `Delivered ${formatEastern(order.delivered_at)}.`;
    default:
      return "This order has closed.";
  }
}

function fileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AmountBox({ order }: { order: Order }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border-2 border-line-accent bg-base/40 px-6 py-5 text-center sm:w-56">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Amount</p>
      <p className="mt-2 bg-beacon bg-clip-text font-mono text-5xl font-black leading-none tabular-nums text-transparent sm:text-6xl">
        {formatMoney(order.amount_cents)}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <StatusChip chip={paymentChip(order, "customer")} />
        {order.amount_cents === 0 && <StatusChip chip={FREE_CHIP} />}
      </div>
    </div>
  );
}

function ReviewSection({ order, sections, attachments }: { order: Order; sections: OrderDeliverable[]; attachments: OrderDeliverable[] }) {
  const premium = order.product_snapshot.tier_rank >= 2;
  return (
    <SheetSection id="your-review" number="03" title="Your review">
      <div className="space-y-8">
        {sections.map((section) => {
          const updated =
            section.published_at && new Date(section.updated_at) > new Date(section.published_at);
          return (
            <section key={section.id} aria-labelledby={`deliverable-${section.id}`}>
              <h3 id={`deliverable-${section.id}`} className="text-lg font-bold tracking-tight text-ink">
                {section.title}
              </h3>
              <div className="mt-2">
                <RichTextView text={section.body ?? ""} headingLevel={4} />
              </div>
              {updated && (
                <p className="mt-2 font-mono text-[11px] text-ink-muted">Updated {formatEastern(section.updated_at)}</p>
              )}
            </section>
          );
        })}
        {attachments.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-ink">Attachments</h3>
            <ul role="list" className={`mt-2 ${RULED}`}>
              {attachments.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/orders/${order.id}/files/${file.id}`}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-2 text-sm font-semibold text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <span className="min-w-0 break-all">{file.file_name ?? file.title}</span>
                    <span className="font-mono text-xs font-normal text-ink-muted">{fileSize(file.file_size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {premium && (
          <p className="text-sm leading-relaxed text-ink-muted">
            You have one follow-up question included. Reply to the delivery email within 7 days, or write to{" "}
            <a
              href={`mailto:${SELLER_EMAIL}`}
              className="inline-flex min-h-11 items-center break-all font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {SELLER_EMAIL}
            </a>
            , and Michael will answer it.
          </p>
        )}
      </div>
    </SheetSection>
  );
}

function IntakeSection({ order }: { order: Order }) {
  const { intake } = order;
  const awaitingAnswers =
    intake.providedBy === "admin" && order.fulfillment_status === "queued" && !intake.questions;
  const directionLabel =
    TEAM_REVIEW_QUESTIONS.direction.options.find((o) => o.value === intake.direction)?.label ?? "Not sure";
  const fixed = order.fulfillment_status !== "queued" && intake.providedBy === "admin" && !intake.questions;
  return (
    <SheetSection id="what-you-told" number="04" title="What you told Michael">
      {awaitingAnswers ? (
        <IntakeUpdateForm orderId={order.id} />
      ) : fixed ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Michael has started, so the questions are fixed. Reply to any email about this order to add something.
        </p>
      ) : (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {TEAM_REVIEW_QUESTIONS.direction.legend}
            </dt>
            <dd className="mt-0.5 text-ink">{directionLabel}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {TEAM_REVIEW_QUESTIONS.questions.label}
            </dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{intake.questions || "Nothing added."}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {TEAM_REVIEW_QUESTIONS.offLimits.label}
            </dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{intake.offLimits || "Nothing added."}</dd>
          </div>
        </dl>
      )}
    </SheetSection>
  );
}

export function OrderSheet({
  detail,
  methods,
  payNotice,
}: {
  detail: OrderDetail;
  methods: PaymentMethod[];
  payNotice: string | null;
}) {
  const { order, events, messages, deliverables } = detail;
  const { context, product_snapshot: product } = order;
  const payable =
    order.payment_status === "unpaid" ||
    order.payment_status === "awaiting_confirmation" ||
    order.payment_status === "expired";
  const paidOrder = order.payment_status === "paid" || order.payment_status === "refunded";
  const sections = deliverables.filter((d) => d.kind === "section");
  const attachments = deliverables.filter((d) => d.kind === "attachment");
  const showReview =
    (order.fulfillment_status === "delivered" || order.fulfillment_status === "in_progress") &&
    (sections.length > 0 || attachments.length > 0);

  return (
    <Sheet labelledBy={TITLE_ID}>
      <header className="px-5 pb-6 pt-7 sm:px-8 sm:pt-8">
        <p className="flex items-center gap-2.5">
          {/* The site's own mark, decorative: the words beside it name the author. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/ff-beacon-mark-96.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
          <span className="text-sm font-semibold text-ink">FF Beacon</span>
          <span aria-hidden="true" className="h-3.5 w-px bg-line-accent" />
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Order</span>
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="break-words font-mono text-3xl font-black leading-tight tabular-nums tracking-tight text-ink sm:text-4xl">
              Order {order.order_number}
            </h2>
            <p className="mt-1 text-lg font-bold tracking-tight text-ink">{product.name}</p>
            <dl className="mt-4 grid gap-x-8 lg:grid-cols-2">
              <Leader label="Team">{context.teamName}</Leader>
              <Leader label="League">{context.leagueName}</Leader>
              <Leader label="Season">{context.season}</Leader>
              <Leader label="Format">{context.formatDisplay}</Leader>
              <Leader label="Values">{context.sourceDisplay}</Leader>
              <Leader label="Ordered">{formatEastern(order.created_at)}</Leader>
              {order.paid_at && <Leader label="Paid">{formatEastern(order.paid_at)}</Leader>}
              {order.delivered_at ? (
                <Leader label="Delivered">{formatEastern(order.delivered_at)}</Leader>
              ) : (
                order.due_at && <Leader label="Due by">{formatEastern(order.due_at)}</Leader>
              )}
              <Leader label="Payment">{METHOD_WORD[order.payment_method]}</Leader>
              {order.coupon_code && order.discount_cents > 0 && (
                <Leader label="Code">
                  {order.coupon_code}, {formatMoney(order.discount_cents)} off
                </Leader>
              )}
              {order.external_payment_reference && (
                <Leader label="Reference">{order.external_payment_reference}</Leader>
              )}
              {order.refunded_cents > 0 && (
                <Leader label="Refunded">{formatMoney(order.refunded_cents)}</Leader>
              )}
            </dl>
          </div>
          <AmountBox order={order} />
        </div>
      </header>

      <SheetSection id="progress" number="01" title="Progress">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip chip={FULFILLMENT_LABEL[order.fulfillment_status]} />
        </div>
        <div className="mt-4">
          <OrderProgress
            steps={progressStep(order)}
            times={{
              ordered: formatEasternShortDate(order.created_at),
              paid: order.paid_at ? formatEasternShortDate(order.paid_at) : null,
              in_progress: order.started_at ? formatEasternShortDate(order.started_at) : null,
              delivered: order.delivered_at ? formatEasternShortDate(order.delivered_at) : null,
            }}
          />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{statusSentence(order)}</p>
      </SheetSection>

      {payable && (
        <SheetSection id="pay" number="02" title="Pay">
          <PayPanel
            orderId={order.id}
            orderNumber={order.order_number}
            amountCents={order.amount_cents}
            paymentMethod={order.payment_method}
            paymentStatus={order.payment_status}
            reportedAt={order.customer_reported_paid_at}
            methods={methods}
            notice={payNotice}
          />
        </SheetSection>
      )}

      {showReview && <ReviewSection order={order} sections={sections} attachments={attachments} />}

      <IntakeSection order={order} />

      <SheetSection id="timeline" number="05" title="Timeline">
        <OrderTimeline events={events} messages={messages} />
      </SheetSection>

      <SheetSection id="help" number="06" title="Help">
        <div className="space-y-2 text-sm leading-relaxed text-ink-muted">
          <p>
            Something wrong with this order? Reply to any email about it, or write to{" "}
            <a
              href={`mailto:${SELLER_EMAIL}`}
              className="inline-flex min-h-11 items-center break-all font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {SELLER_EMAIL}
            </a>{" "}
            and quote {order.order_number}.
          </p>
          {paidOrder && <p>{REFUND_POLICY_SENTENCE}</p>}
          <p>
            <Link
              href={"/terms" as Route}
              className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Terms of Service
            </Link>
          </p>
          <p className="font-mono text-[11px] text-ink-subtle">Placed {formatEasternDate(order.created_at)}, sold by FF Beacon.</p>
        </div>
      </SheetSection>
    </Sheet>
  );
}
