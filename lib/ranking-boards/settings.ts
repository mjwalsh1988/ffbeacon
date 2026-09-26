import "server-only";

/**
 * Load and save the Beacon Ranker settings (migration 0306).
 *
 * The table is service-role only, so this runs server-side with the admin
 * client. A missing row, an unreadable row, or a query error all degrade to the
 * code defaults: a reader must never be unable to rank players because an admin
 * has not saved settings yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { memoTtl } from "@/lib/memo-ttl";
import {
  DEFAULT_RANKING_BUILDER_SETTINGS,
  type RankingBuilderSettings,
} from "./default-settings";
import { mergeRankingBuilderSettings } from "./validate";

export const RANKING_BUILDER_SETTINGS_ID = "global";
export const RANKING_BUILDER_SETTINGS_MEMO = "settings:ranking_builder";

/** Same row for every caller, admin-edited only: memoised for a minute. */
export async function loadRankingBuilderSettings(
  admin: SupabaseClient<Database>,
): Promise<RankingBuilderSettings> {
  return memoTtl(RANKING_BUILDER_SETTINGS_MEMO, 60_000, async () => {
    try {
      const { data, error } = await admin
        .from("ranking_builder_settings")
        .select("settings")
        .eq("id", RANKING_BUILDER_SETTINGS_ID)
        .maybeSingle();
      if (error || !data?.settings) return DEFAULT_RANKING_BUILDER_SETTINGS;
      return mergeRankingBuilderSettings(data.settings);
    } catch {
      return DEFAULT_RANKING_BUILDER_SETTINGS;
    }
  });
}

/** Persist a full settings document. Admin server actions only. */
export async function saveRankingBuilderSettings(
  admin: SupabaseClient<Database>,
  settings: RankingBuilderSettings,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from("ranking_builder_settings").upsert(
    {
      id: RANKING_BUILDER_SETTINGS_ID,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
