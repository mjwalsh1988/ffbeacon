/**
 * KTC community archive backfill — CLI entrypoint.
 * Implementation lives in lib/backfill-ktc-community-archive.ts.
 *
 * Usage:
 *   npm run backfill:ktc:community             # default since 2024-01-01
 *   npm run backfill:ktc:community -- --since 2023-06-01
 *
 * One-time bootstrap. Do NOT wire into the nightly cron.
 */

import { getServiceClient } from "./_supabase";
import { runCommunityArchiveBackfill } from "../lib/backfill-ktc-community-archive";

async function main() {
  const args = process.argv.slice(2);
  const sinceIdx = args.indexOf("--since");
  const sinceDate = sinceIdx >= 0 ? args[sinceIdx + 1] : "2024-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    console.error(`Invalid --since value "${sinceDate}". Use YYYY-MM-DD.`);
    process.exit(1);
  }
  const supabase = getServiceClient();
  const result = await runCommunityArchiveBackfill(supabase, { sinceDate });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
