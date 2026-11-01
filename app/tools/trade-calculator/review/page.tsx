import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { buildTradeReviewContext } from "@/lib/commerce/context";
import { loadOfferState } from "@/lib/commerce/offer";
import { Panel } from "@/components/dashboard-panel";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { Sheet } from "@/components/league-blueprint/sheet";
import { TierCardStatic } from "@/components/commerce/tier-card";
import { TradeReviewCheckoutForm } from "@/components/commerce/trade-review-checkout-form";
import { tradeReviewHref } from "@/components/commerce/review-href";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trade Review",
  description: "We read the trade you ran through Signal Check and write back what we think.",
  robots: { index: false, follow: true },
};

const FAMILY = "trade-review";
const TITLE_ID = "checkout-title";
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Trade Review's checkout. The trade comes in by its share id, saved by
 * Signal Check the moment the reader pressed the offer, so nothing about the
 * trade is taken from the browser and the price comes from the product row.
 */
export default async function TradeReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  const sp = await searchParams;
  const shareId = typeof sp.trade === "string" ? sp.trade : "";
  if (!SHARE_ID.test(shareId)) notFound();

  const supabase = await createClient();
  const admin = createAdminClient();
  const [
    offer,
    {
      data: { user },
    },
  ] = await Promise.all([loadOfferState(admin), supabase.auth.getUser()]);

  const product = offer.products.find((p) => p.family === FAMILY) ?? null;
  const availability = offer.availability;
  const here = tradeReviewHref(shareId);

  // The trade is read for a signed-in reader only after the store is confirmed
  // open: a closed store needs no row. A private save made by someone else reads
  // as missing.
  const context =
    product && availability.reason !== "closed" && user
      ? await buildTradeReviewContext(admin, shareId, user.id)
      : null;
  if (product && availability.reason !== "closed" && user && !context) notFound();

  return (
    <main id="main">
      <SetBreadcrumbLabel value="Trade Review" />
      <PageBody>
        <PageMasthead
          eyebrow="Signal Check"
          title="Trade Review"
          titleId="trade-review-title"
          description="We read the trade you ran and write back what we think: whether we would take it, how we would change it, and one or two other deals worth offering. Written by hand, delivered to your My Beacon portal."
        />

        {!product || availability.reason === "closed" ? (
          <Panel eyebrow="Trade Review" title="Reviews are not on sale right now">
            <p className="text-sm leading-relaxed text-ink-muted">Check back shortly. Signal Check stays free.</p>
          </Panel>
        ) : availability.reason === "fully_booked" ? (
          <div className="mt-6 space-y-6">
            <Panel eyebrow="Trade Review" title="Fully booked">
              <p className="text-sm leading-relaxed text-ink-muted">{offer.settings.storefront.fullyBookedMessage}</p>
            </Panel>
            <div className="max-w-md">
              <TierCardStatic product={product} />
            </div>
          </div>
        ) : !user ? (
          <div className="mt-6 space-y-6">
            <div className="max-w-md">
              <TierCardStatic product={product} highlight />
            </div>
            <Panel eyebrow="Trade Review" title="Sign in to order">
              <p className="text-sm leading-relaxed text-ink-muted">
                Your review is delivered into My Beacon, so an account is where it lives. Your trade is saved and
                waits for you here.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(here)}` as Route}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
              >
                Sign in to order
              </Link>
            </Panel>
          </div>
        ) : (
          context && (
            <Sheet labelledBy={TITLE_ID}>
              <header className="px-5 pb-6 pt-7 sm:px-8 sm:pt-8">
                <p className="flex items-center gap-2.5">
                  {/* The site's own mark, decorative: the words beside it name the author. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/ff-beacon-mark-96.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0" />
                  <span className="text-sm font-semibold text-ink">FF Beacon</span>
                  <span aria-hidden="true" className="h-3.5 w-px bg-line-accent" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Order form</span>
                </p>
                <h2 id={TITLE_ID} className="mt-5 text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
                  Order a Trade Review
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  Written by hand, about the exact trade below. Signal Check stays free; the review is a person&apos;s
                  read on top of it.
                </p>
              </header>
              <TradeReviewCheckoutForm
                shareId={shareId}
                product={product}
                trade={context.trade}
                shareHref={context.links.share}
                methods={availability.methods}
                couponsEnabled={offer.settings.coupons.enabled}
              />
            </Sheet>
          )
        )}
      </PageBody>
    </main>
  );
}
