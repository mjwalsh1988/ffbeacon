/**
 * Load the Power Pulse model config.
 *
 * Reads the single pinned row from league_power_pulse_settings and merges it
 * over the code defaults. The table is service-role only, matching
 * on_the_clock_settings and beacon_settings, so this runs server-side.
 *
 * A missing row, an unreadable row, or a query error all degrade to the code
 * defaults rather than failing. The model is tuning, not correctness: a league
 * page must never break because an admin has not saved settings yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  mergePowerPulseSettings,
  type PowerPulseSettings,
} from "./default-settings";

export const POWER_PULSE_SETTINGS_ID = "global";

export async function loadPowerPulseSettings(
  supabase: SupabaseClient<Database>,
): Promise<PowerPulseSettings> {
  try {
    const { data, error } = await supabase
      .from("league_power_pulse_settings")
      .select("settings")
      .eq("id", POWER_PULSE_SETTINGS_ID)
      .maybeSingle();
    if (error || !data?.settings) return DEFAULT_POWER_PULSE_SETTINGS;
    return mergePowerPulseSettings(data.settings);
  } catch {
    return DEFAULT_POWER_PULSE_SETTINGS;
  }
}

/** Persist a full settings document. Admin server actions only. */
export async function savePowerPulseSettings(
  supabase: SupabaseClient<Database>,
  settings: PowerPulseSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("league_power_pulse_settings").upsert(
    {
      id: POWER_PULSE_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_POWER_PULSE_SETTINGS, mergePowerPulseSettings };
export type { PowerPulseSettings };
