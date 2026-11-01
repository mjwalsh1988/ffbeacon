import { describe, expect, it } from "vitest";
import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";
import { publicOffer, tierOf } from "./public-offer";
import type { Product } from "./types";

function product(slug: string, family: string, placements: Product["placements"]): Product {
  return {
    id: slug,
    slug,
    family,
    tier_rank: 1,
    name: slug,
    tagline: null,
    description: "a secret the client must not see",
    features: [],
    badge: null,
    price_cents: 395,
    currency: "usd",
    turnaround_days: 2,
    intake_form: family,
    requires_league_context: family === "team-review",
    placements,
    is_active: true,
    display_order: 1,
    created_at: "",
    updated_at: "",
  };
}

const PRODUCTS = [
  product("team-review-basic", "team-review", ["blueprint", "on-the-clock"]),
  product("trade-review", "trade-review", ["trade-calculator"]),
];

const OPEN = { open: true, reason: null, methods: ["stripe" as const] };

describe("publicOffer", () => {
  it("narrows to the placement and strips what the client does not need", () => {
    const offer = publicOffer(
      { products: PRODUCTS, settings: DEFAULT_COMMERCE_SETTINGS, availability: OPEN },
      "trade-calculator",
    );
    expect(offer?.products.map((p) => p.slug)).toEqual(["trade-review"]);
    expect(offer?.placement).toBe("trade-calculator");
    expect(JSON.stringify(offer)).not.toContain("secret");
    expect(JSON.stringify(offer)).not.toContain("adminEmail");
  });

  it("is null when the placement is switched off, the store is closed, or nothing is offered there", () => {
    const off = {
      ...DEFAULT_COMMERCE_SETTINGS,
      placements: { ...DEFAULT_COMMERCE_SETTINGS.placements, onTheClock: false },
    };
    expect(publicOffer({ products: PRODUCTS, settings: off, availability: OPEN }, "on-the-clock")).toBeNull();
    expect(
      publicOffer(
        {
          products: PRODUCTS,
          settings: DEFAULT_COMMERCE_SETTINGS,
          availability: { open: false, reason: "closed", methods: [] },
        },
        "on-the-clock",
      ),
    ).toBeNull();
    expect(
      publicOffer({ products: PRODUCTS, settings: DEFAULT_COMMERCE_SETTINGS, availability: OPEN }, "my-beacon"),
    ).toBeNull();
  });

  it("still returns when fully booked, so the surface can say so", () => {
    const offer = publicOffer(
      {
        products: PRODUCTS,
        settings: DEFAULT_COMMERCE_SETTINGS,
        availability: { open: false, reason: "fully_booked", methods: ["stripe"] },
      },
      "on-the-clock",
    );
    expect(offer?.availability.reason).toBe("fully_booked");
    expect(offer?.fullyBookedMessage).toBe(DEFAULT_COMMERCE_SETTINGS.storefront.fullyBookedMessage);
  });
});

describe("tierOf", () => {
  it("drops the family prefix, and keeps a slug that is its own family", () => {
    expect(tierOf({ slug: "team-review-premium", family: "team-review" })).toBe("premium");
    expect(tierOf({ slug: "trade-review", family: "trade-review" })).toBe("trade-review");
  });
});
