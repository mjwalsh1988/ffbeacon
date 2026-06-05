/**
 * scripts/pulse-league.ts
 *
 * CLI: pulse one Sleeper league into FF Beacon's leagues + rosters +
 * league_users + league_transactions tables.
 *
 * Usage:
 *   npm run pulse:league -- <sleeper_league_id>
 *   npm run pulse:league -- <sleeper_league_id> --force
 *
 * Cache: skips network fetch if last_pulsed_at within 10 minutes unless --force.
 */

import { getServiceClient } from "./_supabase";
import { pulseLeague } from "../lib/league-pulse";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const leagueId = args.find((a) => !a.startsWith("--"));

  if (!leagueId) {
    console.error("Usage: npm run pulse:league -- <sleeper_league_id> [--force]");
    process.exit(1);
  }

  const supabase = getServiceClient();
  console.log(
    `[pulse-league] starting${force ? " (forced)" : ""} for sleeper_league_id=${leagueId}`,
  );
  const startedAt = Date.now();
  const result = await pulseLeague(supabase, leagueId, { force });
  const elapsedMs = Date.now() - startedAt;

  if (!result.ok) {
    console.error(`[pulse-league] FAILED in ${elapsedMs}ms: ${result.error}`);
    process.exit(1);
  }

  if (result.cached) {
    console.log(
      `[pulse-league] cache hit in ${elapsedMs}ms (last_pulsed within 10m). league_id=${result.leagueRowId}`,
    );
  } else {
    console.log(`[pulse-league] complete in ${elapsedMs}ms. league_id=${result.leagueRowId}`);
  }
  console.log(`[pulse-league] counts: ${JSON.stringify(result.counts)}`);
}

main().catch((err) => {
  console.error("[pulse-league] unexpected error:", err);
  process.exit(1);
});
