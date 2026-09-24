/**
 * Rebuild player_idp_seasons, CLI entrypoint.
 * Implementation lives in lib/calculate-idp-seasons.ts.
 *
 * Run:
 *   npm run calculate:idp-seasons            # the current season (what the cron does)
 *   npm run calculate:idp-seasons -- --all   # 2020 to 2025 plus the current season, once
 */

import { getServiceClient } from "./_supabase";
import { runCalculateIdpSeasons } from "../lib/calculate-idp-seasons";
import { currentNflSeason } from "../lib/sleeper";

async function main() {
  const supabase = getServiceClient();
  const current = Number(currentNflSeason());
  const seasons = process.argv.includes("--all")
    ? Array.from({ length: current - 2020 + 1 }, (_, i) => 2020 + i)
    : [current];
  const result = await runCalculateIdpSeasons(supabase, { seasons });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
