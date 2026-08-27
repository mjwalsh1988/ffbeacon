/**
 * scripts/calculate-positional-war.ts
 *
 * Recalculate league_positional_war_cache rows. Three modes:
 *   - All leagues:  npm run calculate:positional-war
 *   - One league:   npm run calculate:positional-war -- --league-id <uuid>
 *                   npm run calculate:positional-war -- --sleeper-league-id <id>
 *
 * Add --force to bypass every cache: the backoff, the staleness check, and
 * the cross-league compute sharing in lib/positional-war/share.ts all get
 * skipped in favor of a fresh computation.
 *
 * Positional WAR is normally computed on demand when a league deep view
 * loads, and is deliberately NOT wired into any nightly cron: recomputing
 * every stored league every night does not scale, and a league nobody opens
 * never needs a row. This script exists for backfills and for verifying a
 * model change across the whole corpus. Mirrors
 * scripts/calculate-league-power-pulse.ts exactly.
 */

import { getServiceClient } from "./_supabase";
import { runWithVerdict } from "../lib/league-positional-war";

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

  console.log(
    `[positional-war] calculating for ${leagueIds.length} league(s)${force ? " (force)" : ""}`,
  );
  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const leagueId of leagueIds) {
    const start = Date.now();
    try {
      // runWithVerdict rather than calculateLeaguePositionalWar, so a manual
      // recompute stamps positional_war_attempted_at and writes the verdict the
      // same way a page view does. Calling the calculation directly wrote cache
      // rows and left positional_war_succeeded_at null, which the admin
      // league-health view reads as a systemic break.
      const result = await runWithVerdict(supabase, leagueId, { force }, new Date().toISOString());
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
        `  [${leagueId}] ${result.positions} positions, season ${result.season}, weeks ${result.fromWeek}-${result.toWeek}, shared=${result.shared} in ${elapsed}ms`,
      );
      scored += 1;
    } catch (err) {
      console.error(`  [${leagueId}] THREW in ${Date.now() - start}ms:`, (err as Error).message);
      failed += 1;
    }
  }

  console.log(`[positional-war] done. scored=${scored} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[positional-war] unexpected error:", err);
  process.exit(1);
});
