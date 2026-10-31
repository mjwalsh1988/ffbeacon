"use client";

/**
 * Section 02 of the order page: how to finish paying.
 *
 * A card order gets the button that opens Stripe (the action closes any open
 * session first) and the switch to PayPal or Venmo. A manual order gets the amount,
 * the order number with a copy button, the link and the "I sent it" form, because
 * neither service can tell us the money arrived. A reported payment is never
 * auto-confirmed: the panel says so and waits for the admin.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import {
  reportManualPaymentAction,
  startStripeCheckoutAction,
  switchPaymentMethodAction,
} from "@/app/actions/commerce";
import { trackEvent } from "@/lib/analytics";
import { formatMoney } from "@/lib/commerce/constants";
import { manualPayUrl } from "@/lib/commerce/pay-links";
import type { PaymentMethod, PaymentStatus } from "@/lib/commerce/types";
import { CancelOrderButton } from "./cancel-order-button";

const PRIMARY =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 sm:w-auto";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";

function CopyNumber({ value }: { value: string }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Order number copied to clipboard.");
    } catch {
      setMessage("Clipboard unavailable. Select the order number and copy it.");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2500);
  };
  return (
    <>
      {/* The visible word stays Copy, so the name a voice-control user says keeps matching. */}
      <button type="button" onClick={copy} aria-label={`Copy order number ${value}`} className={SECONDARY}>
        Copy
      </button>
      <span role="status" className="sr-only">
        {message}
      </span>
    </>
  );
}

export function PayPanel({
  orderId,
  orderNumber,
  amountCents,
  paymentMethod,
  paymentStatus,
  reportedAt,
  methods,
  notice,
}: {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  reportedAt: string | null;
  /** What is switched on right now. */
  methods: PaymentMethod[];
  /** "cancelled", "failed" or "confirming", from the page. */
  notice: string | null;
}) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const manual = paymentMethod === "paypal" || paymentMethod === "venmo";
  const word = paymentMethod === "venmo" ? "Venmo" : "PayPal";

  const run = (work: () => Promise<{ ok: true; redirect?: string } | { ok: false; message: string }>) => {
    setError("");
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.redirect?.startsWith("https://")) window.location.assign(result.redirect);
      else if (result.redirect) router.push(result.redirect as Route);
      else router.refresh();
    });
  };

  const report = (event: React.FormEvent) => {
    event.preventDefault();
    run(() => reportManualPaymentAction(orderId, reference));
  };

  const payUrl = manual
    ? manualPayUrl(paymentMethod === "venmo" ? "venmo" : "paypal", amountCents, orderNumber)
    : null;

  const switchTargets = (["paypal", "venmo"] as const).filter((m) => methods.includes(m));

  return (
    <div>
      <p role="status" className="sr-only">
        {pending ? "Working on it." : ""}
      </p>
      {notice && (
        <p role="status" className="mb-4 rounded-card border border-line-accent bg-base/40 px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      {!manual && (
        <>
          <p className="font-mono text-4xl font-black tabular-nums text-ink">{formatMoney(amountCents)}</p>
          {paymentStatus === "expired" && (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              The last card payment page expired. Nothing was charged. You can open a new one.
            </p>
          )}
          <div className="mt-4">
            {methods.includes("stripe") ? (
              <button
                type="button"
                onClick={() => {
                  if (!pending) run(() => startStripeCheckoutAction(orderId));
                }}
                aria-disabled={pending}
                className={`${PRIMARY} aria-disabled:opacity-60`}
              >
                {pending ? "Opening..." : "Open the card payment page"}
              </button>
            ) : (
              <p className="text-sm leading-relaxed text-ink-muted">
                Card payments are switched off at the moment. Switch to PayPal or Venmo below.
              </p>
            )}
          </div>
          {switchTargets.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-semibold text-ink">Or switch to PayPal or Venmo</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {switchTargets.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => switchPaymentMethodAction(orderId, m))}
                    className={SECONDARY}
                  >
                    Pay with {m === "paypal" ? "PayPal" : "Venmo"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {manual && paymentStatus !== "awaiting_confirmation" && (
        <p className="text-sm leading-relaxed text-ink-muted">
          This order has closed. If you sent the payment, write to michael@ffbeacon.com and quote {orderNumber}.
        </p>
      )}

      {manual && paymentStatus === "awaiting_confirmation" && (
        <>
          <p className="font-mono text-4xl font-black tabular-nums text-ink">{formatMoney(amountCents)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="break-all font-mono text-2xl font-bold tabular-nums text-brand-cyan">{orderNumber}</p>
            <CopyNumber value={orderNumber} />
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Put {orderNumber} in the payment note so Michael can match it to this order.
            {paymentMethod === "paypal" && " PayPal does not carry the note across, so type it there yourself."}
          </p>
          {payUrl && (
            <a
              href={payUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Pay ${formatMoney(amountCents)} with ${word}, opens ${word} in a new tab`}
              onClick={() =>
                trackEvent("review_external_click", {
                  method: paymentMethod === "venmo" ? "venmo" : "paypal",
                  value: amountCents / 100,
                  currency: "USD",
                })
              }
              className={`${PRIMARY} mt-4`}
            >
              Pay {formatMoney(amountCents)} with {word}
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </a>
          )}

          {reportedAt ? (
            <p role="status" className="mt-5 rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-3 text-sm leading-relaxed text-ink">
              Thanks. Michael confirms PayPal and Venmo payments by hand, usually within a day. This page updates when
              he does.
            </p>
          ) : (
            <form onSubmit={report} className="mt-5 max-w-lg">
              <label htmlFor="payment-reference" className="block text-sm font-semibold text-ink">
                Transaction id or the name on your PayPal or Venmo account
              </label>
              <p id="payment-reference-hint" className="mt-0.5 text-xs text-ink-muted">
                Optional, and it helps Michael find the payment.
              </p>
              <input
                id="payment-reference"
                type="text"
                value={reference}
                maxLength={120}
                aria-describedby="payment-reference-hint"
                onChange={(event) => setReference(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              />
              <button type="submit" disabled={pending} className={`${SECONDARY} mt-3 w-full sm:w-auto`}>
                {pending ? "Saving..." : "I sent the payment"}
              </button>
            </form>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      {/* A reported payment may already be on its way, so the cancel waits for Michael. */}
      {!(manual && reportedAt) && (
        <div className="mt-5 border-t border-line/70 pt-2">
          <CancelOrderButton orderId={orderId} orderNumber={orderNumber} />
        </div>
      )}
    </div>
  );
}
