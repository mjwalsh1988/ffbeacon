"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Update one Signal Check setting (a beacon_settings row in a signal_check*
 * category) and append a signal_check_audit_log row capturing before/after.
 * Mirrors updateBeaconSetting's coercion but is scoped + audited.
 */
export async function updateSignalCheckSetting(key: string, raw: string): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/signal-check");
  if (!key.startsWith("signal_check")) return fail("Not a Signal Check setting.");

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("beacon_settings")
    .select("value, value_type")
    .eq("key", key)
    .maybeSingle();
  if (readErr || !row) return fail(readErr?.message ?? `Unknown setting: ${key}`);

  let value: unknown;
  if (row.value_type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fail("Value must be a number.");
    value = n;
  } else if (row.value_type === "boolean") {
    value = raw === "true";
  } else {
    value = raw;
  }

  const before = row.value;
  const { error } = await admin
    .from("beacon_settings")
    .update({ value: value as never, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return fail(error.message);

  await admin.from("signal_check_audit_log").insert({
    actor_user_id: userId,
    action: "setting_change",
    target: key,
    before: { value: before } as never,
    after: { value: value } as never,
  });

  revalidatePath("/admin/signal-check");
  return { ok: true };
}
