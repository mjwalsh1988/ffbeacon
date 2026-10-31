"use client";

/**
 * The checkout: four numbered fieldsets on one sheet.
 *
 * Each legend carries a real h2, so a reader moving by heading finds the sections
 * and a reader moving by form control hears the group. From `lg` the legend floats
 * into the sheet's margin column; a legend will not take part in a grid.
 *
 * The form shows a price and posts that price as `expectedCents`. It never sets
 * one: the server computes the total and refuses when the two differ, and this
 * page then refreshes so the new price is on screen under the alert.
 *
 * Changing the review clears an applied code rather than previewing it again,
 * because a keyboard reader's arrow keys change a radio on every press and the
 * preview is rate limited. Selection sets state; a button is the action.
 */

import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/app/actions/commerce";
import { RosterSelect } from "@/components/league-lineups/roster-select";
import { withUsername } from "@/components/league-schedule/format";
import { trackEvent } from "@/lib/analytics";
import { formatMoney } from "@/lib/commerce/constants";
import { TEAM_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import type { ReviewInProgress } from "@/lib/commerce/orders";
import type { PaymentMethod, TeamReviewDirection } from "@/lib/commerce/types";
import type { LineupTeamOption } from "@/lib/league-lineups/types";
import { CouponField, type AppliedCoupon } from "./coupon-field";
import { ReviewInProgressNotice } from "./review-in-progress-notice";
import { TierChoiceCard, type TierCardProduct } from "./tier-card";

type Method = "stripe" | "paypal" | "venmo";

const METHOD_COPY: Record<Method, { label: string; body: string }> = {
  stripe: {
    label: "Card, Apple Pay or Google Pay",
    body: "Pays on Stripe's secure page. Your order is confirmed the moment it goes through.",
  },
  paypal: {
    label: "PayPal",
    body: "You send the amount to @mjwalsh1988 with your order number in the note. Michael confirms it by hand, usually within a day.",
  },
  venmo: {
    label: "Venmo",
    body: "You send the amount to @mjwalsh1988 with your order number in the note. Michael confirms it by hand, usually within a day.",
  },
};

const FIELD =
  "mt-1 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

const NO_METHODS = "No payment method is switched on right now. Check back shortly.";

const CHOICE =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface/60 p-3 transition-colors hover:border-line-accent has-[:checked]:border-brand-cyan has-[:checked]:ring-1 has-[:checked]:ring-brand-cyan has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan";

function Fieldset({
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

/** A labeled textarea with its hint and a "N of max" counter, shared with the intake update form. */
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

export function CheckoutForm({
  sleeperLeagueId,
  leagueName,
  linkUsername,
  products,
  initialSlug,
  teams,
  initialRosterId,
  methods,
  couponsEnabled,
  inProgress,
  sourceSlug,
}: {
  sleeperLeagueId: string;
  leagueName: string;
  linkUsername: string | null;
  products: TierCardProduct[];
  initialSlug: string;
  teams: LineupTeamOption[];
  initialRosterId: number;
  methods: PaymentMethod[];
  couponsEnabled: boolean;
  /** The reader's reviews in progress here, by roster id. */
  inProgress: Record<number, ReviewInProgress>;
  /** The value source on screen, so the order stores the Blueprint the reader saw. */
  sourceSlug: string | null;
}) {
  const router = useRouter();
  const groupName = useId();
  const directionName = useId();
  const methodName = useId();
  const alertRef = useRef<HTMLDivElement>(null);

  const available = useMemo(
    () => methods.filter((m): m is Method => m === "stripe" || m === "paypal" || m === "venmo"),
    [methods],
  );

  const [slug, setSlug] = useState(initialSlug);
  const [rosterId, setRosterId] = useState(initialRosterId);
  const [direction, setDirection] = useState<TeamReviewDirection>("unsure");
  const [questions, setQuestions] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [method, setMethod] = useState<Method | null>(available[0] ?? null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponNote, setCouponNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const product = products.find((p) => p.slug === slug) ?? products[0];
  const team = teams.find((t) => t.sleeperRosterId === rosterId) ?? teams[0];
  const total = coupon ? coupon.amountCents : product.price_cents;
  const free = total === 0;

  const pickProduct = (nextSlug: string) => {
    setSlug(nextSlug);
    if (coupon) {
      setCouponNote(`${coupon.code} was removed. Apply it again for this review.`);
      setCoupon(null);
    }
  };

  const applyCoupon = (next: AppliedCoupon | null) => {
    setCouponNote(null);
    setCoupon(next);
  };

  const summary = coupon
    ? `${product.name} for ${team.teamName} in ${leagueName}: ${formatMoney(product.price_cents)}, ${formatMoney(coupon.discountCents)} off with ${coupon.code}: ${formatMoney(total)}, one time`
    : `${product.name} for ${team.teamName} in ${leagueName}: ${formatMoney(total)}, one time`;

  const paused = !free && available.length === 0;
  const submitLabel = free
    ? "Order for free"
    : paused
      ? "Ordering is paused"
      : method === "stripe"
        ? `Pay ${formatMoney(total)} with card`
        : method === "paypal"
          ? "Order and pay with PayPal"
          : method === "venmo"
            ? "Order and pay with Venmo"
            : "Pick how you want to pay";

  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => alertRef.current?.focus());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (paused) return showError(NO_METHODS);
    if (!free && !method) return showError("Pick how you want to pay.");

    startTransition(async () => {
      const result = await createOrderAction({
        productSlug: product.slug,
        sleeperLeagueId,
        rosterId,
        paymentMethod: free ? "none" : method,
        expectedCents: total,
        couponCode: coupon?.code ?? "",
        sourceSlug,
        intake: { direction, questions, offLimits },
      });

      if (result.ok) {
        if (!free && method) {
          trackEvent("review_checkout_start", {
            tier: product.slug,
            method,
            value: total / 100,
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

  const blueprintHref = withUsername(
    `/leagues/${sleeperLeagueId}/blueprint?roster=${rosterId}`,
    linkUsername,
  );

  return (
    <form onSubmit={submit} noValidate>
      <ReviewInProgressNotice review={inProgress[rosterId] ?? null} />

      <Fieldset number="01" title="Which review">
        {/* The fieldset is the group; a second radiogroup role here would announce it twice. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((p) => (
            <TierChoiceCard
              key={p.slug}
              product={p}
              name={groupName}
              checked={p.slug === slug}
              onChange={() => pickProduct(p.slug)}
            />
          ))}
        </div>
      </Fieldset>

      <Fieldset number="02" title="Which team">
        <div className="max-w-md">
          <RosterSelect
            id="checkout-roster"
            rosterId={rosterId}
            teams={teams}
            onChange={setRosterId}
            visibleLabel
          />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Michael reviews the team as it stands when he starts, and reads the Blueprint you see now.
        </p>
        <Link
          href={blueprintHref as Route}
          className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Open this team&apos;s Blueprint
        </Link>
      </Fieldset>

      <Fieldset number="03" title="Tell Michael about your situation">
        <div className="max-w-2xl space-y-5">
          <fieldset className="min-w-0">
            <legend className="text-sm font-semibold text-ink">
              {TEAM_REVIEW_QUESTIONS.direction.legend}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {TEAM_REVIEW_QUESTIONS.direction.options.map((option) => (
                <label key={option.value} className={`${CHOICE} items-center`}>
                  <input
                    type="radio"
                    name={directionName}
                    value={option.value}
                    checked={direction === option.value}
                    onChange={() => setDirection(option.value)}
                    className="h-4 w-4 shrink-0 accent-brand-cyan"
                  />
                  <span className="text-sm font-medium text-ink">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextArea
            label={TEAM_REVIEW_QUESTIONS.questions.label}
            hint={TEAM_REVIEW_QUESTIONS.questions.hint}
            max={TEAM_REVIEW_QUESTIONS.questions.max}
            value={questions}
            rows={5}
            onChange={setQuestions}
          />
          <TextArea
            label={TEAM_REVIEW_QUESTIONS.offLimits.label}
            hint={TEAM_REVIEW_QUESTIONS.offLimits.hint}
            max={TEAM_REVIEW_QUESTIONS.offLimits.max}
            value={offLimits}
            rows={3}
            onChange={setOffLimits}
          />
        </div>
      </Fieldset>

      {couponsEnabled && (
        <>
          <CouponField productSlug={product.slug} applied={coupon} onApply={applyCoupon} />
          {/* Outside the disclosure, so a closed "Have a code?" still says why the total moved. */}
          <p role="status" className={couponNote ? "px-5 pb-2 text-sm text-ink-muted sm:px-8" : "sr-only"}>
            {couponNote ?? ""}
          </p>
        </>
      )}

      <Fieldset number="04" title="How you want to pay">
        {free ? (
          <p className="text-sm font-medium leading-relaxed text-ink">
            No payment needed. This code covers the whole review.
          </p>
        ) : available.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-muted">{NO_METHODS}</p>
        ) : (
          <div className="grid max-w-2xl gap-2">
            {available.map((m) => (
              <label key={m} className={CHOICE}>
                <input
                  type="radio"
                  name={methodName}
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-cyan"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{METHOD_COPY[m].label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{METHOD_COPY[m].body}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </Fieldset>

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
    </form>
  );
}
