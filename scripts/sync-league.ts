/**
 * scripts/sync-league.ts
 *
 * CLI: sync one Sleeper league into FF Beacon's leagues + rosters +
 * league_users + league_transactions tables.
 *
 * Usage:
 *   npm run sync:league -- <sleeper_league_id>
 *   npm run sync:league -- <sleeper_league_id> --force
 *
 * Cache: skips network fetch if last_synced_at within 10 minutes unless --force.
 */

import { getServiceClient } from "./_supabase";
import { syncLeague } from "../lib/league-sync";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const leagueId = args.find((a) => !a.startsWith("--"));

  if (!leagueId) {
    console.error("Usage: npm run sync:league -- <sleeper_league_id> [--force]");
    process.exit(1);
  }

  const supabase = getServiceClient();
  console.log(
    `[sync-league] starting${force ? " (forced)" : ""} for sleeper_league_id=${leagueId}`,
  );
  const startedAt = Date.now();
  const result = await syncLeague(supabase, leagueId, { force });
  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    console.error(`[sync-league] FAILED in ${elapsedMs}ms: ${result.error}`);
    process.exit(1);
  }

  if (result.cached) {
    console.log(
      `[sync-league] cache hit in ${elapsedMs}ms (last_synced within 10m). league_id=${result.leagueRowId}`,
    );
  } else {
    console.log(`[sync-league] complete in ${elapsedMs}ms. league_id=${result.leagueRowId}`);
  }
  console.log(`[sync-league] counts: ${JSON.stringify(result.counts)}`);
}

main().catch((err) => {
  console.error("[sync-league] unexpected error:", err);
  process.exit(1);
});
