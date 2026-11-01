"use client";

/**
 * The Personal Team Review, offered the moment a draft finishes.
 *
 * The screen above it has just handed the drafter a grade and a rank. This is
 * the one paid thing on it: a person reads the roster they just built. It sits
 * between the look-back panel and the League Pulse handoff, on the offer's
 * tinted ground so it reads as the thing that is for sale, with the two prices
 * set at the size the grade is set above them. Counted once per screen.
 *
 * Checkout links name the league and, when we know it, the reader's roster. The
 * league has to be known: a draft with no Sleeper league has no team to review,
 * and the caller passes null, so nothing renders.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Check, PenLine } from "lucide-react";
import { formatMoney } from "@/lib/commerce/constants";
import type { OfferProduct, PublicOffer } from "@/lib/commerce/public-offer";
import { tierOf } from "@/lib/commerce/public-offer";
import { OFFER_SURFACE } from "./offer-surface";
import { OfferView } from "./offer-view";
import { payWays, reviewHref, withinDays } from "./review-href";
import { StatusChip } from "./status-chip";

const BEACON_HAIRLINE =
  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)";

function Price({ cents }: { cents: number }) {
  const dollars = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return (
    <p className="font-mono font-black leading-none tabular-nums text-ink">
      <span className="text-5xl">${dollars.toLocaleString("en-US")}</span>
      <span className="align-top text-2xl">.{rest}</span>
    </p>
  );
}

function TierRow({
  product,
  href,
  lead,
}: {
  product: OfferProduct;
  href: string;
  lead: boolean;
}) {
  return (
    <li
      className={`flex flex-col gap-4 rounded-card border p-4 sm:p-5 ${
        lead
          ? "border-brand-cyan/60 bg-base/70 ring-1 ring-brand-cyan/40 shadow-[0_0_48px_-16px_rgba(34,211,238,0.55)]"
          : "border-line-accent bg-base/60"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-lg font-bold tracking-tight text-ink">{product.name}</p>
        {product.badge && <StatusChip chip={{ word: product.badge, tone: "purple" }} />}
      </div>
      <Price cents={product.price_cents} />
      <p className="text-sm font-medium text-brand-cyan">
        In your My Beacon portal {withinDays(product.turnaround_days)} of payment
      </p>
      {product.tagline && <p className="text-sm leading-relaxed text-ink-muted">{product.tagline}</p>}
      <Link
        href={href as Route}
        className={`mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-card px-5 py-2.5 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          lead
            ? "bg-beacon text-black hover:opacity-90"
            : "border border-line-accent bg-surface text-ink hover:border-brand-cyan/60 hover:text-brand-cyan"
        }`}
      >
        Order the {product.name}
        <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
      </Link>
    </li>
  );
}

export function PostDraftOffer({
  offer,
  sleeperLeagueId,
  rosterId,
  linkUsername,
}: {
  offer: PublicOffer | null;
  sleeperLeagueId: string | null;
  /** The reader's roster when we know which one is theirs. */
  rosterId: number | null;
  linkUsername: string | null;
}) {
  if (!offer || !sleeperLeagueId) return null;
  const products = offer.products.filter((p) => p.family === "team-review");
  if (products.length === 0) return null;
  const booked = offer.availability.reason === "fully_booked";
  const ways = payWays(offer.availability.methods);
  const cheapest = products.reduce((low, p) => (p.price_cents < low.price_cents ? p : low));

  return (
    <section
      aria-labelledby="otc-post-draft-offer-title"
      className={`relative overflow-hidden rounded-modal border border-brand-purple/40 p-5 shadow-[0_0_110px_-50px_rgba(168,85,247,0.75)] sm:p-7 ${OFFER_SURFACE}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ backgroundImage: BEACON_HAIRLINE }}
      />
      {!booked && <OfferView placement="on-the-clock" />}

      <div className="relative">
        <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
          >
            <PenLine className="h-3.5 w-3.5" />
          </span>
          Personal Team Review
        </p>
        <h3
          id="otc-post-draft-offer-title"
          className="mt-3 max-w-3xl text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl"
        >
          {booked ? "Reviews are fully booked right now" : "Just drafted? Have a person read this roster."}
        </h3>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
          {booked
            ? offer.fullyBookedMessage
            : `The grade above is the math. We go through the team you just built, your league's own values and its Team Blueprint, then write you a plain-English plan: where you stand out of the gate, who to move while his price is high, who to hold, and the trades worth offering before week one. From ${formatMoney(cheapest.price_cents)}, written by hand.`}
        </p>

        {!booked && (
          <>
            <ul role="list" className="mt-6 grid gap-3 sm:grid-cols-2">
              {products.map((product) => (
                <TierRow
                  key={product.slug}
                  product={product}
                  lead={product.badge != null}
                  href={reviewHref({ sleeperLeagueId, rosterId, tier: tierOf(product), linkUsername })}
                />
              ))}
            </ul>
            <ul role="list" className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                "Written by hand from your league's own numbers",
                "Delivered to your My Beacon portal, and you keep it for good",
                ways ? `Pay by ${ways}, one time` : "One-time payment, no subscription",
              ].map((point) => (
                <li key={point} className="flex items-start gap-2 text-sm leading-snug text-ink-muted">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
            {rosterId == null && (
              <p className="mt-4 text-sm leading-relaxed text-ink">
                We could not tell which team is yours from this room, so the order page asks you to pick it.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
