/**
 * Load and save the Beacon Steals model config.
 *
 * Reads the single pinned row from draft_value_settings and merges it over the
 * code defaults. The table is service-role only, matching
 * league_power_pulse_settings and on_the_clock_settings, so this runs
 * server-side.
 *
 * A missing row, an unreadable row, or a query error all degrade to the code
 * defaults rather than failing. The model is tuning, not correctness: the board
 * must build on a fresh database with nothing saved.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  DEFAULT_DRAFT_VALUE_SETTINGS,
  mergeDraftValueSettings,
  type DraftValueSettings,
} from "./default-settings";

export const DRAFT_VALUE_SETTINGS_ID = "global";

export async function loadDraftValueSettings(
  supabase: SupabaseClient<Database>,
): Promise<DraftValueSettings> {
  try {
    const { data, error } = await supabase
      .from("draft_value_settings")
      .select("settings")
      .eq("id", DRAFT_VALUE_SETTINGS_ID)
      .maybeSingle();
    if (error || !data?.settings) return DEFAULT_DRAFT_VALUE_SETTINGS;
    return mergeDraftValueSettings(data.settings);
  } catch {
    return DEFAULT_DRAFT_VALUE_SETTINGS;
  }
}

/** Persist a full settings document. Admin server actions only. */
export async function saveDraftValueSettings(
  supabase: SupabaseClient<Database>,
  settings: DraftValueSettings,
  updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("draft_value_settings").upsert(
    {
      id: DRAFT_VALUE_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export { DEFAULT_DRAFT_VALUE_SETTINGS, mergeDraftValueSettings };
export type { DraftValueSettings };
