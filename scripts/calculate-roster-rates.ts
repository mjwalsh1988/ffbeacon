/**
 * Rebuild `player_roster_rates`, CLI entrypoint.
 *
 * The availability column on every waiver wire page: what share of this
 * season's synced Sleeper leagues already roster each player. Normally rebuilt
 * by the nightly `/api/cron/recalculate-derived` job; this is the manual
 * one-off, for after a bulk league sync or when a board looks stale.
 *
 * Implementation lives in lib/waiver-wire/roster-rates.ts and, below it, the
 * refresh_player_roster_rates SQL function from migration 0292.
 *
 * Run: npm run calculate:roster-rates
 *      npm run calculate:roster-rates -- --season 2026
 */

import { getServiceClient } from "./_supabase";
import {
  refreshRosterRates,
  refreshRosterRatesForSeason,
} from "../lib/waiver-wire/roster-rates";

function seasonArg(): number | null {
  const i = process.argv.indexOf("--season");
  if (i === -1) return null;
  const value = Number(process.argv[i + 1]);
  return Number.isInteger(value) ? value : null;
}

async function main() {
  const supabase = getServiceClient();
  const season = seasonArg();

  const results = season
    ? [await refreshRosterRatesForSeason(supabase, season)]
    : await refreshRosterRates(supabase);

  if (results.length === 0) {
    console.log("[roster-rates] No synced leagues to measure. Nothing written.");
    return;
  }

  let failed = false;
  for (const result of results) {
    if (result.error) {
      failed = true;
      console.error(`[roster-rates] ${result.season} failed: ${result.error}`);
    } else if (result.written === 0) {
      // Not an error. The function leaves stored counts alone rather than
      // replacing them with zeroes when a season has no leagues yet, and a
      // zero here reads as "nobody rosters anybody", which is a claim we
      // have not earned.
      console.log(
        `[roster-rates] ${result.season}: no leagues with rosters, existing rows left untouched.`,
      );
    } else {
      console.log(`[roster-rates] ${result.season}: ${result.written} players written.`);
    }
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
