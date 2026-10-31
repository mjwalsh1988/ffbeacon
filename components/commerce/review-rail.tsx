/**
 * The Personal Team Review in the Blueprint's right rail, from xl up. A reader on
 * a wide screen meets the offer beside the report instead of under twelve
 * sections of it; the full cards and everything included stay in section 13,
 * which the rail links down to, so nothing is only here.
 *
 * Counts no view: section 13 on the same page does.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import type { OfferAvailability } from "@/lib/commerce/availability";
import { formatMoney } from "@/lib/commerce/constants";
import { tierOf } from "@/lib/commerce/offer";
import type { CommerceSettings } from "@/lib/commerce/settings";
import type { Product } from "@/lib/commerce/types";
import { REVIEW_SECTION_ID, OFFER_SURFACE } from "./review-offer-section";
import { reviewHref, withinDays } from "./review-href";

export function ReviewRail({
  teamName,
  sleeperLeagueId,
  rosterId,
  linkUsername,
  products,
  availability,
  settings,
}: {
  teamName: string;
  sleeperLeagueId: string;
  rosterId: number | null;
  linkUsername: string | null;
  products: Product[];
  availability: OfferAvailability;
  settings: CommerceSettings;
}) {
  const offered = products.filter((p) => p.family === "team-review" && p.placements.includes("blueprint"));
  if (offered.length === 0 || availability.reason === "closed") return null;
  const booked = availability.reason === "fully_booked";

  return (
    <section
      aria-labelledby="review-rail-heading"
      className={`relative overflow-hidden rounded-card border border-brand-purple/40 p-5 shadow-[0_0_64px_-24px_rgba(168,85,247,0.6)] ${OFFER_SURFACE}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-beacon" />
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Personal Team Review</p>
      <h2 id="review-rail-heading" className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight text-ink">
        {booked ? "Reviews are fully booked" : `Get the plan for ${teamName} written out, by hand`}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        {booked
          ? settings.storefront.fullyBookedMessage
          : "We read the roster, the league's own numbers and this Blueprint, then write you the moves to make and who to call."}
      </p>

      {!booked && (
        <>
          <ul role="list" className="mt-4 space-y-2">
            {offered.map((product) => {
              const lead = product.badge != null;
              return (
                <li key={product.slug}>
                  <Link
                    href={reviewHref({ sleeperLeagueId, rosterId, tier: tierOf(product), linkUsername }) as Route}
                    className={`flex min-h-14 items-center justify-between gap-3 rounded-card border px-4 py-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      lead
                        ? "border-brand-cyan/60 bg-base/60 ring-1 ring-brand-cyan/40 hover:border-brand-cyan"
                        : "border-line bg-base/60 hover:border-brand-cyan/60"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink">{product.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {withinDays(product.turnaround_days)}
                        {product.badge ? `, ${product.badge.toLowerCase()}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-lg font-black tabular-nums text-ink">
                        {formatMoney(product.price_cents)}
                      </span>
                      <ArrowRight aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <a
            href={`#${REVIEW_SECTION_ID}`}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See everything that is included
          </a>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
            One-time payment. Delivered to your My Beacon portal.
          </p>
        </>
      )}
    </section>
  );
}
