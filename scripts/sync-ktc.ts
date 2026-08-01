/**
 * KeepTradeCut value sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-ktc.ts so the same code path is used by
 * the Vercel cron endpoint (app/api/cron/sync-ktc/route.ts). See the lib
 * file's header for pipeline details, TEP derivation rules, and the 0011
 * footgun history.
 *
 * Run: npm run sync:ktc
 */

import { getServiceClient } from "./_supabase";
import { runKtcSync } from "../lib/sync-ktc";

async function main() {
  const supabase = getServiceClient();
  await runKtcSync(supabase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
