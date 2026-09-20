/**
 * Rebuild `faab_market_priors` from scratch.
 *
 * A full replace rather than an increment, deliberately. The cells are
 * quantiles over the whole history, so an increment would have to re-derive
 * the same distributions anyway, and a sum that drifts is worse than a rebuild
 * that takes a minute. Cells that no longer exist are deleted in the same pass,
 * so the table can never keep a stale cell alive by omission.
 *
 * Service role only: the table's RLS gives anon and authenticated SELECT and
 * nothing else.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildPriorCells } from "./priors-build";
import { loadAuctionUniverse } from "./priors-load";

type ServiceClient = SupabaseClient<Database>;

const UPSERT_CHUNK = 500;

export type PriorsRebuildResult = {
  cells: number;
  auctions: number;
  leagues: number;
  deleted: number;
  ms: number;
};

export async function rebuildFaabMarketPriors(
  supabase: ServiceClient,
  opts: { minCellSamples?: number } = {},
): Promise<PriorsRebuildResult> {
  const startedAt = Date.now();

  const universe = await loadAuctionUniverse(supabase);
  const rows = buildPriorCells(universe.auctions, {
    minCellSamples: opts.minCellSamples ?? 0,
  });

  const builtAt = new Date().toISOString();
  const payload = rows.map((row) => ({ ...row, built_at: builtAt }));

  for (let i = 0; i < payload.length; i += UPSERT_CHUNK) {
    const chunk = payload.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("faab_market_priors")
      .upsert(chunk, { onConflict: "cell_key" });
    if (error) throw new Error(`Could not write FAAB priors: ${error.message}`);
  }

  // Anything not rewritten in this pass is a cell the current data no longer
  // supports. Keyed on built_at rather than on a list of keys, so the delete
  // stays one statement however many cells there are.
  let deleted = 0;
  if (payload.length > 0) {
    const { data, error } = await supabase
      .from("faab_market_priors")
      .delete()
      .lt("built_at", builtAt)
      .select("id");
    if (error) throw new Error(`Could not prune stale FAAB priors: ${error.message}`);
    deleted = data?.length ?? 0;
  }

  return {
    cells: payload.length,
    auctions: universe.auctions.length,
    leagues: universe.leagues,
    deleted,
    ms: Date.now() - startedAt,
  };
}

/** When the newest cell was built, or null when the table is empty. */
export async function priorsBuiltAt(supabase: ServiceClient): Promise<Date | null> {
  const { data } = await supabase
    .from("faab_market_priors")
    .select("built_at")
    .order("built_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.built_at) return null;
  const at = new Date(data.built_at);
  return Number.isNaN(at.getTime()) ? null : at;
}
