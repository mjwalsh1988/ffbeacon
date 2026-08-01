/**
 * Sleeper current-season stats sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-sleeper-stats.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-sleeper-stats/route.ts).
 * By default it reads Sleeper's live state and refreshes the current week plus
 * the previous week, skipping entirely in the off-season.
 *
 * Run:
 *   npm run sync:stats
 *   npm run sync:stats -- --season 2025 --season-type regular --week 18
 *   npm run sync:stats -- --lookback 2
 */

import { getServiceClient } from "./_supabase";
import { runSleeperStatsSync, type SleeperStatsSyncOptions } from "../lib/sync-sleeper-stats";
import type { SleeperSeasonType } from "../lib/sleeper";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const opts: SleeperStatsSyncOptions = {};
  const season = argVal("--season");
  if (season) opts.season = Number.parseInt(season, 10);
  const seasonType = argVal("--season-type");
  if (seasonType) opts.seasonType = seasonType as SleeperSeasonType;
  const week = argVal("--week");
  if (week) opts.week = Number.parseInt(week, 10);
  const lookback = argVal("--lookback");
  if (lookback) opts.lookbackWeeks = Number.parseInt(lookback, 10);

  const supabase = getServiceClient();
  const result = await runSleeperStatsSync(supabase, opts);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
