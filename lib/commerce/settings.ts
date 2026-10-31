/**
 * Load, validate, and persist the Beacon Store settings.
 *
 * One jsonb row (id = 'global') in commerce_settings, service-role only, read and
 * written with the admin client. Same shape as lib/league-blueprint/settings.ts.
 *
 * Every field carries a default, so a row written before a field existed is
 * filled in rather than rejected; a wrong TYPE still fails. The storefront reads
 * this through the memo on every render, so a save lands within a minute on every
 * instance.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import { DEFAULT_COMMERCE_SETTINGS, type CommerceSettings } from "./default-settings";

type Client = SupabaseClient<Database>;

export const COMMERCE_SETTINGS_ID = "global";
export const COMMERCE_SETTINGS_MEMO_KEY = "settings:commerce";

const d = DEFAULT_COMMERCE_SETTINGS;

const perMinute = z.number().int().min(1).max(120);

export const commerceSettingsSchema = z.object({
  version: z.number().int().min(1).max(100_000).default(d.version),
  storefront: z
    .object({
      enabled: z.boolean().default(d.storefront.enabled),
      fullyBooked: z.boolean().default(d.storefront.fullyBooked),
      maxOpenOrders: z.number().int().min(1).max(500).default(d.storefront.maxOpenOrders),
      countPendingPayment: z.boolean().default(d.storefront.countPendingPayment),
      fullyBookedMessage: z.string().min(1).max(200).default(d.storefront.fullyBookedMessage),
    })
    .default(d.storefront),
  payments: z
    .object({
      stripe: z.boolean().default(d.payments.stripe),
      paypal: z.boolean().default(d.payments.paypal),
      venmo: z.boolean().default(d.payments.venmo),
      manualExpiryDays: z.number().int().min(1).max(30).default(d.payments.manualExpiryDays),
      manualReminderDay: z.number().int().min(1).max(29).default(d.payments.manualReminderDay),
      // Stripe's own limits on a session's life.
      stripeSessionMinutes: z
        .number()
        .int()
        .min(30)
        .max(1440)
        .default(d.payments.stripeSessionMinutes),
      stripeUnpaidExpiryHours: z
        .number()
        .int()
        .min(1)
        .max(72)
        .default(d.payments.stripeUnpaidExpiryHours),
    })
    .default(d.payments),
  coupons: z.object({ enabled: z.boolean().default(d.coupons.enabled) }).default(d.coupons),
  notifications: z
    .object({
      adminEmail: z.string().email().max(254).default(d.notifications.adminEmail),
      notifyOnNew: z.boolean().default(d.notifications.notifyOnNew),
      notifyOnPaid: z.boolean().default(d.notifications.notifyOnPaid),
      notifyOnReported: z.boolean().default(d.notifications.notifyOnReported),
    })
    .default(d.notifications),
  emails: z
    .object({
      receiptRetryMax: z.number().int().min(0).max(10).default(d.emails.receiptRetryMax),
      receiptRetryAfterMinutes: z
        .number()
        .int()
        .min(1)
        .max(1440)
        .default(d.emails.receiptRetryAfterMinutes),
    })
    .default(d.emails),
  rateLimits: z
    .object({
      checkoutPerMinute: perMinute.default(d.rateLimits.checkoutPerMinute),
      reconcilePerMinute: perMinute.default(d.rateLimits.reconcilePerMinute),
      reportPaymentPerMinute: perMinute.default(d.rateLimits.reportPaymentPerMinute),
      couponPreviewPerMinute: perMinute.default(d.rateLimits.couponPreviewPerMinute),
    })
    .default(d.rateLimits),
  placements: z
    .object({
      blueprintSection: z.boolean().default(d.placements.blueprintSection),
      overviewStrip: z.boolean().default(d.placements.overviewStrip),
      myBeaconTile: z.boolean().default(d.placements.myBeaconTile),
    })
    .default(d.placements),
});

export type ValidateResult =
  | { ok: true; settings: CommerceSettings }
  | { ok: false; error: string };

/** Validate an untrusted settings object. The admin save path's only gate. */
export function validateCommerceSettings(raw: unknown): ValidateResult {
  const parsed = commerceSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const settings = parsed.data as CommerceSettings;
  if (settings.payments.manualReminderDay >= settings.payments.manualExpiryDays) {
    return { ok: false, error: "payments.manualReminderDay: must be before manualExpiryDays." };
  }
  return { ok: true, settings };
}

/**
 * Fill a partial or older stored document out to a complete one. Falls back to
 * the code defaults when the row cannot be parsed, so the store keeps running on
 * a corrupt row rather than failing on it.
 */
export function mergeCommerceSettings(raw: unknown): CommerceSettings {
  const result = validateCommerceSettings(raw);
  return result.ok ? result.settings : DEFAULT_COMMERCE_SETTINGS;
}

/** One admin-edited row for every caller: memoized for a minute. */
export async function loadCommerceSettings(supabase: Client): Promise<CommerceSettings> {
  return memoTtl(COMMERCE_SETTINGS_MEMO_KEY, 60_000, async () => {
    try {
      const { data, error } = await supabase
        .from("commerce_settings")
        .select("settings")
        .eq("id", COMMERCE_SETTINGS_ID)
        .maybeSingle();
      if (error || !data?.settings) return DEFAULT_COMMERCE_SETTINGS;
      return mergeCommerceSettings(data.settings);
    } catch {
      return DEFAULT_COMMERCE_SETTINGS;
    }
  });
}

/** Persist a full settings document. Admin server actions only. */
export async function saveCommerceSettings(
  supabase: Client,
  settings: CommerceSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("commerce_settings").upsert(
    {
      id: COMMERCE_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_COMMERCE_SETTINGS };
export type { CommerceSettings };
