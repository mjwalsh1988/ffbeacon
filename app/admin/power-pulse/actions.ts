"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { validatePowerPulseSettings } from "@/lib/power-pulse/validate";
import { savePowerPulseSettings } from "@/lib/power-pulse/settings";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the Power Pulse model config (single global row). Admin-only and
 * validated server-side: the client payload is never trusted, it must pass the
 * full zod schema before it is written via the service-role client.
 *
 * Saving does NOT recompute existing leagues. Every league recomputes on its own
 * next load once the stored model version or the TTL says it is stale, which is
 * deliberate: a weight change must not fan out into thousands of recomputes.
 * Bump the model version to force every league to rescore on next view.
 */
export async function savePowerPulseSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/power-pulse");

  const validated = validatePowerPulseSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const result = await savePowerPulseSettings(admin, validated.settings, userId);
  if (!result.ok) return result;

  revalidatePath("/admin/power-pulse");
  return { ok: true };
}
