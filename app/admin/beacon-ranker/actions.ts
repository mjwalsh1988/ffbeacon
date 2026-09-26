"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { bustMemo } from "@/lib/memo-ttl";
import { validateRankingBuilderSettings } from "@/lib/ranking-boards/validate";
import {
  RANKING_BUILDER_SETTINGS_MEMO,
  saveRankingBuilderSettings,
} from "@/lib/ranking-boards/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the Beacon Ranker settings (single global row). Admin-only and
 * validated server-side: the client payload must pass the full schema before
 * it is written with the service-role client. A run already in progress keeps
 * the depth and cap it started with; new runs and the next nightly community
 * build read the new values.
 */
export async function saveBeaconRankerSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon-ranker");

  const validated = validateRankingBuilderSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveRankingBuilderSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  bustMemo(RANKING_BUILDER_SETTINGS_MEMO);
  revalidatePath("/admin/beacon-ranker");
  return { ok: true };
}
