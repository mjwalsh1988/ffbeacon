"use client";

/**
 * The money on one order. Every path here records what happened at the processor;
 * nothing moves money. A reported payment is confirmed by a person pressing a
 * button, never by the customer's word.
 */

import { useEffect, useRef, useState } from "react";
import {
  cancelOrderAction,
  confirmManualPaymentAction,
  markPaymentNotFoundAction,
  recordRefundAction,
} from "@/app/admin/orders/actions";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import { easternLocalToIso } from "@/lib/commerce/eastern-input";
import type { PaymentMethod, PaymentStatus } from "@/lib/commerce/types";
import {
  ActionStatus,
  ADMIN_BUTTON,
  ADMIN_DANGER,
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_PRIMARY,
  useOrderAction,
} from "./order-action";

function ConfirmForm({
  orderId,
  initialReference,
  nowEastern,
  children,
}: {
  orderId: string;
  initialReference: string;
  nowEastern: string;
  children?: React.ReactNode;
}) {
  const [reference, setReference] = useState(initialReference);
  const [paidAt, setPaidAt] = useState(nowEastern);
  const { run, pending, status, failed } = useOrderAction();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => confirmManualPaymentAction(orderId, reference, easternLocalToIso(paidAt) ?? undefined));
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="confirm-reference" className={ADMIN_LABEL}>
          Reference
        </label>
        <input
          id="confirm-reference"
          type="text"
          maxLength={120}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11`}
        />
      </div>
      <div>
        <label htmlFor="confirm-paid-at" className={ADMIN_LABEL}>
          Paid at, Eastern time
        </label>
        <input
          id="confirm-paid-at"
          type="datetime-local"
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={ADMIN_PRIMARY}>
          {pending ? "Confirming..." : "Confirm payment"}
        </button>
        {children}
      </div>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}

function NotReceived({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const { run, pending, status, failed } = useOrderAction();
  // The form replaces the button that opened it, so the note takes focus rather
  // than letting it fall to the document body.
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) noteRef.current?.focus();
  }, [open]);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={ADMIN_BUTTON}>
        Not received
      </button>
    );
  }
  return (
    <div className="mt-3 w-full space-y-3 border-t border-line pt-3">
      <div>
        <label htmlFor="not-received-note" className={ADMIN_LABEL}>
          Note to the customer
        </label>
        <textarea
          id="not-received-note"
          ref={noteRef}
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-cyan"
        />
        Email the customer
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => markPaymentNotFoundAction(orderId, note, notify), () => setOpen(false))}
        className={ADMIN_BUTTON}
      >
        Mark not received
      </button>
      <ActionStatus status={status} failed={failed} />
    </div>
  );
}

function CancelForm({ orderId }: { orderId: string }) {
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const { run, pending, status, failed } = useOrderAction();
  return (
    <div className="mt-5 space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-bold text-ink">Cancel order</h3>
      <div>
        <label htmlFor="cancel-note" className={ADMIN_LABEL}>
          Note
        </label>
        <textarea
          id="cancel-note"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-cyan"
        />
        Email the customer
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => cancelOrderAction(orderId, note, notify))}
        className={ADMIN_DANGER}
      >
        Cancel order
      </button>
      <ActionStatus status={status} failed={failed} />
    </div>
  );
}

function RefundForm({
  orderId,
  leftCents,
  stripe,
}: {
  orderId: string;
  leftCents: number;
  stripe: boolean;
}) {
  const [amount, setAmount] = useState((leftCents / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const { run, pending, status, failed } = useOrderAction();
  const label = stripe ? "Record a refund made in Stripe" : "Record a refund";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const cents = Math.round(Number(amount) * 100);
        run(() => recordRefundAction(orderId, cents, note, notify));
      }}
      className="space-y-3"
    >
      <h3 className="text-sm font-bold text-ink">{label}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">
        Refund the money in Stripe, PayPal or Venmo first. This records it; it does not move money.
      </p>
      {stripe && (
        <p className="text-sm leading-relaxed text-ink-muted">
          The webhook normally records these on its own; use this if it did not.
        </p>
      )}
      <div>
        <label htmlFor="refund-amount" className={ADMIN_LABEL}>
          Amount in dollars, up to {formatMoney(leftCents)}
        </label>
        <input
          id="refund-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11 font-mono`}
        />
      </div>
      <div>
        <label htmlFor="refund-note" className={ADMIN_LABEL}>
          Note
        </label>
        <textarea
          id="refund-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-brand-cyan"
        />
        Email the customer
      </label>
      <button type="submit" disabled={pending} className={ADMIN_BUTTON}>
        {pending ? "Recording..." : label}
      </button>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}

export function OrderPaymentPanel({
  orderId,
  method,
  paymentStatus,
  amountCents,
  refundedCents,
  refundedAt,
  reportedAt,
  reference,
  nowEastern,
}: {
  orderId: string;
  method: PaymentMethod;
  paymentStatus: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  refundedAt: string | null;
  reportedAt: string | null;
  reference: string | null;
  nowEastern: string;
}) {
  const left = amountCents - refundedCents;

  if (paymentStatus === "awaiting_confirmation") {
    return (
      <>
        <p className="mb-3 text-sm text-ink-muted">
          {reportedAt ? `Customer reported sent at ${formatEastern(reportedAt)}` : "Not reported yet"}
        </p>
        <ConfirmForm orderId={orderId} initialReference={reference ?? ""} nowEastern={nowEastern}>
          <NotReceived orderId={orderId} />
        </ConfirmForm>
        <CancelForm orderId={orderId} />
      </>
    );
  }

  if (paymentStatus === "unpaid" || paymentStatus === "expired") {
    return (
      <>
        {method === "stripe" && paymentStatus === "unpaid" && (
          <>
            <h3 className="text-sm font-bold text-ink">Confirm by hand</h3>
            <p className="mb-3 mt-1 text-sm leading-relaxed text-ink-muted">
              Only when you can see the payment in Stripe and the webhook did not record it.
            </p>
          </>
        )}
        {paymentStatus === "expired" && (
          <p className="mb-3 text-sm text-ink-muted">
            This order expired. Confirm it when the money turned up after all.
          </p>
        )}
        <ConfirmForm orderId={orderId} initialReference={reference ?? ""} nowEastern={nowEastern} />
        <CancelForm orderId={orderId} />
      </>
    );
  }

  if (paymentStatus === "paid" && amountCents > 0 && left > 0) {
    return (
      <RefundForm orderId={orderId} leftCents={left} stripe={method === "stripe"} />
    );
  }
  if (paymentStatus === "refunded") {
    return <p className="text-sm text-ink-muted">Fully refunded on {formatEasternDate(refundedAt)}.</p>;
  }
  if (paymentStatus === "cancelled") {
    return <p className="text-sm text-ink-muted">This order was canceled.</p>;
  }
  return <p className="text-sm text-ink-muted">Nothing to do: no payment was taken on this order.</p>;
}
