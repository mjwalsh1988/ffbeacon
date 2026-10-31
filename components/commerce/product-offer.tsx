/**
 * The offer in a placement: the tier cards as links, or the sentence that says why
 * there are none. Which products appear is `products.placements`, so offering one
 * somewhere new is a data change plus one more of these.
 */

import { withUsername } from "@/components/league-schedule/format";
import type { OfferAvailability } from "@/lib/commerce/availability";
import { tierOf } from "@/lib/commerce/offer";
import type { CommerceSettings } from "@/lib/commerce/settings";
import type { Product, ProductPlacement } from "@/lib/commerce/types";
import { OfferView } from "./offer-view";
import { TierOfferCard } from "./tier-card";

/** The checkout link for one tier. */
export function reviewHref(args: {
  sleeperLeagueId: string;
  rosterId: number | null;
  tier: string;
  linkUsername: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.rosterId != null) params.set("roster", String(args.rosterId));
  params.set("tier", args.tier);
  return withUsername(`/leagues/${args.sleeperLeagueId}/review?${params.toString()}`, args.linkUsername);
}

export function ProductOffer({
  family,
  placement,
  sleeperLeagueId,
  rosterId,
  linkUsername,
  products,
  availability,
  settings,
}: {
  family: string;
  placement: ProductPlacement;
  sleeperLeagueId: string;
  rosterId: number | null;
  linkUsername: string | null;
  products: Product[];
  availability: OfferAvailability;
  settings: CommerceSettings;
}) {
  const offered = products.filter((p) => p.family === family && p.placements.includes(placement));
  if (offered.length === 0 || availability.reason === "closed") return null;

  if (availability.reason === "fully_booked") {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">{settings.storefront.fullyBookedMessage}</p>
    );
  }
  if (rosterId == null) {
    return <p className="text-sm leading-relaxed text-ink-muted">Pick a team above to order a review of it.</p>;
  }

  return (
    <>
      <OfferView placement={placement} />
      <div className="grid gap-4 sm:grid-cols-2">
        {offered.map((product) => (
          <TierOfferCard
            key={product.slug}
            product={product}
            href={reviewHref({
              sleeperLeagueId,
              rosterId,
              tier: tierOf(product),
              linkUsername,
            })}
          />
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-muted">
        Written by Michael, by hand, against this team&apos;s Blueprint and your league&apos;s own numbers. The Blueprint stays free.
      </p>
    </>
  );
}
