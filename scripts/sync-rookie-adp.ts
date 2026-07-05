/**
 * Rookie ADP sync: CLI entrypoint.
 *
 * Implementation lives in lib/sync-rookie-adp.ts so the same code path is used
 * by the market cron endpoint (app/api/cron/sync-sleeper-market/route.ts), which
 * runs this right after the Sleeper ADP sync so all of player_market_snapshots
 * is produced by one nightly job.
 *
 * Run: npm run sync:rookie-adp
 */

import { getServiceClient } from "./_supabase";
import { runRookieAdpSync } from "../lib/sync-rookie-adp";

async function main() {
  const supabase = getServiceClient();
  const result = await runRookieAdpSync(supabase);
  console.log("\n=== Rookie ADP sync report ===");
  console.log(`Snapshot date:    ${result.scrapeDate ?? "n/a"} (season ${result.season ?? "n/a"})`);
  console.log(`Rookie rows:      ${result.rookieRows}`);
  console.log(`Stored:           ${result.stored}`);
  console.log(`Matched sleeper:  ${result.matchedSleeper}`);
  console.log(`Matched player:   ${result.matchedPlayer}`);
  console.log(`Unmatched:        ${result.unmatched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
