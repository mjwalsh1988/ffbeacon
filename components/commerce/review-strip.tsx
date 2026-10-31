/**
 * The review on the league overview, under the Blueprint call to action and the
 * same shape: hairline, eyebrow, h2, one sentence, controls at the right. With no
 * team for this reader the links go to the checkout without a roster, and the
 * roster select is what the reader meets there.
 */

import Link from "next/link";
import type { Route } from "next";
import { formatMoney } from "@/lib/commerce/constants";
import { tierOf, type OfferState } from "@/lib/commerce/offer";
import { OfferView } from "./offer-view";
import { reviewHref } from "./product-offer";

export function ReviewStrip({
  offer,
  sleeperLeagueId,
  rosterId,
  linkUsername,
}: {
  offer: OfferState;
  sleeperLeagueId: string;
  rosterId: number | null;
  linkUsername: string | null;
}) {
  const products = offer.products.filter(
    (p) => p.family === "team-review" && p.placements.includes("league-overview"),
  );
  if (products.length === 0 || offer.availability.reason === "closed") return null;

  const booked = offer.availability.reason === "fully_booked";
  const cheapest = products.reduce((low, p) => (p.price_cents < low.price_cents ? p : low));

  return (
    <section
      aria-labelledby="review-strip-heading"
      className="relative overflow-hidden rounded-card border border-line-accent bg-surface/60 px-4 py-4 sm:px-5"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      {!booked && <OfferView placement="league-overview" />}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Personal Team Review
          </p>
          <h2 id="review-strip-heading" className="mt-1 text-[17px] font-bold leading-tight tracking-tight text-ink">
            Have Michael read your team
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {booked
              ? "Reviews are fully booked right now."
              : `A written review of your roster, your direction and the trades to make, from ${formatMoney(cheapest.price_cents)}. Delivered to your My Beacon portal.`}
          </p>
        </div>
        {!booked && (
          <div className="flex flex-col gap-2 sm:items-stretch">
            {products.map((p, i) => (
              <Link
                key={p.slug}
                href={
                  reviewHref({ sleeperLeagueId, rosterId, tier: tierOf(p), linkUsername }) as Route
                }
                className={`inline-flex min-h-11 w-full items-center justify-center rounded-card px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  i === products.length - 1
                    ? "bg-beacon text-black hover:opacity-90"
                    : "border border-line bg-base text-ink hover:border-brand-cyan/60 hover:text-brand-cyan"
                }`}
              >
                {p.name} {formatMoney(p.price_cents)}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
