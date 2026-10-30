/**
 * Load, validate, and persist Market Signals settings.
 *
 * One jsonb row (id = 'global') in market_signal_settings, service-role only.
 * Same shape as lib/league-blueprint/settings.ts. Bounds are plan section
 * 13.2: window 10 to 90, k 1 to 3, watch 0 to 0.2, hold back 0 to 0.3, min
 * points 5 to the window, stale 1 to 7, lookback at least the window, floor 0
 * to 0.2.
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import {
  DEFAULT_MARKET_SIGNAL_SETTINGS,
  type MarketSignalSettings,
} from "./default-settings";

type Client = SupabaseClient<Database>;

export const MARKET_SIGNAL_SETTINGS_ID = "global";
export const MARKET_SIGNAL_SETTINGS_MEMO_KEY = "settings:market_signals";

const d = DEFAULT_MARKET_SIGNAL_SETTINGS;

export const marketSignalSettingsSchema = z.object({
  windowDays: z.number().int().min(10).max(90).default(d.windowDays),
  k: z.number().min(1).max(3).default(d.k),
  watchPct: z.number().min(0).max(0.2).default(d.watchPct),
  holdBackPct: z.number().min(0).max(0.3).default(d.holdBackPct),
  minPoints: z.number().int().min(5).max(90).default(d.minPoints),
  staleDays: z.number().int().min(1).max(7).default(d.staleDays),
  lookbackDays: z.number().int().min(10).max(180).default(d.lookbackDays),
  floorPct: z.number().min(0).max(0.2).default(d.floorPct),
  enabled: z.boolean().default(d.enabled),
  modelVersion: z.number().int().min(1).max(100_000).default(d.modelVersion),
});

export type ValidateResult =
  | { ok: true; settings: MarketSignalSettings }
  | { ok: false; error: string };

export function validateMarketSignalSettings(raw: unknown): ValidateResult {
  const parsed = marketSignalSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "settings";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid"}` };
  }
  const s = parsed.data as MarketSignalSettings;
  if (s.minPoints > s.windowDays) {
    return { ok: false, error: "minPoints: cannot exceed windowDays." };
  }
  if (s.lookbackDays < s.windowDays) {
    return { ok: false, error: "lookbackDays: must be at least windowDays." };
  }
  return { ok: true, settings: s };
}

/** A corrupt or cross-field-invalid row falls back to the code defaults. */
export function mergeMarketSignalSettings(raw: unknown): MarketSignalSettings {
  const result = validateMarketSignalSettings(raw);
  return result.ok ? result.settings : DEFAULT_MARKET_SIGNAL_SETTINGS;
}

export async function loadMarketSignalSettings(supabase: Client): Promise<MarketSignalSettings> {
  return memoTtl(MARKET_SIGNAL_SETTINGS_MEMO_KEY, 60_000, async () => {
    try {
      const { data, error } = await supabase
        .from("market_signal_settings")
        .select("settings")
        .eq("id", MARKET_SIGNAL_SETTINGS_ID)
        .maybeSingle();
      if (error || !data?.settings) return DEFAULT_MARKET_SIGNAL_SETTINGS;
      return mergeMarketSignalSettings(data.settings);
    } catch {
      return DEFAULT_MARKET_SIGNAL_SETTINGS;
    }
  });
}

/** Persist a full settings document. Admin server actions only. */
export async function saveMarketSignalSettings(
  supabase: Client,
  settings: MarketSignalSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("market_signal_settings").upsert(
    {
      id: MARKET_SIGNAL_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_MARKET_SIGNAL_SETTINGS };
export type { MarketSignalSettings };
