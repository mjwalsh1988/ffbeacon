/**
 * FantasyCalc value sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-fantasycalc.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-fantasycalc/route.ts).
 *
 * Run: npm run sync:fantasycalc
 */

import { getServiceClient } from "./_supabase";
import { runFantasyCalcSync } from "../lib/sync-fantasycalc";

async function main() {
  const supabase = getServiceClient();
  await runFantasyCalcSync(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
