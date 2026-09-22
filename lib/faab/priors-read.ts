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

const CELL_COLUMNS =
  "cell_key, league_kind, superflex, position, phase, bidders, sample_size, zero_share, p05, p10, p25, p50, p75, p90, p95, p99, runner_up_ratio_p50, leagues_count, seasons, built_at";

/** PostgREST caps a response at 1,000 rows whatever `limit` asks for. */
const PAGE_SIZE = 1000;

/**
 * Every cell, PAGED.
 *
 * THE `.limit(5000)` THIS REPLACES DID NOT WORK AND FAILED SILENTLY, which is
 * the worst shape a data bug can have. PostgREST enforces its own max-rows of
 * 1,000 regardless of what `limit` asks for, so the read returned the first
 * 1,000 cells by `cell_key` and no error. Cell keys begin with the league kind,
 * so alphabetical order decided which half of the market the calculator could
 * see: all 224 chopped cells and all 727 pooled "any" cells loaded, 49 of 453
 * dynasty cells loaded, and every one of the 551 redraft cells was dropped.
 *
 * The consequence was not a missing table. `pickCell` falls back to a broader
 * cell when the exact one is absent, and the broadest cell is `any|...`, which
 * always loaded. So a redraft reader was priced off a distribution pooled with
 * dynasty, including its offseason rookie claims, and the page had no way to
 * say so because nothing had failed. Chopped was correct throughout purely
 * because "chopped" sorts before "dynasty".
 *
 * Page until a short page arrives. See the memory note on this exact trap:
 * a `select()` without `range()` truncates at 1,000 rows and says nothing.
 */
async function readAllCells(): Promise<PriorCell[]> {
  // The publishable-key client, on purpose: these cells are public by policy
  // (anon SELECT), they carry no identifier, and a cached read that needs the
  // service role would be a cached read holding a secret-key client open.
  const supabase = createCachedReadClient();
  const out: PriorCell[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("faab_market_priors")
      .select(CELL_COLUMNS)
      .order("cell_key", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    // A failed page mid-read would leave a PARTIAL market, which is the same
    // silent half-answer this function exists to stop. Return nothing instead:
    // every consumer already handles an empty list by saying so on the page.
    if (error) return [];
    if (!data || data.length === 0) break;
    for (const row of data) out.push(toPriorCell(row as unknown as Record<string, unknown>));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
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
