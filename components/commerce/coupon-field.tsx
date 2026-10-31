"use client";

/**
 * "Have a code?" A disclosure holding one input and one button. The result is
 * announced in a status region inside the disclosure. Applying is a button rather
 * than a keystroke because the preview is rate limited.
 */

import { useId, useState, useTransition } from "react";
import { previewCouponAction } from "@/app/actions/commerce";
import { formatMoney } from "@/lib/commerce/constants";

export type AppliedCoupon = { code: string; discountCents: number; amountCents: number };

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60";

export function CouponField({
  productSlug,
  applied,
  onApply,
}: {
  productSlug: string;
  applied: AppliedCoupon | null;
  onApply: (coupon: AppliedCoupon | null) => void;
}) {
  const inputId = useId();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const apply = () => {
    startTransition(async () => {
      const result = await previewCouponAction(productSlug, code);
      if (result.ok) {
        onApply({
          code: result.code,
          discountCents: result.discountCents,
          amountCents: result.amountCents,
        });
        setMessage(
          `${result.code} applied: ${formatMoney(result.discountCents)} off. New total ${formatMoney(result.amountCents)}.`,
        );
      } else {
        onApply(null);
        setMessage(result.message);
      }
    });
  };

  const remove = () => {
    onApply(null);
    setCode("");
    setMessage("Code removed.");
  };

  return (
    <details className="border-t border-line px-5 py-4 sm:px-8">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        Have a code?
      </summary>
      <div className="mt-2 max-w-md">
        <label htmlFor={inputId} className="block text-xs font-medium text-ink-subtle">
          Code
        </label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id={inputId}
            type="text"
            value={code}
            maxLength={24}
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(event) => setCode(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-card border border-line bg-base px-3 font-mono text-sm uppercase text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <button
            type="button"
            onClick={apply}
            disabled={pending || code.trim() === ""}
            className={BUTTON}
          >
            {pending ? "Checking..." : "Apply"}
          </button>
          {applied && (
            <button type="button" onClick={remove} className={BUTTON}>
              Remove
            </button>
          )}
        </div>
        <p role="status" className="mt-2 min-h-5 text-sm text-ink-muted">
          {message}
        </p>
      </div>
    </details>
  );
}
