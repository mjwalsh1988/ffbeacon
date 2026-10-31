"use client";

/**
 * The four things that must not be missed, under the order's heading, in this
 * order: a chargeback, a duplicate payment, an amount mismatch, a receipt that did
 * not go out. One sentence and one button each.
 */

import type { ReactNode } from "react";
import {
  cancelOrderAction,
  confirmManualPaymentAction,
  resendReceiptAction,
  resolveDuplicatePaymentAction,
} from "@/app/admin/orders/actions";
import { formatEastern } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import { ActionStatus, ADMIN_BUTTON, ADMIN_DANGER, useOrderAction } from "./order-action";

function Banner({ sentence, children }: { sentence: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-card border border-signal-danger/50 bg-signal-danger/10 px-4 py-3"
    >
      <p className="break-words text-sm font-medium leading-relaxed text-ink">{sentence}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** Stripe's reason code as words: "product_not_received" reads as "product not received". */
function reasonWords(reason: string | null): string {
  if (!reason) return "no reason given";
  return reason.replace(/_/g, " ");
}

export type BannerData = {
  orderId: string;
  amountCents: number;
  dispute: { open: boolean; reason: string | null; dueByIso: string | null; url: string | null };
  duplicate: { paymentIntentId: string; amountCents: number; url: string } | null;
  mismatch: { reportedCents: number; paymentIntentId: string | null } | null;
  receipt: { status: string | null; error: string | null } | null;
};

export function OrderBanners({ data }: { data: BannerData }) {
  const { run, pending, status, failed } = useOrderAction();
  const { orderId } = data;
  const any = data.dispute.open || data.duplicate || data.mismatch || data.receipt;
  if (!any) return null;

  return (
    <div className="mt-4 space-y-2">
      {data.dispute.open && (
        <Banner
          sentence={`A chargeback is open on this payment (${reasonWords(data.dispute.reason)}${
            data.dispute.dueByIso ? `, evidence due ${formatEastern(data.dispute.dueByIso)}` : ""
          }). Do not deliver until it is resolved unless you choose to.`}
        >
          {data.dispute.url && (
            <a href={data.dispute.url} target="_blank" rel="noopener noreferrer" className={ADMIN_BUTTON}>
              Open in Stripe
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </Banner>
      )}
      {data.duplicate && (
        <Banner
          sentence={`A second payment of ${formatMoney(data.duplicate.amountCents)} arrived on this order (${data.duplicate.paymentIntentId}). Refund it in Stripe, then mark it here.`}
        >
          <a href={data.duplicate.url} target="_blank" rel="noopener noreferrer" className={ADMIN_BUTTON}>
            Open in Stripe
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => resolveDuplicatePaymentAction(orderId))}
            className={ADMIN_BUTTON}
          >
            Mark duplicate refunded
          </button>
        </Banner>
      )}
      {data.mismatch && (
        <Banner
          sentence={`Stripe reported ${formatMoney(data.mismatch.reportedCents)} for an order of ${formatMoney(data.amountCents)}. The order was not marked paid.`}
        >
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => confirmManualPaymentAction(orderId, data.mismatch?.paymentIntentId ?? ""))
            }
            className={ADMIN_BUTTON}
          >
            Confirm payment anyway
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => cancelOrderAction(orderId, "", false))}
            className={ADMIN_DANGER}
          >
            Cancel order
          </button>
        </Banner>
      )}
      {data.receipt && (
        <Banner
          sentence={`The receipt email was not sent (${data.receipt.status ?? "not attempted"}${data.receipt.error ? `: ${data.receipt.error}` : ""}).`}
        >
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => resendReceiptAction(orderId))}
            className={ADMIN_BUTTON}
          >
            Send the receipt now
          </button>
        </Banner>
      )}
      <ActionStatus status={status} failed={failed} />
    </div>
  );
}
