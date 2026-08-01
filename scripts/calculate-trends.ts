/**
 * Calculate trends, CLI entrypoint.
 * Implementation lives in lib/calculate-trends.ts.
 *
 * Run: npm run calculate:trends
 */

import { getServiceClient } from "./_supabase";
import { runCalculateTrends } from "../lib/calculate-trends";

async function main() {
  const supabase = getServiceClient();
  await runCalculateTrends(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
