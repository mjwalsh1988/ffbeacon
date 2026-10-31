/**
 * The Personal Team Review as a strip: on the league overview under the Blueprint
 * call to action, and at the top of the Blueprint below xl, where there is no rail
 * to carry it. The same shape as the Blueprint strip (eyebrow, h2, one paragraph,
 * controls at the right) but on the offer's tinted ground with a lit border, so it
 * reads as the one thing on the page that is for sale.
 *
 * Each review is a link straight to its checkout; `detailHref` is the way to the
 * sales section for a reader who wants the full list first. With no team for this
 * reader the links go to the checkout without a roster, and the roster select is
 * what the reader meets there.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/commerce/constants";
import { tierOf, type OfferState } from "@/lib/commerce/offer";
import type { ProductPlacement } from "@/lib/commerce/types";
import { OfferView } from "./offer-view";
import { OFFER_SURFACE } from "./review-offer-section";
import { reviewHref } from "./review-href";

export function ReviewStrip({
  offer,
  placement,
  sleeperLeagueId,
  rosterId,
  linkUsername,
  teamName = null,
  detailHref,
  countView = true,
  className = "",
}: {
  offer: OfferState;
  /** Which placement's products to show, and which view to count. */
  placement: Extract<ProductPlacement, "league-overview" | "blueprint">;
  sleeperLeagueId: string;
  rosterId: number | null;
  linkUsername: string | null;
  teamName?: string | null;
  /** Where "See what is included" goes: the Blueprint's sales section. */
  detailHref: string;
  /** False where another surface on the same page already counts the view. */
  countView?: boolean;
  className?: string;
}) {
  const products = offer.products.filter((p) => p.family === "team-review" && p.placements.includes(placement));
  if (products.length === 0 || offer.availability.reason === "closed") return null;

  const booked = offer.availability.reason === "fully_booked";
  const cheapest = products.reduce((low, p) => (p.price_cents < low.price_cents ? p : low));

  return (
    <section
      aria-labelledby="review-strip-heading"
      className={`relative overflow-hidden rounded-card border border-brand-purple/40 px-4 py-5 shadow-[0_0_64px_-24px_rgba(168,85,247,0.55)] sm:px-5 ${OFFER_SURFACE} ${className}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-beacon" />
      {!booked && countView && <OfferView placement={placement} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Personal Team Review</p>
          <h2 id="review-strip-heading" className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-ink sm:text-2xl">
            {booked
              ? "Reviews are fully booked right now"
              : teamName
                ? `Get a game plan written for ${teamName}`
                : "Get a game plan written for your team"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {booked
              ? offer.settings.storefront.fullyBookedMessage
              : `We read your roster against your league's own numbers and your Team Blueprint, then write you a plain-English plan: where you really stand, the trades worth offering and who to call. From ${formatMoney(cheapest.price_cents)}, written by hand and delivered to your My Beacon portal.`}
          </p>
          {!booked && (
            <Link
              href={detailHref as Route}
              className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              See what is included
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        {!booked && (
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch">
            {products.map((p) => {
              const lead = p.badge != null;
              return (
                <Link
                  key={p.slug}
                  href={reviewHref({ sleeperLeagueId, rosterId, tier: tierOf(p), linkUsername }) as Route}
                  className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card px-5 py-2.5 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-w-[13rem] ${
                    lead
                      ? "bg-beacon text-black hover:opacity-90"
                      : "border border-line-accent bg-base/70 text-ink hover:border-brand-cyan/60 hover:text-brand-cyan"
                  }`}
                >
                  <span>{p.name}</span>
                  <span className="font-mono tabular-nums">{formatMoney(p.price_cents)}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
