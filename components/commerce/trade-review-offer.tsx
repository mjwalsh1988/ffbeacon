"use client";

/**
 * The Trade Review, offered above a Signal Check result. A reader has just been
 * handed a verdict by a formula; this is the one place on the page where a person
 * offers to read the same trade. The price is the figure the eye lands on, set
 * the size the Blueprint sets a grade, and the button saves the trade and goes to
 * the checkout. Counted once per result shown.
 */

import { ArrowRight, Check, Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/commerce/constants";
import type { PublicOffer } from "@/lib/commerce/public-offer";
import { OFFER_SURFACE } from "./offer-surface";
import { OfferView } from "./offer-view";
import { payWays, withinDays } from "./review-href";

export function TradeReviewOffer({
  offer,
  onOrder,
  pending,
}: {
  offer: PublicOffer;
  /** Saves the trade and goes to the checkout. */
  onOrder: () => void;
  pending: boolean;
}) {
  const product = offer.products.find((p) => p.family === "trade-review") ?? null;
  if (!product) return null;
  const booked = offer.availability.reason === "fully_booked";
  const ways = payWays(offer.availability.methods);
  const dollars = Math.floor(product.price_cents / 100);
  const cents = String(product.price_cents % 100).padStart(2, "0");

  return (
    <section
      aria-labelledby="trade-review-offer-heading"
      className={`relative overflow-hidden rounded-card border border-brand-purple/40 px-4 py-5 shadow-[0_0_64px_-24px_rgba(168,85,247,0.55)] sm:px-6 sm:py-6 ${OFFER_SURFACE}`}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-beacon" />
      {!booked && <OfferView placement="trade-calculator" />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-cyan">{product.name}</p>
          <h2 id="trade-review-offer-heading" className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-ink sm:text-2xl">
            {booked ? "Trade Reviews are fully booked right now" : "Want a person to read this trade?"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {booked
              ? offer.fullyBookedMessage
              : "The verdict below is the math. Send us this exact trade and we write back what we think: whether we would take it, where it is light or heavy, how we would change it, and one or two other deals worth offering instead."}
          </p>
          {/* The product's own tagline carries how fast it usually comes back, so the admin can change it. */}
          {!booked && product.tagline && (
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-brand-cyan">{product.tagline}</p>
          )}
          {!booked && (
            <ul role="list" className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {[
                "Written by hand",
                `In your My Beacon portal ${withinDays(product.turnaround_days)}`,
                ways ? `Pay by ${ways}` : "One-time payment",
              ].map((point) => (
                <li key={point} className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
                  {point}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!booked && (
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <p className="font-mono font-black leading-none tabular-nums text-ink">
              <span className="text-5xl sm:text-6xl">${dollars}</span>
              <span className="align-top text-2xl">.{cents}</span>
              <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-subtle lg:text-right">
                one time
              </span>
            </p>
            <button
              type="button"
              onClick={onOrder}
              aria-disabled={pending}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-60 sm:w-auto sm:min-w-[16rem]"
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : null}
              {pending ? "Saving this trade..." : `Have us review this trade, ${formatMoney(product.price_cents)}`}
              {!pending && <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
            </button>
            <p role="status" className="sr-only">
              {pending ? "Saving this trade, then opening the order page." : ""}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
