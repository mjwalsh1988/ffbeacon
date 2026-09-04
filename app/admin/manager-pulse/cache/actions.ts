"use server";

/**
 * Manager Pulse cache invalidation. Two destructive actions, both re-gated and
 * re-validated server side, both computing their own delete predicate from a
 * verified SELECT rather than trusting the client's raw input as the WHERE
 * clause.
 *
 * Bulk invalidation by model version REFUSES the current live version. That is
 * checked against manager_pulse_settings on every call, never against a value
 * the client sent, so a stale form cannot bypass it.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { isValidSleeperHandle } from "@/lib/manager-pulse/discover";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";

export type CacheActionResult =
  | { ok: true; reportsDeleted: number; tendenciesDeleted: number }
  | { ok: false; error: string };

const MAX_HANDLE_LENGTH = 64;
const MAX_VERSION_LENGTH = 32;

/** Invalidate one handle's stored report row(s) and tendency row(s). */
export async function invalidateHandleCacheAction(rawHandle: string): Promise<CacheActionResult> {
  await requireAdmin("/admin/manager-pulse/cache");

  const handle = typeof rawHandle === "string" ? rawHandle.trim().toLowerCase() : "";

  // Validated against the real handle grammar, not merely trimmed and
  // length-capped.
  //
  // The matcher below used to be `ilike`, whose wildcards are `%` and `_`. A
  // Sleeper handle may legally contain an underscore, so an ordinary handle
  // already matched more rows than intended, and a single `%` typed into the
  // box matched EVERY row and deleted the entire cache. The error copy promised
  // "a valid Sleeper handle" and the code did not check for one.
  if (!handle || handle.length > MAX_HANDLE_LENGTH || !isValidSleeperHandle(handle)) {
    return { ok: false, error: "Enter a valid Sleeper handle first." };
  }

  const admin = createAdminClient();

  // `eq`, not `ilike`: an exact match on a value we have already validated.
  // Handles are stored lowercased by the resolver, and the input is lowercased
  // above, so there is nothing for a case-insensitive match to buy here.
  const [reportsRes, tendenciesRes] = await Promise.all([
    admin.from("manager_pulse_cache").select("id").eq("sleeper_handle", handle),
    admin.from("manager_pulse_tendencies").select("sleeper_user_id").eq("sleeper_handle", handle),
  ]);
  if (reportsRes.error) return { ok: false, error: reportsRes.error.message };
  if (tendenciesRes.error) return { ok: false, error: tendenciesRes.error.message };

  const reportIds = (reportsRes.data ?? []).map((r) => r.id);
  const tendencyIds = (tendenciesRes.data ?? []).map((r) => r.sleeper_user_id);

  if (reportIds.length === 0 && tendencyIds.length === 0) {
    return { ok: false, error: "No stored report or tendency row matches that handle." };
  }

  if (reportIds.length > 0) {
    const { error } = await admin.from("manager_pulse_cache").delete().in("id", reportIds);
    if (error) return { ok: false, error: error.message };
  }
  if (tendencyIds.length > 0) {
    const { error } = await admin
      .from("manager_pulse_tendencies")
      .delete()
      .in("sleeper_user_id", tendencyIds);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/manager-pulse/cache");
  return { ok: true, reportsDeleted: reportIds.length, tendenciesDeleted: tendencyIds.length };
}

/**
 * Invalidate every report and tendency row on one model version. Refuses the
 * current version: clearing the live version is an outage, not an
 * invalidation, and an admin who genuinely wants that can do it per handle.
 */
export async function invalidateModelVersionCacheAction(rawVersion: string): Promise<CacheActionResult> {
  await requireAdmin("/admin/manager-pulse/cache");

  const version = typeof rawVersion === "string" ? rawVersion.trim() : "";
  if (!version || version.length > MAX_VERSION_LENGTH) {
    return { ok: false, error: "Choose a model version first." };
  }

  const admin = createAdminClient();

  const settings = await loadManagerPulseSettings(admin);
  if (version === settings.modelVersion) {
    return {
      ok: false,
      error:
        "That is the current model version. Clearing it would take Manager Pulse down rather than invalidate stale rows. Invalidate a superseded version, or clear one handle at a time.",
    };
  }

  const [reportsRes, tendenciesRes] = await Promise.all([
    admin.from("manager_pulse_cache").select("id").eq("model_version", version),
    admin.from("manager_pulse_tendencies").select("sleeper_user_id").eq("model_version", version),
  ]);
  if (reportsRes.error) return { ok: false, error: reportsRes.error.message };
  if (tendenciesRes.error) return { ok: false, error: tendenciesRes.error.message };

  const reportIds = (reportsRes.data ?? []).map((r) => r.id);
  const tendencyIds = (tendenciesRes.data ?? []).map((r) => r.sleeper_user_id);

  if (reportIds.length === 0 && tendencyIds.length === 0) {
    return {
      ok: false,
      error: "No stored rows on that model version. It may already have been cleared.",
    };
  }

  if (reportIds.length > 0) {
    const { error } = await admin.from("manager_pulse_cache").delete().in("id", reportIds);
    if (error) return { ok: false, error: error.message };
  }
  if (tendencyIds.length > 0) {
    const { error } = await admin
      .from("manager_pulse_tendencies")
      .delete()
      .in("sleeper_user_id", tendencyIds);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/manager-pulse/cache");
  return { ok: true, reportsDeleted: reportIds.length, tendenciesDeleted: tendencyIds.length };
}
