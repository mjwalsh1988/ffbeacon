/**
 * How big a FAAB budget actually is, across the leagues we sync.
 *
 * This is the evidence behind the board's one presentational rule: bids are a
 * percentage of the budget, never a dollar figure. Read it and the rule
 * explains itself, because no single dollar amount is right for more than
 * about half the leagues.
 *
 * One call to `waiver_budget_spread()` (migration 0332), which groups in SQL
 * rather than paging every league of the season into the app. Service role
 * only, so this is the admin client; it returns budgets and counts and nothing
 * that names a league.
 *
 * Read at render (cached a day) rather than typed into the copy, so the page
 * never quotes a split that stopped being true. A failure throws inside the
 * cache, so nothing is stored, and the caller shows the "not read yet" line.
 */

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { CACHE_TTL } from "@/lib/cache-tags";

export type BudgetSpread = {
  /** Leagues with a published budget this season. */
  total: number;
  /** The most common budgets, most leagues first. */
  buckets: Array<{ budget: number; leagues: number }>;
  /** Leagues whose budget is not one of the listed buckets. */
  otherLeagues: number;
};

/** How many distinct budgets get their own bar before the rest are grouped. */
const BUCKETS_SHOWN = 4;

const EMPTY: BudgetSpread = { total: 0, buckets: [], otherLeagues: 0 };

async function loadBudgetSpreadUncached(season: number): Promise<BudgetSpread> {
  const { data, error } = await createAdminClient().rpc("waiver_budget_spread", {
    p_season: season,
  });
  if (error) throw new Error(`waiver budget spread read failed: ${error.message}`);

  const sorted = (data ?? [])
    .map((row) => ({ budget: Number(row.budget), leagues: Number(row.leagues) }))
    .filter((row) => Number.isFinite(row.budget) && row.budget > 0 && row.leagues > 0)
    .sort((a, b) => b.leagues - a.leagues || a.budget - b.budget);
  const total = sorted.reduce((sum, row) => sum + row.leagues, 0);
  const buckets = sorted.slice(0, BUCKETS_SHOWN);
  const shown = buckets.reduce((sum, row) => sum + row.leagues, 0);
  return { total, buckets, otherLeagues: total - shown };
}

export async function loadBudgetSpreadCached(season: number): Promise<BudgetSpread> {
  try {
    return await unstable_cache(
      () => loadBudgetSpreadUncached(season),
      ["waiver-budget-spread", String(season)],
      { revalidate: CACHE_TTL.daily },
    )();
  } catch (error) {
    console.error("[waiver-wire] budget spread unavailable", error);
    return EMPTY;
  }
}
