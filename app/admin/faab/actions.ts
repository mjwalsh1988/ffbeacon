"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { validateFaabSettings, FAAB_SETTINGS_ID } from "@/lib/faab/settings";
import type { Json } from "@/lib/database.types";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the FAAB calculator settings (single global row). Admin-only and
 * validated server-side: the client payload is never trusted: it must pass the
 * full zod schema before it is written via the service-role client.
 */
export async function saveFaabSettings(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/faab");

  const validated = validateFaabSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };

  const admin = createAdminClient();
  const { error } = await admin.from("faab_calculator_settings").upsert(
    {
      id: FAAB_SETTINGS_ID,
      settings: validated.settings as unknown as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/faab");
  revalidatePath("/tools/faab");
  return { ok: true };
}
