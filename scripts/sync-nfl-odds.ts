/**
 * ESPN game odds sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-nfl-odds.ts so the same code path is used by
 * the Vercel cron endpoint (app/api/cron/sync-nfl-odds/route.ts). Overwrites
 * nfl_game_odds rows in place (idempotent upserts on the unique key), so
 * re-running simply refreshes the latest line per week.
 *
 * Run:
 *   npm run sync:odds
 *   npm run sync:odds -- --season 2026
 *   npm run sync:odds -- --season 2026 --from-week 1 --to-week 18
 *   npm run sync:odds -- --season-type regular
 */

import { getServiceClient } from "./_supabase";
import { runNflOddsSync, type NflOddsSyncOptions } from "../lib/sync-nfl-odds";
import type { EspnSeasonType } from "../lib/nfl-odds";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const opts: NflOddsSyncOptions = {};
  const season = argVal("--season");
  if (season) opts.season = Number.parseInt(season, 10);
  const seasonType = argVal("--season-type");
  if (seasonType) opts.seasonType = seasonType as EspnSeasonType;
  const fromWeek = argVal("--from-week");
  if (fromWeek) opts.fromWeek = Number.parseInt(fromWeek, 10);
  const toWeek = argVal("--to-week");
  if (toWeek) opts.toWeek = Number.parseInt(toWeek, 10);

  const supabase = getServiceClient();
  const result = await runNflOddsSync(supabase, opts);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
