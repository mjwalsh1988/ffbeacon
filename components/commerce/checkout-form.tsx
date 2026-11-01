"use client";

/**
 * The team review's checkout: four numbered fieldsets on one sheet.
 *
 * Which review, which team, the three questions, and how to pay. The paying half
 * (the price the form displays and posts as `expectedCents`, the methods, the
 * footer and where the reader goes next) is the shared machinery in
 * checkout-parts.tsx, so this file is only the questions a team review asks.
 *
 * Changing the review clears an applied code rather than previewing it again,
 * because a keyboard reader's arrow keys change a radio on every press and the
 * preview is rate limited. Selection sets state; a button is the action.
 */

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { RosterSelect } from "@/components/league-lineups/roster-select";
import { withUsername } from "@/components/league-schedule/format";
import { formatMoney } from "@/lib/commerce/constants";
import { TEAM_REVIEW_QUESTIONS } from "@/lib/commerce/intake";
import type { ReviewInProgress } from "@/lib/commerce/orders";
import type { PaymentMethod, TeamReviewDirection } from "@/lib/commerce/types";
import type { LineupTeamOption } from "@/lib/league-lineups/types";
import {
  CHOICE,
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
import { ReviewInProgressNotice } from "./review-in-progress-notice";
import { TierChoiceCard, type TierCardProduct } from "./tier-card";

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
  const groupName = useId();
  const directionName = useId();

  const available = useMemo(() => formMethods(methods), [methods]);

  const [slug, setSlug] = useState(initialSlug);
  const [rosterId, setRosterId] = useState(initialRosterId);
  const [direction, setDirection] = useState<TeamReviewDirection>("unsure");
  const [questions, setQuestions] = useState("");
  const [offLimits, setOffLimits] = useState("");
  const [method, setMethod] = useState<Method | null>(available[0] ?? null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponNote, setCouponNote] = useState<string | null>(null);

  const product = products.find((p) => p.slug === slug) ?? products[0];
  const team = teams.find((t) => t.sleeperRosterId === rosterId) ?? teams[0];
  const total = coupon ? coupon.amountCents : product.price_cents;
  const free = total === 0;
  const paused = !free && available.length === 0;

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

  const { submit, pending, error, alertRef } = useCheckoutSubmit({
    free,
    paused,
    method,
    total,
    productSlug: product.slug,
    buildInput: (paymentMethod) => ({
      kind: "team-review",
      productSlug: product.slug,
      sleeperLeagueId,
      rosterId,
      paymentMethod,
      expectedCents: total,
      couponCode: coupon?.code ?? "",
      sourceSlug,
      intake: { direction, questions, offLimits },
    }),
  });

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
          We review the team as it stands when we start, and we read the Blueprint you see now.
        </p>
        <Link href={blueprintHref as Route} className={`mt-1 ${INLINE_LINK}`}>
          Open this team&apos;s Blueprint
        </Link>
      </Fieldset>

      <Fieldset number="03" title="Tell us about your situation">
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
