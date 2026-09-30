import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRowsByKeyset } from "@/lib/supabase/fetch-all";

type Client = SupabaseClient<Database>;

export type PickSnapshotRow = {
  season: number;
  round: number;
  pick_position: string;
  value: number;
};

/**
 * The newest draft pick capture for one (format, source), read whole.
 *
 * Every sync writes the full set of pick slots a source publishes in one run,
 * stamped with one captured_at, so the newest capture IS the current price of
 * every slot. Reading only that capture replaces reading every capture ever
 * taken (about 4,000 to 4,600 rows per format and source, growing every night)
 * to keep the newest row per slot in memory.
 *
 * One consequence is deliberate: a slot the source has stopped publishing (KTC
 * dropped the 2026 picks on 2026-09-07, once that draft had happened) is absent
 * rather than carried forward at its last price. A pick that no longer trades
 * has no current price, and every reader already treats a missing slot as
 * contributing nothing.
 *
 * Both reads are served by idx_draft_pick_values_format_source_captured
 * (migration 0330). Throws on a failed read, so a caller never mistakes a
 * failure for a source with no picks.
 */
export async function loadLatestPickSnapshot(
  supabase: Client,
  formatConfigId: string,
  source: string,
): Promise<{ capturedAt: string | null; rows: PickSnapshotRow[] }> {
  const { data: newest, error: newestErr } = await supabase
    .from("draft_pick_values")
    .select("captured_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newestErr) {
    throw new Error(`newest draft_pick_values capture for ${formatConfigId}/${source}: ${newestErr.message}`);
  }
  if (!newest?.captured_at) return { capturedAt: null, rows: [] };

  const rows = await fetchAllRowsByKeyset(
    `draft_pick_values ${formatConfigId}/${source} at ${newest.captured_at}`,
    (after, limit) => {
      let q = supabase
        .from("draft_pick_values")
        .select("id, season, round, pick_position, value")
        .eq("format_config_id", formatConfigId)
        .eq("source", source)
        .eq("captured_at", newest.captured_at)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    },
    (row) => row.id,
  );
  return {
    capturedAt: newest.captured_at,
    rows: rows.map((r) => ({
      season: r.season,
      round: r.round,
      pick_position: r.pick_position,
      value: Number(r.value),
    })),
  };
}
