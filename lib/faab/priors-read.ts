/**
 * The cached server read of the FAAB market cells.
 *
 * The maths lives in lib/faab/priors-math.ts, which is pure and therefore
 * safe to import into a client component: manual mode draws its win curve in
 * the browser as the reader drags the controls, and it cannot pull a module
 * that imports next/cache and a Supabase client to do it. This file is the
 * read, and nothing else.
 */

import { unstable_cache } from "next/cache";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { createCachedReadClient } from "@/lib/supabase/server";
import { toPriorCell, type PriorCell } from "./priors-math";

export type {
  PickedCell,
  PriorCell,
  PriorWant,
} from "./priors-math";
export { bidForTargetFromCell, pickCell, priorCdf } from "./priors-math";

async function readAllCells(): Promise<PriorCell[]> {
  // The publishable-key client, on purpose: these cells are public by policy
  // (anon SELECT), they carry no identifier, and a cached read that needs the
  // service role would be a cached read holding a secret-key client open.
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("faab_market_priors")
    .select(
      "cell_key, league_kind, superflex, position, phase, bidders, sample_size, zero_share, p05, p10, p25, p50, p75, p90, p95, p99, runner_up_ratio_p50, leagues_count, seasons, built_at",
    )
    .order("cell_key", { ascending: true })
    .limit(5000);
  if (error || !data) return [];
  return data.map((row) => toPriorCell(row as unknown as Record<string, unknown>));
}

const cachedRead = unstable_cache(readAllCells, ["faab-market-priors"], {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.faabPriors],
});

/**
 * Every cell, cached.
 *
 * A few thousand small rows, rebuilt at most every few days, read by the
 * calculator and by two guides. One cached read beats a query per page.
 *
 * The fallback is not defensive padding. `unstable_cache` throws
 * "incrementalCache missing" the moment it is called outside a Next request,
 * and the FAAB engine is deliberately a plain library function: it runs from
 * server actions, but also from scripts (the replay, a one-off price check)
 * and from anything a cron might add later. Without this, importing the
 * engine into a script turns a cache miss into a crash, which is how the
 * first end-to-end run of the chopped model failed.
 */
export async function loadPriorCellsCached(): Promise<PriorCell[]> {
  try {
    return await cachedRead();
  } catch {
    return readAllCells();
  }
}
