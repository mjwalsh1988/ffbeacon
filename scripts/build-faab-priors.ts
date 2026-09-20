/**
 * scripts/build-faab-priors.ts
 *
 * Rebuild the anonymous FAAB clearing-price table:
 *   npm run faab:priors
 *
 * This is a global aggregate over waiver transactions, not a per-league
 * compute: it iterates rows, never leagues, which is why it is also safe as a
 * step in the nightly recalculate-derived cron. The cron only runs it when the
 * newest cell is older than settings.priors.staleAfterDays; this script always
 * rebuilds, so it is the way to pick up a change to the builder itself.
 */

import { getServiceClient } from "./_supabase";
import { rebuildFaabMarketPriors } from "../lib/faab/priors-write";

async function main() {
  const supabase = getServiceClient();
  console.log("Rebuilding faab_market_priors...");
  const result = await rebuildFaabMarketPriors(supabase);
  console.log(
    `Done in ${(result.ms / 1000).toFixed(1)}s: ${result.cells} cells from ${result.auctions} auctions across ${result.leagues} leagues (${result.deleted} stale cells removed).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
