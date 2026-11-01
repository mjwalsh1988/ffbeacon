"use client";

/**
 * The pieces both checkouts are built from: the numbered fieldset, the text area
 * with its counter, the payment choices, the footer with the summary, the terms
 * line and the submit button, and the hook that posts the order.
 *
 * The team review's form and the trade review's form differ only in what they ask
 * about the subject. Everything about paying, the price the form displays and
 * posts as `expectedCents`, the error alert and where the reader goes afterwards
 * is here, once, so the two can never disagree about how an order is placed.
 */

import { useId, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/app/actions/commerce";
import { trackEvent } from "@/lib/analytics";
import { formatMoney } from "@/lib/commerce/constants";
import type { CreateOrderInput } from "@/lib/commerce/intake";

export type Method = "stripe" | "paypal" | "venmo";

export const METHOD_COPY: Record<Method, { label: string; body: string }> = {
  stripe: {
    label: "Card, Apple Pay or Google Pay",
    body: "Pays on Stripe's secure page. Your order is confirmed the moment it goes through.",
  },
  paypal: {
    label: "PayPal",
    body: "You send the amount to @mjwalsh1988 with your order number in the note. We confirm it by hand, usually within a day.",
  },
  venmo: {
    label: "Venmo",
    body: "You send the amount to @mjwalsh1988 with your order number in the note. We confirm it by hand, usually within a day.",
  },
};

export const FIELD =
  "mt-1 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export const NO_METHODS = "No payment method is switched on right now. Check back shortly.";

export const CHOICE =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface/60 p-3 transition-colors hover:border-line-accent has-[:checked]:border-brand-cyan has-[:checked]:ring-1 has-[:checked]:ring-brand-cyan has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan";

export const INLINE_LINK =
  "inline-flex min-h-11 items-center text-sm font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** The payment methods the store has on, narrowed to the three a form can post. */
export function formMethods(methods: readonly string[]): Method[] {
  return methods.filter((m): m is Method => m === "stripe" || m === "paypal" || m === "venmo");
}

/**
 * One numbered section. Each legend carries a real h2, so a reader moving by
 * heading finds the sections and a reader moving by form control hears the group.
 * From `lg` the legend floats into the sheet's margin column.
 */
export function Fieldset({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 border-t border-line px-5 py-6 sm:px-8 lg:py-8">
      <legend className="float-left mb-4 w-full lg:mb-0 lg:w-44">
        <h2 className="flex items-baseline gap-3 text-sm font-bold uppercase tracking-[0.14em] text-ink">
          <span className="font-mono text-[11px] font-semibold tracking-normal text-brand-cyan">{number}</span>
          <span>{title}</span>
        </h2>
      </legend>
      <div className="clear-both min-w-0 lg:clear-none lg:ml-52">{children}</div>
    </fieldset>
  );
}

/** A labeled textarea with its hint and a "N of max" counter. */
export function TextArea({
  label,
  hint,
  max,
  value,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  max: number;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-xs leading-relaxed text-ink-muted">
        {hint}
      </p>
      <textarea
        id={id}
        value={value}
        maxLength={max}
        rows={rows}
        aria-describedby={`${id}-hint ${id}-count`}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD}
      />
      <p id={`${id}-count`} className="mt-1 text-right font-mono text-[11px] text-ink-subtle">
        {value.length} of {max}
      </p>
    </div>
  );
}

/** The radios for how to pay, or the sentence that says no payment is needed. */
export function PaymentChoices({
  free,
  available,
  method,
  onChange,
}: {
  free: boolean;
  available: Method[];
  method: Method | null;
  onChange: (method: Method) => void;
}) {
  const name = useId();
  if (free) {
    return (
      <p className="text-sm font-medium leading-relaxed text-ink">
        No payment needed. This code covers the whole review.
      </p>
    );
  }
  if (available.length === 0) {
    return <p className="text-sm leading-relaxed text-ink-muted">{NO_METHODS}</p>;
  }
  return (
    <div className="grid max-w-2xl gap-2">
      {available.map((m) => (
        <label key={m} className={CHOICE}>
          <input
            type="radio"
            name={name}
            value={m}
            checked={method === m}
            onChange={() => onChange(m)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-cyan"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{METHOD_COPY[m].label}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{METHOD_COPY[m].body}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** What the submit button says, from the state of the form. */
export function submitLabelFor(args: {
  free: boolean;
  paused: boolean;
  method: Method | null;
  total: number;
}): string {
  if (args.free) return "Order for free";
  if (args.paused) return "Ordering is paused";
  switch (args.method) {
    case "stripe":
      return `Pay ${formatMoney(args.total)} with card`;
    case "paypal":
      return "Order and pay with PayPal";
    case "venmo":
      return "Order and pay with Venmo";
    default:
      return "Pick how you want to pay";
  }
}

/** The summary sentence, the terms line, the error alert and the button. */
export function CheckoutFooter({
  summary,
  error,
  alertRef,
  pending,
  submitLabel,
}: {
  summary: string;
  error: string;
  alertRef: RefObject<HTMLDivElement | null>;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="border-t border-line bg-base/30 px-5 py-6 sm:px-8">
      <p role="status" className="text-sm font-semibold leading-relaxed text-ink">
        {summary}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        By ordering you agree to the{" "}
        <Link href="/terms" className="inline-flex min-h-11 items-center text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          Terms of Service
        </Link>
        , including the purchases section. All sales are final.
      </p>
      <div
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className={error ? "mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan" : ""}
      >
        {error}
      </div>
      <button
        type="submit"
        aria-disabled={pending}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-card bg-beacon px-6 py-3 text-base font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Placing your order..." : submitLabel}
      </button>
      <p role="status" className="sr-only">
        {pending ? "Placing your order." : ""}
      </p>
    </div>
  );
}

/**
 * Posts the order and follows the answer: Stripe's page, the order page, or the
 * sign-in page with the way back. A stale price refreshes the page so the new one
 * is on screen under the alert. `buildInput` is given the method to post, which
 * is "none" when a code covers the whole price.
 */
export function useCheckoutSubmit(args: {
  free: boolean;
  paused: boolean;
  method: Method | null;
  total: number;
  productSlug: string;
  buildInput: (method: Method | "none") => CreateOrderInput;
}) {
  const router = useRouter();
  const alertRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => alertRef.current?.focus());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (args.paused) return showError(NO_METHODS);
    if (!args.free && !args.method) return showError("Pick how you want to pay.");
    const method: Method | "none" = args.free ? "none" : (args.method as Method);

    startTransition(async () => {
      const result = await createOrderAction(args.buildInput(method));

      if (result.ok) {
        if (method !== "none") {
          trackEvent("review_checkout_start", {
            tier: args.productSlug,
            method,
            value: args.total / 100,
            currency: "USD",
          });
        }
        if (result.redirect.startsWith("https://")) window.location.assign(result.redirect);
        else router.push(result.redirect as Route);
        return;
      }
      if (result.code === "signin") {
        router.push(result.next as Route);
        return;
      }
      showError(result.message);
      if (result.code === "stale") router.refresh();
    });
  };

  return { submit, pending, error, alertRef };
}
