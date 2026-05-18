/**
 * scripts/calculate-league-power-rankings.ts
 *
 * Recalculate league_power_rankings_cache rows. Two modes:
 *   - All leagues:    npm run calculate:power-rankings
 *   - One league:     npm run calculate:power-rankings -- --league-id <uuid>
 *                     npm run calculate:power-rankings -- --sleeper-league-id <id>
 *
 * Reads player_value_trends and draft_pick_values for every active
 * (format, source) combo and computes per-roster starter/bench/picks/total
 * values plus overall + starter ranks. Chained from sync-league.ts after a
 * fresh sync; also runnable standalone after npm run sync:ktc:full to
 * refresh all leagues when player values change.
 */

import { getServiceClient } from "./_supabase";
import { calculateLeaguePowerRankings } from "../lib/league-power-rankings";

async function main() {
  const args = process.argv.slice(2);
  const leagueIdIdx = args.indexOf("--league-id");
  const sleeperIdIdx = args.indexOf("--sleeper-league-id");
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

  console.log(`[power-rankings] calculating for ${leagueIds.length} league(s)`);
  let totalCombos = 0;
  let failed = 0;
  for (const leagueId of leagueIds) {
    const start = Date.now();
    const result = await calculateLeaguePowerRankings(supabase, leagueId);
    const elapsed = Date.now() - start;
    if (!result.ok) {
      console.error(`  [${leagueId}] FAILED in ${elapsed}ms: ${result.error}`);
      failed++;
      continue;
    }
    console.log(
      `  [${leagueId}] ${result.combosWritten} combos x ${result.rostersConsidered} rosters in ${elapsed}ms`,
    );
    totalCombos += result.combosWritten;
  }
  console.log(`[power-rankings] done. combos=${totalCombos} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[power-rankings] unexpected error:", err);
  process.exit(1);
});
