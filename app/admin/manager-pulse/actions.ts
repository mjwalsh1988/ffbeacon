"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { validateManagerPulseSettings } from "@/lib/manager-pulse/validate";
import { saveManagerPulseSettings } from "@/lib/manager-pulse/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the Manager Pulse settings (single global row). Admin-only and
 * validated server-side: the client payload is never trusted, it must pass the
 * full schema before it is written via the service-role client.
 *
 * Saving does NOT recompute existing reports. Every report and tendency row
 * recomputes on its own next read once the stored TTL or model version says it
 * is stale. Bump the model version to force every report to rebuild on next
 * view.
 */
export async function saveManagerPulseSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/manager-pulse");

  const validated = validateManagerPulseSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await saveManagerPulseSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  revalidatePath("/admin/manager-pulse");
  return { ok: true };
}
