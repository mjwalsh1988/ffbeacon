/**
 * Shared server-side helpers for the Values, Rankings, & Sources admin sub-pages.
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

export interface PickCoordinates {
  seasons: number[];
  rounds: number[];
}

/**
 * The draft seasons and rounds that currently have published pick values, so the
 * manual-signal composer can offer real choices instead of a free-text year.
 *
 * PostgREST has no DISTINCT and draft_pick_values holds every historical
 * snapshot for every format, so this reads one narrow slice: the newest
 * captured_at, one format, one slot. That is a dozen rows, and it covers every
 * (season, round) pair the engine writes. Falls back to the KTC baseline when
 * FF Beacon has not published picks yet.
 */
export async function loadPickCoordinates(
  admin: SupabaseClient<Database>,
): Promise<PickCoordinates> {
  for (const source of ["ffbeacon", "ktc"]) {
    const { data: newest } = await admin
      .from("draft_pick_values")
      .select("captured_at, format_config_id")
      .eq("source", source)
      .order("captured_at", { ascending: false })
      .limit(1);
    const anchor = newest?.[0];
    if (!anchor) continue;

    const { data: rows } = await admin
      .from("draft_pick_values")
      .select("season, round")
      .eq("source", source)
      .eq("captured_at", anchor.captured_at)
      .eq("format_config_id", anchor.format_config_id)
      .eq("pick_position", "early");
    if (!rows || rows.length === 0) continue;

    return {
      seasons: [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b),
      rounds: [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b),
    };
  }
  return { seasons: [], rounds: [] };
}
