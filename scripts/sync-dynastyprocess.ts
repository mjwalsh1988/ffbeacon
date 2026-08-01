/**
 * DynastyProcess value sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-dynastyprocess.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-dynastyprocess/route.ts).
 *
 * Run: npm run sync:dynastyprocess
 */

import { getServiceClient } from "./_supabase";
import { runDynastyProcessSync } from "../lib/sync-dynastyprocess";

async function main() {
  const supabase = getServiceClient();
  await runDynastyProcessSync(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
