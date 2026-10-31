import { describe, expect, it } from "vitest";
import {
  featuresFromLines,
  linesFromFeatures,
  priceCentsFromText,
  productInputSchema,
  snapshotProduct,
} from "./products";
import type { Product } from "./types";

const VALID = {
  slug: "team-review-basic",
  family: "team-review",
  tierRank: 1,
  name: "Basic Review",
  tagline: "",
  description: "",
  badge: "",
  features: ["One"],
  priceCents: 995,
  turnaroundDays: 3,
  placements: ["blueprint"],
  isActive: true,
  displayOrder: 10,
};

describe("productInputSchema", () => {
  it("accepts a valid product", () => {
    expect(productInputSchema.safeParse(VALID).success).toBe(true);
  });

  it("refuses a slug outside the pattern", () => {
    for (const slug of ["Team", "team_review", "-team", "team-", "te am"]) {
      expect(productInputSchema.safeParse({ ...VALID, slug }).success, slug).toBe(false);
    }
  });

  it("holds the price bounds", () => {
    expect(productInputSchema.safeParse({ ...VALID, priceCents: 99 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...VALID, priceCents: 100_001 }).success).toBe(false);
  });

  it("caps the feature list and each line", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `Line ${i}`);
    expect(productInputSchema.safeParse({ ...VALID, features: thirteen }).success).toBe(false);
    expect(
      productInputSchema.safeParse({ ...VALID, features: ["x".repeat(121)] }).success,
    ).toBe(false);
  });

  it("refuses a placement the column would refuse", () => {
    expect(
      productInputSchema.safeParse({ ...VALID, placements: ["homepage"] }).success,
    ).toBe(false);
  });
});

describe("features", () => {
  it("trims lines and drops blanks", () => {
    expect(featuresFromLines("  one \n\n two\n  \n")).toEqual(["one", "two"]);
  });

  it("round trips", () => {
    expect(featuresFromLines(linesFromFeatures(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("priceCentsFromText", () => {
  it("reads dollars into cents exactly", () => {
    expect(priceCentsFromText("9.95")).toEqual({ ok: true, cents: 995 });
    expect(priceCentsFromText("$19.95")).toEqual({ ok: true, cents: 1995 });
  });

  it("refuses what it cannot read, and past the ceiling", () => {
    expect(priceCentsFromText("12,50").ok).toBe(false);
    expect(priceCentsFromText("free").ok).toBe(false);
    expect(priceCentsFromText("1000.01").ok).toBe(false);
  });
});

describe("snapshotProduct", () => {
  it("freezes exactly the fields an order keeps", () => {
    const product = {
      id: "x",
      slug: "team-review-premium",
      family: "team-review",
      tier_rank: 2,
      name: "Premium Review",
      tagline: "All of it.",
      description: "long",
      features: ["One"],
      badge: "Most popular",
      price_cents: 1995,
      currency: "usd",
      turnaround_days: 5,
      intake_form: "team-review",
      requires_league_context: true,
      placements: ["blueprint"],
      is_active: true,
      display_order: 20,
      created_at: "",
      updated_at: "",
    } satisfies Product;
    expect(snapshotProduct(product)).toEqual({
      slug: "team-review-premium",
      family: "team-review",
      tier_rank: 2,
      name: "Premium Review",
      tagline: "All of it.",
      features: ["One"],
      price_cents: 1995,
      turnaround_days: 5,
      intake_form: "team-review",
    });
  });
});
