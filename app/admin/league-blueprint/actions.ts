"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { bustMemo } from "@/lib/memo-ttl";
import {
  BLUEPRINT_SETTINGS_MEMO_KEY,
  saveLeagueBlueprintSettings,
  validateLeagueBlueprintSettings,
} from "@/lib/league-blueprint/settings";

const ADMIN_PATH = "/admin/league-blueprint";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the Team Blueprint thresholds and weights (single global row).
 *
 * Admin-only and validated server-side: the payload must pass the full zod
 * schema and the cross-field rules before it is written with the service-role
 * client. Saving rebuilds nothing. Each stored blueprint rebuilds on its own
 * next view once its TTL lapses, or at once when `version` is bumped, because
 * the version is part of every fingerprint.
 */
export async function saveLeagueBlueprintSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);

  const validated = validateLeagueBlueprintSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveLeagueBlueprintSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  // Drops this instance's memo of the row; other instances age out inside a
  // minute on their own TTL.
  bustMemo(BLUEPRINT_SETTINGS_MEMO_KEY);
  revalidatePath(ADMIN_PATH);
  return { ok: true };
}
