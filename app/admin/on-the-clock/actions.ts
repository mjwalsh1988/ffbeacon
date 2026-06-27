"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  validateOnTheClockSettings,
  clampOnTheClockSettings,
  ON_THE_CLOCK_SETTINGS_ID,
} from "@/lib/on-the-clock/settings";
import type { OnTheClockSettings } from "@/lib/on-the-clock/types";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the On The Clock settings (single global row). Admin-only and validated
 * server-side: the client payload is never trusted. The flow is coerce -> validate
 * -> write:
 *   1. clampOnTheClockSettings coerces every numeric field into a safe range (and
 *      lockSeconds <= cooldownSeconds) so a typo cannot push the public tool into a
 *      dangerous state. A stray non-numeric number falls back to its default rather
 *      than breaking the tool; wrong enums/types are still caught in step 2.
 *      Unwired/unknown keys pass through untouched.
 *   2. validateOnTheClockSettings runs the full zod schema (types + enums +
 *      refinements), merging missing keys onto code defaults. A malformed enum or
 *      type that clamping cannot rescue fails here.
 *   3. The validated object is written via the service-role client (the table is
 *      service-role-only RLS). updated_by is the verified admin session, never input.
 */
export async function saveOnTheClockSettings(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/on-the-clock");

  // Clamp first (numbers into safe ranges, lockSeconds <= cooldownSeconds), then
  // validate the clamped object so a valid-but-out-of-range payload is rescued
  // instead of rejected, while bad enums/types still fail validation.
  const base = (raw && typeof raw === "object" ? raw : {}) as OnTheClockSettings;
  const clamped = clampOnTheClockSettings(base);
  const validated = validateOnTheClockSettings(clamped);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin.from("on_the_clock_settings").upsert(
    {
      id: ON_THE_CLOCK_SETTINGS_ID,
      settings: validated.settings as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/on-the-clock");
  revalidatePath("/tools/on-the-clock");
  return { ok: true };
}

/**
 * Reset the settings row to the code defaults, but PRESERVE the current feature
 * on/off state so a reset never silently launches or pulls the public tool. Returns
 * the settings that were written so the client can sync its form to them.
 */
export async function resetOnTheClockSettings(): Promise<
  { ok: true; settings: OnTheClockSettings } | { ok: false; error: string }
> {
  const { userId } = await requireAdmin("/admin/on-the-clock");

  const admin = createAdminClient();
  // Read the current feature flag so the reset keeps launch state intact.
  const { data: current } = await admin
    .from("on_the_clock_settings")
    .select("settings")
    .eq("id", ON_THE_CLOCK_SETTINGS_ID)
    .maybeSingle();

  const currentParsed = validateOnTheClockSettings(current?.settings ?? {});
  const keepEnabled = currentParsed.ok ? currentParsed.settings.feature.enabled : false;

  const defaults = validateOnTheClockSettings({});
  if (!defaults.ok) return { ok: false, error: defaults.error };
  const next: OnTheClockSettings = {
    ...defaults.settings,
    feature: { ...defaults.settings.feature, enabled: keepEnabled },
  };

  const { error } = await admin.from("on_the_clock_settings").upsert(
    {
      id: ON_THE_CLOCK_SETTINGS_ID,
      settings: next as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/on-the-clock");
  revalidatePath("/tools/on-the-clock");
  return { ok: true, settings: next };
}
