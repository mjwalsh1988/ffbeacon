"use server";

/**
 * Server actions for the FF Beacon admin control surface. Every action
 * independently re-checks admin via requireAdmin (never trusts the client) and
 * writes through the service-role admin client. All FF Beacon tunables live in
 * the DB, so these are the only write path; nothing is a hardcoded constant.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { runCalculateBeaconValues } from "@/lib/calculate-beacon-values";
import { runSeedRankings } from "@/lib/seed-rankings";
import { runCalculateTrends } from "@/lib/calculate-trends";
import { recordCronRun } from "@/lib/cron-runs";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Update one beacon_settings row, coercing the input to its declared type. */
export async function updateBeaconSetting(key: string, raw: string): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("beacon_settings").select("value_type").eq("key", key).maybeSingle();
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

  const { error } = await admin
    .from("beacon_settings")
    .update({ value: value as never, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

export async function updateSignalWeight(
  id: string,
  fields: { weight: number; confidenceCap: number; isEnabled: boolean },
): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon");
  if (!Number.isFinite(fields.weight) || fields.weight < 0) return fail("Weight must be >= 0.");
  if (!Number.isFinite(fields.confidenceCap) || fields.confidenceCap < 0 || fields.confidenceCap > 1)
    return fail("Confidence cap must be between 0 and 1.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("beacon_signal_weights")
    .update({
      weight: fields.weight,
      confidence_cap: fields.confidenceCap,
      is_enabled: fields.isEnabled,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

/** Flip a source on/off. An inactive source drops cleanly from the blend. The
 *  site-wide default source can never be deactivated: the admin must promote a
 *  new default first, so anonymous users are never left without a default. */
export async function toggleSource(slug: string, isActive: boolean): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  if (!isActive) {
    const { data: row } = await admin
      .from("source_registry")
      .select("is_default")
      .eq("slug", slug)
      .maybeSingle();
    if (row?.is_default) {
      return fail("This is the site-wide default source. Set another source as the default before deactivating it.");
    }
  }
  const { error } = await admin.from("source_registry").update({ is_active: isActive }).eq("slug", slug);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

/** Promote a source to the site-wide default. Atomic via the set_default_source
 *  RPC (clears the prior default in the same statement); the RPC rejects an
 *  inactive target so the default is always an active source. */
export async function setDefaultSource(slug: string): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_default_source", { target_slug: slug });
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

/** Move a source one slot up or down in display order (priority). Swaps the
 *  priority value with the adjacent source; a no-op at the ends. Display order
 *  is independent of the default flag and of is_active. */
export async function moveSource(slug: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("source_registry")
    .select("slug, priority")
    .order("priority", { ascending: true });
  if (error || !rows) return fail(error?.message ?? "Could not load sources.");
  const idx = rows.findIndex((r) => r.slug === slug);
  if (idx < 0) return fail("Unknown source.");
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= rows.length) return { ok: true }; // edge: no-op
  const a = rows[idx];
  const b = rows[targetIdx];
  const { error: e1 } = await admin
    .from("source_registry")
    .update({ priority: b.priority })
    .eq("slug", a.slug);
  if (e1) return fail(e1.message);
  const { error: e2 } = await admin
    .from("source_registry")
    .update({ priority: a.priority })
    .eq("slug", b.slug);
  if (e2) return fail(e2.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

/** Edit a format's public display name. The raw slug is never shown to users;
 *  this display_name is what renders across the site (read live by the UI). */
export async function updateFormatDisplayName(
  formatId: string,
  displayName: string,
): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const name = displayName.trim();
  if (!name) return fail("Display name cannot be empty.");
  if (name.length > 80) return fail("Display name is too long (max 80 characters).");
  const admin = createAdminClient();
  const { error } = await admin
    .from("format_configs")
    .update({ display_name: name })
    .eq("id", formatId);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

export async function upsertValueBand(fields: {
  position: string;
  formatConfigId: string | null;
  floor: number;
  ceiling: number;
}): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon");
  if (fields.ceiling < fields.floor) return fail("Ceiling must be >= floor.");
  const admin = createAdminClient();
  // Manual upsert: the unique constraint is split across two partial indexes
  // (global vs per-format), so resolve the existing row first.
  let query = admin
    .from("beacon_value_bands")
    .select("id")
    .eq("position", fields.position);
  query = fields.formatConfigId === null
    ? query.is("format_config_id", null)
    : query.eq("format_config_id", fields.formatConfigId);
  const { data: existing } = await query.maybeSingle();

  const payload = {
    position: fields.position,
    format_config_id: fields.formatConfigId,
    floor: fields.floor,
    ceiling: fields.ceiling,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await admin.from("beacon_value_bands").update(payload).eq("id", existing.id)
    : await admin.from("beacon_value_bands").insert(payload);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

export async function createManualSignal(fields: {
  target: "player" | "pick";
  playerId: string | null;
  pickSeason: number | null;
  pickRound: number | null;
  pickPosition: string | null;
  formatConfigId: string | null;
  adjustmentType: "multiplier" | "delta" | "set_value";
  magnitude: number;
  silent: boolean;
  reason: string;
  decayDays: number | null;
}): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon");
  if (!Number.isFinite(fields.magnitude)) return fail("Magnitude must be a number.");
  if (fields.target === "player" && !fields.playerId) return fail("Pick a player.");
  if (fields.target === "pick" && (fields.pickRound === null || !fields.pickPosition))
    return fail("Pick round and slot are required for a pick signal.");
  const admin = createAdminClient();
  const { error } = await admin.from("beacon_manual_signals").insert({
    target: fields.target,
    player_id: fields.target === "player" ? fields.playerId : null,
    pick_season: fields.target === "pick" ? fields.pickSeason : null,
    pick_round: fields.target === "pick" ? fields.pickRound : null,
    pick_position: fields.target === "pick" ? fields.pickPosition : null,
    format_config_id: fields.formatConfigId,
    adjustment_type: fields.adjustmentType,
    magnitude: fields.magnitude,
    silent: fields.silent,
    reason: fields.reason || null,
    decay_days: fields.decayDays,
    created_by: userId,
  });
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

export async function setManualSignalActive(id: string, isActive: boolean): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  const { error } = await admin.from("beacon_manual_signals").update({ is_active: isActive }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/admin/beacon");
  return { ok: true };
}

/**
 * Recompute the full FF Beacon board now: values, then rankings + trends, so the
 * review table reflects the latest settings immediately. Recorded in cron_runs.
 */
export async function recomputeBeacon(): Promise<ActionResult> {
  await requireAdmin("/admin/beacon");
  const admin = createAdminClient();
  try {
    await recordCronRun(admin, "recalculate-beacon", async () => {
      const values = await runCalculateBeaconValues(admin);
      const rankings = await runSeedRankings(admin);
      const trends = await runCalculateTrends(admin);
      return { ok: true as const, trigger: "admin-manual", values, rankings, trends };
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  revalidatePath("/admin/beacon");
  return { ok: true };
}
