"use client";

/**
 * The Trade Review's checkout. Same sheet, same footer, same action as the team
 * review's; the difference is that the subject arrived with the link (the saved
 * Signal Check result) so there is nothing to choose, and one note instead of
 * three questions.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { formatMoney } from "@/lib/commerce/constants";
import { tradeLine } from "@/lib/commerce/describe";
import { TRADE_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import type { PaymentMethod } from "@/lib/commerce/types";
import type { PublicSharePayload } from "@/lib/signal-check/types";
import {
  CheckoutFooter,
  Fieldset,
  INLINE_LINK,
  PaymentChoices,
  TextArea,
  formMethods,
  submitLabelFor,
  useCheckoutSubmit,
  type Method,
} from "./checkout-parts";
import { CouponField, type AppliedCoupon } from "./coupon-field";
import { TierCardStatic, type TierCardProduct } from "./tier-card";
import { TradeSummary } from "./trade-summary";

export function TradeReviewCheckoutForm({
  shareId,
  product,
  trade,
  shareHref,
  methods,
  couponsEnabled,
}: {
  shareId: string;
  product: TierCardProduct;
  trade: PublicSharePayload;
  /** The public share page, or null for a private save. */
  shareHref: string | null;
  methods: PaymentMethod[];
  couponsEnabled: boolean;
}) {
  const available = useMemo(() => formMethods(methods), [methods]);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Method | null>(available[0] ?? null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  const total = coupon ? coupon.amountCents : product.price_cents;
  const free = total === 0;
  const paused = !free && available.length === 0;
  const line = tradeLine(trade);

  const summary = coupon
    ? `${product.name} of ${line}: ${formatMoney(product.price_cents)}, ${formatMoney(coupon.discountCents)} off with ${coupon.code}: ${formatMoney(total)}, one time`
    : `${product.name} of ${line}: ${formatMoney(total)}, one time`;

  const { submit, pending, error, alertRef } = useCheckoutSubmit({
    free,
    paused,
    method,
    total,
    productSlug: product.slug,
    buildInput: (paymentMethod) => ({
      kind: "trade-review",
      productSlug: product.slug,
      shareId,
      paymentMethod,
      expectedCents: total,
      couponCode: coupon?.code ?? "",
      intake: { notes },
    }),
  });

  return (
    <form onSubmit={submit} noValidate>
      <Fieldset number="01" title="What you get">
        <div className="max-w-md">
          <TierCardStatic product={product} highlight />
        </div>
      </Fieldset>

      <Fieldset number="02" title="The trade">
        <div className="max-w-2xl">
          <TradeSummary trade={trade} />
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            We review this trade as Signal Check priced it when you ran it. Change the pieces and run it again
            if this is not the deal you meant.
          </p>
          {shareHref && (
            <Link href={shareHref as Route} className={`mt-1 ${INLINE_LINK}`}>
              Open this verdict in Signal Check
            </Link>
          )}
        </div>
      </Fieldset>

      <Fieldset number="03" title="Anything we should know">
        <div className="max-w-2xl">
          <TextArea
            label={TRADE_REVIEW_QUESTIONS.notes.label}
            hint={TRADE_REVIEW_QUESTIONS.notes.hint}
            max={TRADE_REVIEW_QUESTIONS.notes.max}
            value={notes}
            rows={4}
            onChange={setNotes}
          />
        </div>
      </Fieldset>

      {couponsEnabled && <CouponField productSlug={product.slug} applied={coupon} onApply={setCoupon} />}

      <Fieldset number="04" title="How you want to pay">
        <PaymentChoices free={free} available={available} method={method} onChange={setMethod} />
      </Fieldset>

      <CheckoutFooter
        summary={summary}
        error={error}
        alertRef={alertRef}
        pending={pending}
        submitLabel={submitLabelFor({ free, paused, method, total })}
      />
    </form>
  );
}
