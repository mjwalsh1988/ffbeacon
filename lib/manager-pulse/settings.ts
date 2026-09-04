/**
 * Load and save the Manager Pulse model config.
 *
 * Reads the single pinned row from manager_pulse_settings and merges it over
 * the code defaults. The table is service-role only, matching
 * league_power_pulse_settings and on_the_clock_settings, so this runs
 * server-side with the admin (service-role) Supabase client, never from the
 * browser.
 *
 * A missing row, an unreadable row, or a query error all degrade to the code
 * defaults rather than failing. The model is tuning, not correctness: a
 * lookup must never break because an admin has not saved settings yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  DEFAULT_MANAGER_PULSE_SETTINGS,
  mergeManagerPulseSettings,
  type ManagerPulseSettings,
} from "./default-settings";

export const MANAGER_PULSE_SETTINGS_ID = "global";

/** Requires the service-role (admin) client. manager_pulse_settings has no anon or authenticated policy. */
export async function loadManagerPulseSettings(
  admin: SupabaseClient<Database>,
): Promise<ManagerPulseSettings> {
  try {
    const { data, error } = await admin
      .from("manager_pulse_settings")
      .select("settings")
      .eq("id", MANAGER_PULSE_SETTINGS_ID)
      .maybeSingle();
    if (error || !data?.settings) return DEFAULT_MANAGER_PULSE_SETTINGS;
    return mergeManagerPulseSettings(data.settings);
  } catch {
    return DEFAULT_MANAGER_PULSE_SETTINGS;
  }
}

/** Persist a full settings document. Admin server actions only, and requires the service-role client. */
export async function saveManagerPulseSettings(
  admin: SupabaseClient<Database>,
  settings: ManagerPulseSettings,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from("manager_pulse_settings").upsert(
    {
      id: MANAGER_PULSE_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_MANAGER_PULSE_SETTINGS, mergeManagerPulseSettings };
export type { ManagerPulseSettings };
