import "server-only";

/**
 * What every offer needs, memoized for a minute: the active products, the settings
 * and whether the door is open.
 *
 * An offer sits on pages a lot of people read and most will not order from, so this
 * is one in-process read rather than three queries on every render. Nothing here is
 * per reader. The capacity it shows can lag by a minute; `createOrderAction` counts
 * again at the moment it matters.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import { stripeConfigured } from "@/lib/stripe/client";
import { offerAvailability, type OfferAvailability } from "./availability";
import { countOpenOrders } from "./orders";
import { loadActiveProducts } from "./products";
import { loadCommerceSettings, type CommerceSettings } from "./settings";
import type { Product } from "./types";

type Client = SupabaseClient<Database>;

export const OFFER_MEMO_KEY = "commerce:offer";

export type OfferState = {
  products: Product[];
  settings: CommerceSettings;
  availability: OfferAvailability;
};

export async function loadOfferState(admin: Client): Promise<OfferState> {
  return memoTtl(OFFER_MEMO_KEY, 60_000, async () => {
    const [products, settings] = await Promise.all([
      loadActiveProducts(admin),
      loadCommerceSettings(admin),
    ]);
    // The offer sits on the league overview and the Blueprint. A failed count must
    // not take a whole league page down with it: the door reads closed for a minute
    // and the strip renders nothing.
    let open: number;
    try {
      open = await countOpenOrders(admin, settings);
    } catch (err) {
      console.error("[orders] open count failed", err instanceof Error ? err.message : String(err));
      return {
        products,
        settings,
        availability: { open: false, reason: "closed", methods: [] },
      };
    }
    return { products, settings, availability: offerAvailability(settings, open, stripeConfigured()) };
  });
}

/** The tier word in a checkout link: `team-review-premium` is `premium`. */
export function tierOf(product: Pick<Product, "slug" | "family">): string {
  return product.slug.startsWith(`${product.family}-`)
    ? product.slug.slice(product.family.length + 1)
    : product.slug;
}
