/**
 * Build source-attributed rankings — CLI entrypoint.
 * Implementation lives in lib/seed-rankings.ts.
 *
 * Run: npm run seed:rankings
 */

import { getServiceClient } from "./_supabase";
import { runSeedRankings } from "../lib/seed-rankings";

async function main() {
  const supabase = getServiceClient();
  await runSeedRankings(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
