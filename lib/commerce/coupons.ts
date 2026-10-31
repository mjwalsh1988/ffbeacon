/**
 * Coupons: a code a customer types at checkout.
 *
 * `evaluateCoupon` is the rule, pure over a loaded row plus two counts, and
 * `resolveCoupon` is the same rule with the reads in front of it. The server is
 * the only thing that prices an order: the preview runs this, and the create
 * action runs it again rather than trusting what the preview said.
 *
 * A wrong code and a missing code get the same sentence, and the preview is
 * metered, so the table cannot be enumerated quickly. Redemptions are counted from
 * orders, so an abandoned order frees its slot when the cron expires it.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Coupon, Product } from "./types";

type Client = SupabaseClient<Database>;

const CODE = /^[A-Z0-9]{4,24}$/;
const FAMILY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The statuses that hold a redemption slot (migration 0350). */
export const REDEEMING_STATUSES = ["unpaid", "awaiting_confirmation", "paid", "refunded"] as const;

export const COUPON_NOT_VALID = "That code is not valid.";

/** Trim and upper-case, or null when the result is not a code at all. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

/** What a coupon takes off a list price, never more than the price. */
export function discountFor(
  coupon: Pick<Coupon, "kind" | "percent_off" | "amount_off_cents">,
  listCents: number,
): number {
  if (coupon.kind === "percent") {
    return Math.min(listCents, Math.round((listCents * (coupon.percent_off ?? 0)) / 100));
  }
  return Math.min(coupon.amount_off_cents ?? 0, listCents);
}

export type CouponResult =
  | { ok: true; coupon: Coupon; discountCents: number }
  | { ok: false; message: string };

/** The rule, in the plan's order. Pure. */
export function evaluateCoupon(
  coupon: Coupon | null,
  product: Pick<Product, "id" | "family" | "price_cents">,
  counts: { total: number; byUser: number },
  now: Date,
): CouponResult {
  if (!coupon || !coupon.is_active) return { ok: false, message: COUPON_NOT_VALID };
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { ok: false, message: "That code is not active yet." };
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { ok: false, message: "That code has expired." };
  }
  if (
    (coupon.product_id && coupon.product_id !== product.id) ||
    (coupon.product_family && coupon.product_family !== product.family)
  ) {
    return { ok: false, message: "That code does not apply to this review." };
  }
  if (coupon.max_redemptions != null && counts.total >= coupon.max_redemptions) {
    return { ok: false, message: "That code has been used up." };
  }
  if (counts.byUser >= coupon.max_redemptions_per_user) {
    return { ok: false, message: "You have already used that code." };
  }
  return { ok: true, coupon, discountCents: discountFor(coupon, product.price_cents) };
}

/** One exact count of the orders holding a slot on this coupon. */
export async function countCouponRedemptions(
  admin: Client,
  couponId: string,
  userId?: string,
): Promise<number> {
  let query = admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId)
    .in("payment_status", [...REDEEMING_STATUSES]);
  if (userId) query = query.eq("user_id", userId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Load the row and both counts, then apply the rule. */
export async function resolveCoupon(
  admin: Client,
  rawCode: string,
  product: Pick<Product, "id" | "family" | "price_cents">,
  userId: string,
  now: Date = new Date(),
): Promise<CouponResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, message: COUPON_NOT_VALID };

  const { data, error } = await admin
    .from("coupons")
    .select("*")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[orders] coupon read failed", error.message);
    return { ok: false, message: COUPON_NOT_VALID };
  }
  if (!data) return { ok: false, message: COUPON_NOT_VALID };

  const coupon = data as Coupon;
  const [total, byUser] = await Promise.all([
    countCouponRedemptions(admin, coupon.id),
    countCouponRedemptions(admin, coupon.id, userId),
  ]);
  return evaluateCoupon(coupon, product, { total, byUser }, now);
}

export const couponInputSchema = z
  .object({
    id: z.string().uuid().nullable(),
    code: z
      .string()
      .transform((v) => v.trim().toUpperCase())
      .pipe(z.string().regex(CODE, "A code is 4 to 24 letters and digits.")),
    kind: z.enum(["percent", "amount"]),
    percentOff: z.number().int().min(1).max(100).nullable(),
    amountOffCents: z.number().int().min(1).max(100_000).nullable(),
    productFamily: z
      .string()
      .trim()
      .regex(FAMILY, "A family uses lower case letters, digits and hyphens.")
      .nullable(),
    productId: z.string().uuid().nullable(),
    maxRedemptions: z.number().int().min(1).nullable(),
    maxRedemptionsPerUser: z.number().int().min(1).max(100),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    isActive: z.boolean(),
    note: z.string().trim().max(500).nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && v.percentOff == null) {
      ctx.addIssue({ code: "custom", path: ["percentOff"], message: "Enter a percent off." });
    }
    if (v.kind === "amount" && v.amountOffCents == null) {
      ctx.addIssue({ code: "custom", path: ["amountOffCents"], message: "Enter an amount off." });
    }
    if (v.startsAt && v.expiresAt && new Date(v.expiresAt) <= new Date(v.startsAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "The end must come after the start.",
      });
    }
  });

export type CouponInput = z.infer<typeof couponInputSchema>;

/** Insert a new code, or update one row. A code never changes after creation. */
export async function saveCoupon(
  admin: Client,
  input: CouponInput,
  createdBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fields = {
    kind: input.kind,
    percent_off: input.kind === "percent" ? input.percentOff : null,
    amount_off_cents: input.kind === "amount" ? input.amountOffCents : null,
    product_family: input.productFamily,
    product_id: input.productId,
    max_redemptions: input.maxRedemptions,
    max_redemptions_per_user: input.maxRedemptionsPerUser,
    starts_at: input.startsAt,
    expires_at: input.expiresAt,
    is_active: input.isActive,
    note: input.note,
  };
  const { error } = input.id
    ? await admin.from("coupons").update(fields).eq("id", input.id)
    : await admin
        .from("coupons")
        .insert({ ...fields, code: input.code, created_by: createdBy });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That code already exists." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type CouponListRow = Coupon & { redemptions: number };

/**
 * Every coupon with its redemption count. The count is one query over the
 * redeeming orders grouped here, not one query per coupon.
 */
export async function loadAllCoupons(admin: Client): Promise<CouponListRow[]> {
  const { data, error } = await admin
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const coupons = (data ?? []) as Coupon[];
  if (coupons.length === 0) return [];

  const counts = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error: readError } = await admin
      .from("orders")
      .select("id, coupon_id")
      .not("coupon_id", "is", null)
      .in("payment_status", [...REDEEMING_STATUSES])
      .order("id")
      .range(from, from + PAGE - 1);
    if (readError) throw new Error(readError.message);
    for (const row of rows ?? []) {
      if (row.coupon_id) counts.set(row.coupon_id, (counts.get(row.coupon_id) ?? 0) + 1);
    }
    if ((rows ?? []).length < PAGE) break;
  }
  return coupons.map((c) => ({ ...c, redemptions: counts.get(c.id) ?? 0 }));
}
