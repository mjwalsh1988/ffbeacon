"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { validateDraftValueSettings } from "@/lib/draft-value/validate";
import { saveDraftValueSettings } from "@/lib/draft-value/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the Beacon Steals model config (single global row).
 *
 * Admin-only and validated server-side: the client payload is never trusted, it
 * must pass the full zod schema before it is written through the service-role
 * client. draft_value_settings has no anon or authenticated policy, so a
 * bypassed form cannot write to it either way, but the gate here is the one that
 * matters.
 *
 * Saving does NOT rebuild the board. The nightly job at
 * /api/cron/rebuild-draft-value rescores everything against whatever is stored
 * when it next runs, or `npm run calculate:draft-value` does it now. Bumping the
 * model version is what marks the existing rows as produced by an older model.
 */
export async function saveDraftValueSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/draft-value");

  const validated = validateDraftValueSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveDraftValueSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  revalidatePath("/admin/draft-value");
  return { ok: true };
}
