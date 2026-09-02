/**
 * Build the FF Beacon projections into player_weekly_projections with
 * source = 'ffbeacon'. Implementation lives in lib/build-beacon-projections.ts.
 *
 * Run: npm run build:projections
 *      npm run build:projections -- --season 2026
 *      npm run build:projections -- --from-week 5 --to-week 10
 *
 * Idempotent. Upserts on the same unique key the Sleeper sync uses, then
 * clears any row inside the window this run did not touch.
 */

import { getServiceClient } from "./_supabase";
import { runBuildBeaconProjections } from "../lib/build-beacon-projections";

function numberArg(flag: string): number | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main() {
  const supabase = getServiceClient();
  console.log("Building FF Beacon projections...");

  const result = await runBuildBeaconProjections(supabase, {
    season: numberArg("--season"),
    fromWeek: numberArg("--from-week"),
    toWeek: numberArg("--to-week"),
  });

  if (result.skipped) {
    console.log(`Skipped: ${result.reason}`);
    return;
  }

  console.log(
    `Done. ${result.rowsWritten} rows for ${result.season} weeks ${result.fromWeek} to ${result.toWeek} ` +
      `in ${result.durationMs}ms (model ${result.modelVersion}).`,
  );
  console.log(
    `  ${result.modelled} modelled from our own usage, ${result.rowsWritten - result.modelled} mirrored from Sleeper.`,
  );
  const reasons = Object.entries(result.mirrored)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(", ");
  if (reasons) console.log(`  mirrored because: ${reasons}`);
  console.log(
    `  inputs: ${result.sleeperRows} sleeper rows, ${result.statRows} stat rows, ` +
      `${result.oddsRows} team-week environments, ${result.subjects} players.`,
  );
  if (result.droppedNoSleeperId > 0) {
    console.log(
      `  WARNING: ${result.droppedNoSleeperId} player-week(s) dropped for want of a sleeper_player_id.`,
    );
  }
  const timingSummary = Object.entries(result.phaseTimings)
    .map(([label, ms]) => `${label}=${ms}ms`)
    .join(", ");
  if (timingSummary) console.log(`  phase timings: ${timingSummary}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
