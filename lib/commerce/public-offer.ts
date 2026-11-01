/**
 * The offer as a client component may hold it: the products for one placement,
 * whether the door is open, and the fully booked sentence. Nothing per reader and
 * no settings beyond the one sentence, so it is safe to hand to a client
 * component (the draft room and the trade calculator both render their offer on
 * the client, after the server has decided what is for sale). Pure.
 */

import type { OfferAvailability } from "./availability";
import type { CommerceSettings } from "./default-settings";
import type { Product, ProductPlacement } from "./types";

export type OfferProduct = Pick<
  Product,
  "slug" | "family" | "name" | "tagline" | "features" | "badge" | "price_cents" | "turnaround_days" | "placements"
>;

export type PublicOffer = {
  placement: ProductPlacement;
  products: OfferProduct[];
  availability: OfferAvailability;
  fullyBookedMessage: string;
};

/** Which admin switch governs each placement. */
const PLACEMENT_SWITCH: Record<ProductPlacement, keyof CommerceSettings["placements"]> = {
  blueprint: "blueprintSection",
  "league-overview": "overviewStrip",
  "my-beacon": "myBeaconTile",
  "on-the-clock": "onTheClock",
  "trade-calculator": "tradeCalculator",
};

/** The tier word in a checkout link: `team-review-premium` is `premium`. */
export function tierOf(product: Pick<Product, "slug" | "family">): string {
  return product.slug.startsWith(`${product.family}-`)
    ? product.slug.slice(product.family.length + 1)
    : product.slug;
}

/**
 * Null when the placement is switched off, the store is closed, or nothing is
 * offered there; a fully booked store still returns, so the surface can say so.
 */
export function publicOffer(
  state: { products: Product[]; settings: CommerceSettings; availability: OfferAvailability },
  placement: ProductPlacement,
): PublicOffer | null {
  if (!state.settings.placements[PLACEMENT_SWITCH[placement]]) return null;
  if (state.availability.reason === "closed") return null;
  const products = state.products
    .filter((p) => p.placements.includes(placement))
    .map((p) => ({
      slug: p.slug,
      family: p.family,
      name: p.name,
      tagline: p.tagline,
      features: p.features,
      badge: p.badge,
      price_cents: p.price_cents,
      turnaround_days: p.turnaround_days,
      placements: p.placements,
    }));
  if (products.length === 0) return null;
  return {
    placement,
    products,
    availability: state.availability,
    fullyBookedMessage: state.settings.storefront.fullyBookedMessage,
  };
}
