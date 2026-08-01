/**
 * scripts/calculate-league-power-pulse.ts
 *
 * Recalculate league_power_pulse_cache rows. Three modes:
 *   - All leagues:  npm run calculate:power-pulse
 *   - One league:   npm run calculate:power-pulse -- --league-id <uuid>
 *                   npm run calculate:power-pulse -- --sleeper-league-id <id>
 *
 * Add --force to refetch the whole Sleeper schedule rather than just the
 * volatile weeks.
 *
 * Power Pulse is normally computed on demand when a league deep view loads, and
 * is deliberately NOT wired into any nightly cron: recomputing every stored
 * league every night does not scale, and a league nobody opens never needs a
 * row. This script exists for backfills and for verifying a model change across
 * the whole corpus.
 */

import { getServiceClient } from "./_supabase";
import { calculateLeaguePowerPulse } from "../lib/league-power-pulse";

async function main() {
  const args = process.argv.slice(2);
  const leagueIdIdx = args.indexOf("--league-id");
  const sleeperIdIdx = args.indexOf("--sleeper-league-id");
  const force = args.includes("--force");
  const targetLeagueId = leagueIdIdx >= 0 ? args[leagueIdIdx + 1] : null;
  const targetSleeperId = sleeperIdIdx >= 0 ? args[sleeperIdIdx + 1] : null;

  const supabase = getServiceClient();

  let leagueIds: string[] = [];
  if (targetLeagueId) {
    leagueIds = [targetLeagueId];
  } else if (targetSleeperId) {
    const { data, error } = await supabase
      .from("leagues")
      .select("id")
      .eq("sleeper_league_id", targetSleeperId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      console.error(`No league found for sleeper_league_id=${targetSleeperId}`);
      process.exit(1);
    }
    leagueIds = [data.id];
  } else {
    const { data, error } = await supabase.from("leagues").select("id");
    if (error) throw error;
    leagueIds = (data ?? []).map((r) => r.id);
  }

  console.log(`[power-pulse] calculating for ${leagueIds.length} league(s)${force ? " (force)" : ""}`);
  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const leagueId of leagueIds) {
    const start = Date.now();
    try {
      const result = await calculateLeaguePowerPulse(supabase, leagueId, { force });
      const elapsed = Date.now() - start;
      if (!result.ok) {
        console.error(`  [${leagueId}] FAILED in ${elapsed}ms: ${result.error}`);
        failed += 1;
        continue;
      }
      if (result.skipped) {
        console.log(`  [${leagueId}] skipped in ${elapsed}ms: ${result.skipped}`);
        skipped += 1;
        continue;
      }
      console.log(
        `  [${leagueId}] ${result.teams} teams, season ${result.season}, week ${result.currentWeek} in ${elapsed}ms`,
      );
      scored += 1;
    } catch (err) {
      console.error(`  [${leagueId}] THREW in ${Date.now() - start}ms:`, (err as Error).message);
      failed += 1;
    }
  }

  console.log(`[power-pulse] done. scored=${scored} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[power-pulse] unexpected error:", err);
  process.exit(1);
});
