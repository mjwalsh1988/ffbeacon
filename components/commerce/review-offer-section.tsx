/**
 * Section 13 of the Blueprint: the Personal Team Review, sold.
 *
 * The twelve sections above it are a report card, and this one is a pitch, so it
 * does not dress like them: a tinted ground, a gradient rule across the top, a
 * display-size headline in the body and the two review cards with the one we
 * lead with lit. The margin column keeps the sheet's number and title so the
 * heading outline still reads as one document.
 *
 * Which reviews appear is `products.placements` (plan 3.2). The view event is
 * counted here and only here: the strip and the rail on the same page pass
 * countView false, so one page load is one view.
 */

import { Check } from "lucide-react";
import type { OfferAvailability } from "@/lib/commerce/availability";
import { formatMoney } from "@/lib/commerce/constants";
import { tierOf } from "@/lib/commerce/offer";
import type { CommerceSettings } from "@/lib/commerce/settings";
import type { Product } from "@/lib/commerce/types";
import { OfferView } from "./offer-view";
import { payWays, reviewHref } from "./review-href";
import { TierOfferCard } from "./tier-card";

export const REVIEW_SECTION_ID = "review";

/** The tinted ground the sales surfaces share: purple at one corner, cyan at the other. */
export const OFFER_SURFACE =
  "bg-[linear-gradient(135deg,rgba(168,85,247,0.16)_0%,rgba(15,15,26,0.35)_42%,rgba(34,211,238,0.14)_100%)]";

export function ReviewOfferSection({
  number,
  teamName,
  sleeperLeagueId,
  rosterId,
  linkUsername,
  products,
  availability,
  settings,
}: {
  number: string;
  teamName: string;
  sleeperLeagueId: string;
  /** Null when no team was chosen, so the cards cannot name one. */
  rosterId: number | null;
  linkUsername: string | null;
  products: Product[];
  availability: OfferAvailability;
  settings: CommerceSettings;
}) {
  const offered = products.filter((p) => p.family === "team-review" && p.placements.includes("blueprint"));
  if (offered.length === 0 || availability.reason === "closed") return null;

  const booked = availability.reason === "fully_booked";
  const cheapest = offered.reduce((low, p) => (p.price_cents < low.price_cents ? p : low));
  const ways = payWays(availability.methods);

  return (
    <section
      id={REVIEW_SECTION_ID}
      aria-labelledby={`${REVIEW_SECTION_ID}-title`}
      className={`relative scroll-mt-40 border-t border-brand-purple/40 px-5 py-8 sm:px-8 lg:py-10 ${OFFER_SURFACE}`}
    >
      {/* The rule above this section is the gradient, where every other section's is a hairline. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-beacon" />
      <div className="grid gap-5 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0 lg:sticky lg:top-[9.5rem] lg:self-start">
          <h2
            id={`${REVIEW_SECTION_ID}-title`}
            className="flex items-baseline gap-3 text-sm font-bold uppercase tracking-[0.14em] text-ink"
          >
            <span className="font-mono text-[11px] font-semibold tracking-normal text-brand-cyan">{number}</span>
            <span>Personal Team Review</span>
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            The Blueprint is the numbers. This is the read, written for you by hand.
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Go beyond the Blueprint</p>
          <p className="mt-2 max-w-3xl text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
            {booked
              ? "Reviews are fully booked right now"
              : `Want the plan for ${teamName} written out? We will do it by hand.`}
          </p>
          {booked ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
              {settings.storefront.fullyBookedMessage}
            </p>
          ) : (
            <>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
                We go through this roster, your league&apos;s own values and everything on this page, then write you a
                plain-English plan: where you really stand, the trades worth offering, who in your league to call, and
                what to leave alone. Reviews start at {formatMoney(cheapest.price_cents)} and land in your My Beacon
                portal, with an email the moment yours is ready.
              </p>
              <OfferView placement="blueprint" />
              {rosterId == null && (
                <p className="mt-4 text-sm font-medium leading-relaxed text-ink">
                  Pick your team at the top of the page and the review is written about it.
                </p>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {offered.map((product) => (
                  <TierOfferCard
                    key={product.slug}
                    product={product}
                    highlight={product.badge != null}
                    href={reviewHref({ sleeperLeagueId, rosterId, tier: tierOf(product), linkUsername })}
                  />
                ))}
              </div>
              <ul role="list" className="mt-6 grid gap-2 sm:grid-cols-3">
                {[
                  "Written by hand from your league's own numbers, never generated",
                  "Delivered to your My Beacon portal, and you keep it for good",
                  ways ? `Pay by ${ways}, one time` : "One-time payment, no subscription",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-2 text-sm leading-snug text-ink-muted">
                    <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
                    <span className="min-w-0">{point}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
