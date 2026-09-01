/**
 * scripts/relay-run.ts
 *
 * CLI: run one League Relay tick by hand.
 *
 * THIS POSTS TO DISCORD. It is the same code path the cron runs, claims
 * included, so it cannot double-post anything the cron has already sent and
 * anything it sends the cron will not send again. Use `npm run relay:preview`
 * to read a writeup without sending it.
 *
 * Usage:
 *   npm run relay:run                       every active community league
 *   npm run relay:run -- --league=<uuid>    one league, by leagues.id
 *   npm run relay:run -- --dry              sync only, build and send nothing
 */

import { getServiceClient } from "./_supabase";
import { runLeagueRelay } from "../lib/league-relay/relay";

function flag(args: string[], name: string): string | null {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const supabase = getServiceClient();
  const dryRun = args.includes("--dry");

  console.log(`[relay-run] starting${dryRun ? " (dry run: nothing will be sent)" : ""}`);
  const startedAt = Date.now();

  const result = await runLeagueRelay(supabase, {
    leagueId: flag(args, "league") ?? undefined,
    dryRun,
  });

  console.log(`[relay-run] finished in ${Date.now() - startedAt}ms`);
  console.log(
    `  considered ${result.leaguesConsidered}, synced ${result.leaguesSynced}, posted ${result.posted}, skipped ${result.skipped}, errors ${result.errors}`,
  );
  for (const note of result.notes) console.log(`  ${note}`);

  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
