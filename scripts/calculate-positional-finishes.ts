/**
 * Rebuild positional finishes — CLI entrypoint.
 * Implementation lives in lib/calculate-positional-finishes.ts.
 *
 * Run: npm run calculate:finishes
 */

import { getServiceClient } from "./_supabase";
import { runCalculatePositionalFinishes } from "../lib/calculate-positional-finishes";

async function main() {
  const supabase = getServiceClient();
  await runCalculatePositionalFinishes(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
