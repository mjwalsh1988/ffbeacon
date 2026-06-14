/**
 * Shared server-side helpers for the Player Values & Sources admin sub-pages.
 * The recompute-status check is reused across every sub-page that offers the
 * "Recompute now" affordance so the staleness warning is consistent everywhere.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { formatRelative } from "./datetime";

/** Latest moment any FF Beacon tunable changed (settings/weights/bands/manual). */
async function latestTunableChange(admin: SupabaseClient<Database>): Promise<string | null> {
  const reads = await Promise.all([
    admin.from("beacon_settings").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    admin.from("beacon_signal_weights").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    admin.from("beacon_value_bands").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    admin.from("beacon_manual_signals").select("created_at").order("created_at", { ascending: false }).limit(1),
  ]);
  const stamps: string[] = [];
  for (const r of reads) {
    const row = r.data?.[0] as { updated_at?: string; created_at?: string } | undefined;
    const ts = row?.updated_at ?? row?.created_at;
    if (ts) stamps.push(ts);
  }
  return stamps.length ? stamps.sort().at(-1)! : null;
}

export interface RecomputeStatus {
  stale: boolean;
  lastRunLabel: string;
}

/** Is the board stale (a tunable changed since the last successful recompute)? */
export async function getRecomputeStatus(
  admin: SupabaseClient<Database>,
  nowMs: number,
): Promise<RecomputeStatus> {
  const { data: lastRun } = await admin
    .from("beacon_value_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  const finished = lastRun?.[0]?.finished_at ?? null;
  const tunableMax = await latestTunableChange(admin);
  const stale = !finished || (tunableMax !== null && tunableMax > finished);
  return { stale, lastRunLabel: finished ? formatRelative(finished, nowMs) : "never" };
}
