/**
 * Sleeper draft-market sync (ADP + season projections), CLI entrypoint.
 *
 * Implementation lives in lib/sync-sleeper-market.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-sleeper-market/route.ts).
 * Writes one snapshot_date partition into player_market_snapshots per run;
 * re-running on the same date updates that partition in place (idempotent).
 *
 * Run:
 *   npm run sync:market
 *   npm run sync:market -- --season 2026
 *   npm run sync:market -- --season 2026 --season-type regular --date 2026-07-04
 */

import { getServiceClient } from "./_supabase";
import { runSleeperMarketSync, type SleeperMarketSyncOptions } from "../lib/sync-sleeper-market";
import type { SleeperSeasonType } from "../lib/sleeper";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const opts: SleeperMarketSyncOptions = {};
  const season = argVal("--season");
  if (season) opts.season = Number.parseInt(season, 10);
  const seasonType = argVal("--season-type");
  if (seasonType) opts.seasonType = seasonType as SleeperSeasonType;
  const date = argVal("--date");
  if (date) opts.snapshotDate = date;

  const supabase = getServiceClient();
  const result = await runSleeperMarketSync(supabase, opts);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
