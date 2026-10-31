import { describe, expect, it } from "vitest";
import { couponInputSchema, discountFor, evaluateCoupon, normalizeCode } from "./coupons";
import type { Coupon } from "./types";

const NOW = new Date("2026-11-01T12:00:00Z");
const PRODUCT = { id: "p1", family: "team-review", price_cents: 1995 };
const NONE = { total: 0, byUser: 0 };

function coupon(patch: Partial<Coupon> = {}): Coupon {
  return {
    id: "c1",
    code: "SAVE20",
    kind: "percent",
    percent_off: 20,
    amount_off_cents: null,
    product_family: null,
    product_id: null,
    max_redemptions: null,
    max_redemptions_per_user: 1,
    starts_at: null,
    expires_at: null,
    is_active: true,
    note: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...patch,
  };
}

describe("normalizeCode", () => {
  it("accepts lower case and surrounding spaces", () => {
    expect(normalizeCode("  save20 ")).toBe("SAVE20");
  });

  it("refuses symbols and the wrong length", () => {
    expect(normalizeCode("SAVE-20")).toBeNull();
    expect(normalizeCode("ABC")).toBeNull();
    expect(normalizeCode("A".repeat(25))).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});

describe("discountFor", () => {
  it("rounds a percent to whole cents", () => {
    expect(discountFor(coupon({ percent_off: 20 }), 1995)).toBe(399);
    expect(discountFor(coupon({ percent_off: 15 }), 995)).toBe(149);
  });

  it("makes a 100% code cover the price exactly", () => {
    expect(1995 - discountFor(coupon({ percent_off: 100 }), 1995)).toBe(0);
  });

  it("caps an amount at the price", () => {
    const big = coupon({ kind: "amount", percent_off: null, amount_off_cents: 5000 });
    expect(discountFor(big, 1995)).toBe(1995);
  });
});

describe("evaluateCoupon", () => {
  const message = (c: Coupon | null, counts = NONE) => {
    const result = evaluateCoupon(c, PRODUCT, counts, NOW);
    return result.ok ? null : result.message;
  };

  it("refuses in the plan's order, one sentence for each reason", () => {
    expect(message(null)).toBe("That code is not valid.");
    expect(message(coupon({ is_active: false }))).toBe("That code is not valid.");
    expect(message(coupon({ starts_at: "2026-12-01T00:00:00Z" }))).toBe(
      "That code is not active yet.",
    );
    expect(message(coupon({ expires_at: "2026-10-01T00:00:00Z" }))).toBe(
      "That code has expired.",
    );
    expect(message(coupon({ product_id: "other" }))).toBe(
      "That code does not apply to this review.",
    );
    expect(message(coupon({ product_family: "other" }))).toBe(
      "That code does not apply to this review.",
    );
    expect(message(coupon({ max_redemptions: 5 }), { total: 5, byUser: 0 })).toBe(
      "That code has been used up.",
    );
    expect(message(coupon(), { total: 1, byUser: 1 })).toBe("You have already used that code.");
  });

  it("checks the window before the scope and the scope before the caps", () => {
    expect(
      message(coupon({ expires_at: "2026-10-01T00:00:00Z", product_id: "other" })),
    ).toBe("That code has expired.");
    expect(message(coupon({ product_id: "other", max_redemptions: 1 }), { total: 9, byUser: 9 })).toBe(
      "That code does not apply to this review.",
    );
  });

  it("allows a per-customer cap above one until it is reached", () => {
    const c = coupon({ max_redemptions_per_user: 2 });
    expect(evaluateCoupon(c, PRODUCT, { total: 1, byUser: 1 }, NOW).ok).toBe(true);
    expect(evaluateCoupon(c, PRODUCT, { total: 2, byUser: 2 }, NOW).ok).toBe(false);
  });

  it("applies by family and by product", () => {
    expect(evaluateCoupon(coupon({ product_family: "team-review" }), PRODUCT, NONE, NOW).ok).toBe(
      true,
    );
    expect(evaluateCoupon(coupon({ product_id: "p1" }), PRODUCT, NONE, NOW).ok).toBe(true);
  });

  it("yields the discount", () => {
    const result = evaluateCoupon(coupon(), PRODUCT, NONE, NOW);
    expect(result).toMatchObject({ ok: true, discountCents: 399 });
  });
});

describe("couponInputSchema", () => {
  const VALID = {
    id: null,
    code: " save20 ",
    kind: "percent",
    percentOff: 20,
    amountOffCents: null,
    productFamily: null,
    productId: null,
    maxRedemptions: null,
    maxRedemptionsPerUser: 1,
    startsAt: null,
    expiresAt: null,
    isActive: true,
    note: null,
  };

  it("upper-cases the code", () => {
    const parsed = couponInputSchema.parse(VALID);
    expect(parsed.code).toBe("SAVE20");
  });

  it("requires the number that matches the kind", () => {
    expect(couponInputSchema.safeParse({ ...VALID, percentOff: null }).success).toBe(false);
    expect(
      couponInputSchema.safeParse({ ...VALID, kind: "amount", percentOff: null }).success,
    ).toBe(false);
  });

  it("holds the bounds, the family pattern and the window order", () => {
    expect(couponInputSchema.safeParse({ ...VALID, percentOff: 101 }).success).toBe(false);
    expect(couponInputSchema.safeParse({ ...VALID, productFamily: "Bad Family" }).success).toBe(
      false,
    );
    expect(
      couponInputSchema.safeParse({
        ...VALID,
        startsAt: "2026-12-02T00:00:00Z",
        expiresAt: "2026-12-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
