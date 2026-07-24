/**
 * Rebuild the player_positional_finishes cache (library form).
 *
 * Positional finishes (a player's rank within their position by summed
 * regular-season fantasy points, per scoring base) used to be computed live by
 * the get_player_positional_finishes RPC on every profile load. This delegates
 * to the rebuild_positional_finishes() SQL function (migration 0144), which does
 * the whole recompute in-database in one atomic transaction and returns the row
 * count. Run nightly after the stats sync and on demand via
 * `npm run calculate:finishes`.
 *
 * The RPC stays in place as the source of truth / parity oracle; this pre-calc
 * table is just its cached output so the read path is a single indexed SELECT.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type CalculatePositionalFinishesResult = {
  ok: boolean;
  written: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runCalculatePositionalFinishes(
  supabase: SupabaseClient<Database>,
): Promise<CalculatePositionalFinishesResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  console.log("Rebuilding player_positional_finishes...");
  const { data, error } = await supabase.rpc("rebuild_positional_finishes");
  if (error) throw error;

  const written = typeof data === "number" ? data : 0;
  const finished = Date.now();
  console.log(`Done. ${written} positional-finish rows rebuilt.`);
  return {
    ok: true,
    written,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
