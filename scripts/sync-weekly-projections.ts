/**
 * Sleeper weekly point-projection sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-weekly-projections.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-weekly-projections/route.ts).
 * Overwrites player_weekly_projections rows in place (idempotent upserts on the
 * unique key), so re-running simply refreshes the latest projection per week.
 *
 * Run:
 *   npm run sync:weekly-projections
 *   npm run sync:weekly-projections -- --season 2026
 *   npm run sync:weekly-projections -- --season 2026 --from-week 1 --to-week 18
 *   npm run sync:weekly-projections -- --season-type regular
 */

import { getServiceClient } from "./_supabase";
import {
  runWeeklyProjectionsSync,
  type WeeklyProjectionsSyncOptions,
} from "../lib/sync-weekly-projections";
import type { SleeperSeasonType } from "../lib/sleeper";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const opts: WeeklyProjectionsSyncOptions = {};
  const season = argVal("--season");
  if (season) opts.season = Number.parseInt(season, 10);
  const seasonType = argVal("--season-type");
  if (seasonType) opts.seasonType = seasonType as SleeperSeasonType;
  const fromWeek = argVal("--from-week");
  if (fromWeek) opts.fromWeek = Number.parseInt(fromWeek, 10);
  const toWeek = argVal("--to-week");
  if (toWeek) opts.toWeek = Number.parseInt(toWeek, 10);

  const supabase = getServiceClient();
  const result = await runWeeklyProjectionsSync(supabase, opts);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
