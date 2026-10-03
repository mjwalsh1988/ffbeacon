/**
 * Game weather sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-nfl-weather.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-nfl-weather/route.ts).
 * Appends one forecast snapshot per open-air game to nfl_game_weather, and one
 * indoor row per roofed game that does not have one yet. A re-run adds a newer
 * snapshot; it never rewrites an old one.
 *
 * Run:
 *   npm run sync:weather
 *   npm run sync:weather -- --scope gameday
 *
 * Under PowerShell `npm run sync:weather -- --scope gameday` loses its flags.
 * Call tsx directly there:
 *   npx tsx --env-file=.env.local scripts/sync-nfl-weather.ts --scope gameday
 */

import { getServiceClient } from "./_supabase";
import { runNflWeatherSync, type NflWeatherSyncScope } from "../lib/sync-nfl-weather";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const requested = argVal("--scope") ?? "nightly";
  if (requested !== "nightly" && requested !== "gameday") {
    throw new Error(`Unknown --scope "${requested}". Use nightly or gameday.`);
  }
  const scope: NflWeatherSyncScope = requested;

  const supabase = getServiceClient();
  const result = await runNflWeatherSync(supabase, { scope });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
