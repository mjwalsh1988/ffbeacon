/**
 * scripts/calculate-manager-ledger.ts
 *
 * Recalculate league_manager_ledger_cache rows. Three modes:
 *   - All leagues:  npm run calculate:manager-ledger
 *   - One league:   npm run calculate:manager-ledger -- --league-id <uuid>
 *                   npm run calculate:manager-ledger -- --sleeper-league-id <id>
 *
 * `--force` is passed through to the calculation. Note that this script always
 * recomputes either way: it calls `runWithVerdict`, which does not consult the
 * staleness gate at all, so the flag only matters to code downstream of it.
 *
 * The Manager Ledger is normally computed on demand when the Decisions page
 * loads, and is deliberately NOT wired into any nightly cron: recomputing every
 * stored league every night does not scale, and a league nobody opens never
 * needs a row. This script exists for backfills and for verifying a model
 * change across the whole corpus. Mirrors scripts/calculate-positional-war.ts.
 */

import { getServiceClient } from "./_supabase";
import { runWithVerdict } from "../lib/league-manager-ledger";

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
    // PAGED. A plain select() stops at PostgREST's 1000-row default and reports
    // no error, so an all-leagues run would silently have skipped every league
    // past the first thousand and reported success.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("leagues")
        .select("id")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = data ?? [];
      leagueIds.push(...page.map((r) => r.id));
      if (page.length < PAGE) break;
    }
  }

  console.log(
    `[manager-ledger] calculating for ${leagueIds.length} league(s)${force ? " (force)" : ""}`,
  );
  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const leagueId of leagueIds) {
    const start = Date.now();
    try {
      // runWithVerdict rather than calculateLeagueManagerLedger, so a manual
      // recompute stamps manager_ledger_attempted_at and writes the verdict the
      // same way a page view does. Calling the calculation directly would write
      // cache rows and leave manager_ledger_succeeded_at null, which the admin
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
        `  [${leagueId}] ${result.teams} teams, season ${result.season}, ${result.gradedWeeks} graded weeks in ${elapsed}ms`,
      );
      scored += 1;
    } catch (err) {
      console.error(`  [${leagueId}] THREW in ${Date.now() - start}ms:`, (err as Error).message);
      failed += 1;
    }
  }

  console.log(`[manager-ledger] done. scored=${scored} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[manager-ledger] unexpected error:", err);
  process.exit(1);
});
