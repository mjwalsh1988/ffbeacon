"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { bustMemo } from "@/lib/memo-ttl";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  MARKET_SIGNAL_SETTINGS_MEMO_KEY,
  loadMarketSignalSettings,
  saveMarketSignalSettings,
  validateMarketSignalSettings,
} from "@/lib/market-signals/settings";
import { listPartitions, type FormatRow, type SourceRow } from "@/lib/market-signals/partitions";
import { runPartition, supabasePartitionIO } from "@/lib/market-signals/run-partition";

const ADMIN_PATH = "/admin/market-signals";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Persist the engine settings. Admin-only, validated server-side. */
export async function saveMarketSignalSettingsAction(raw: unknown): Promise<ActionResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);
  const validated = validateMarketSignalSettings(raw);
  if (!validated.ok) return { ok: false, error: validated.error };
  const admin = createAdminClient();
  const result = await saveMarketSignalSettings(admin, validated.settings, userId);
  if (!result.ok) return result;
  bustMemo(MARKET_SIGNAL_SETTINGS_MEMO_KEY);
  revalidatePath(ADMIN_PATH);
  return { ok: true };
}

/**
 * Run ONE partition now. Bounded by construction: the key must name a
 * partition the registry declares, and only that one runs, through the same
 * runner the cron uses. Not the cron route, so CRON_SECRET never reaches the
 * browser.
 */
export async function runPartitionNowAction(key: unknown): Promise<ActionResult> {
  await requireAdmin(ADMIN_PATH);
  if (typeof key !== "string" || !/^[0-9a-f-]{36}\|[a-z0-9-]{1,40}$/.test(key)) {
    return { ok: false, error: "Pick a partition." };
  }
  const [formatConfigId, source] = key.split("|");
  const admin = createAdminClient();
  const [formatsRes, sourcesRes] = await Promise.all([
    admin.from("format_configs").select("id, slug, display_name, display_order").eq("is_active", true),
    admin
      .from("source_registry")
      .select("slug, display_name, priority, is_default, data_type, supported_format_slugs")
      .eq("is_active", true),
  ]);
  if (formatsRes.error || sourcesRes.error) return { ok: false, error: "Could not read the registry." };
  const partition = listPartitions(
    (formatsRes.data ?? []) as FormatRow[],
    (sourcesRes.data ?? []) as SourceRow[],
  ).find((p) => p.formatConfigId === formatConfigId && p.source === source);
  if (!partition) return { ok: false, error: "That source does not declare that format." };

  const settings = await loadMarketSignalSettings(admin);
  try {
    const r = await runPartition(supabasePartitionIO(admin), partition, settings);
    if (r.rowsWritten > 0) revalidateTag(CACHE_TAGS.playerValues);
    revalidatePath(ADMIN_PATH);
    return {
      ok: true,
      message: r.tooThin
        ? `${partition.sourceDisplay} ${partition.formatDisplay}: too few priced players to signal; stamped with 0 rows.`
        : `${partition.sourceDisplay} ${partition.formatDisplay}: ${r.rowsWritten} rows and ${r.changesWritten} changes in ${(r.durationMs / 1000).toFixed(1)} seconds.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
