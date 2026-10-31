/**
 * Products: what the store sells.
 *
 * Reads take the client they are given: the customer surfaces pass a session or
 * anonymous client (RLS shows active rows only), the admin pages pass the service
 * role client and see every row. `products.features` is jsonb the column does not
 * validate, so the shape is held here.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { parseDonationAmount } from "@/lib/donate/amounts";
import type { Product, ProductPlacement, ProductSnapshot } from "./types";

type Client = SupabaseClient<Database>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export { featuresFromLines, linesFromFeatures, PRODUCT_PLACEMENTS } from "./product-fields";

const COLUMNS =
  "id, slug, family, tier_rank, name, tagline, description, features, badge, price_cents, currency, turnaround_days, intake_form, requires_league_context, placements, is_active, display_order, created_at, updated_at";

function toProduct(row: Database["public"]["Tables"]["products"]["Row"]): Product {
  return {
    ...row,
    features: Array.isArray(row.features)
      ? row.features.filter((f): f is string => typeof f === "string")
      : [],
    placements: row.placements as ProductPlacement[],
  };
}

/** The active rows, cheapest tier first. Family narrows it to one line of products. */
export async function loadActiveProducts(client: Client, family?: string): Promise<Product[]> {
  let query = client.from("products").select(COLUMNS).eq("is_active", true);
  if (family) query = query.eq("family", family);
  const { data, error } = await query.order("tier_rank").order("display_order");
  if (error) {
    console.error("[orders] product read failed", error.message);
    return [];
  }
  return (data ?? []).map(toProduct);
}

/** Every row, active or not. Admin pages only. */
export async function loadAllProducts(admin: Client): Promise<Product[]> {
  const { data, error } = await admin
    .from("products")
    .select(COLUMNS)
    .order("display_order")
    .order("slug");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toProduct);
}

export const productInputSchema = z.object({
  slug: z.string().regex(SLUG, "Use lower case letters, digits and hyphens.").max(60),
  family: z.string().regex(SLUG, "Use lower case letters, digits and hyphens.").max(60),
  tierRank: z.number().int().min(1).max(9),
  name: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(140),
  description: z.string().trim().max(2000),
  badge: z.string().trim().max(24),
  features: z.array(z.string().min(1).max(120)).max(12),
  priceCents: z.number().int().min(100).max(100_000),
  turnaroundDays: z.number().int().min(1).max(30),
  placements: z.array(z.enum(["blueprint", "league-overview", "my-beacon"])),
  isActive: z.boolean(),
  displayOrder: z.number().int().min(0).max(10_000),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * The admin's price box. Same strictness as the donation parser (it refuses
 * "12,50" rather than guessing), with this form's own ceiling.
 */
export function priceCentsFromText(
  text: string,
): { ok: true; cents: number } | { ok: false; error: string } {
  const parsed = parseDonationAmount(text);
  if (!parsed.ok) return { ok: false, error: "Enter a price in dollars, like 9.95." };
  if (parsed.cents > 100_000) return { ok: false, error: "The most a product can cost is $1,000." };
  return { ok: true, cents: parsed.cents };
}

/** Create or update one row, keyed on the slug, which never changes after creation. */
export async function saveProduct(
  admin: Client,
  input: ProductInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from("products").upsert(
    {
      slug: input.slug,
      family: input.family,
      tier_rank: input.tierRank,
      name: input.name,
      tagline: input.tagline || null,
      description: input.description || null,
      badge: input.badge || null,
      features: input.features as unknown as Json,
      price_cents: input.priceCents,
      turnaround_days: input.turnaroundDays,
      placements: input.placements,
      is_active: input.isActive,
      display_order: input.displayOrder,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "slug" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** What the order freezes, so a later price or copy change never rewrites a receipt. */
export function snapshotProduct(product: Product): ProductSnapshot {
  return {
    slug: product.slug,
    family: product.family,
    tier_rank: product.tier_rank,
    name: product.name,
    tagline: product.tagline,
    features: product.features,
    price_cents: product.price_cents,
    turnaround_days: product.turnaround_days,
    intake_form: product.intake_form,
  };
}
