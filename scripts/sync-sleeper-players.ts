/**
 * Sleeper player sync, CLI entrypoint.
 *
 * Implementation lives in lib/sync-sleeper-players.ts so the same code path is
 * used by the Vercel cron endpoint (app/api/cron/sync-sleeper-players/route.ts).
 * Upserts every fantasy/IDP-relevant NFL player into the players table, and
 * with them the injury designations that Power Pulse, FAAB, Trade Ideas and the
 * schedule board all read.
 *
 * Run: npm run sync:players
 */

import { getServiceClient } from "./_supabase";
import { runSleeperPlayersSync } from "../lib/sync-sleeper-players";

async function main() {
  const supabase = getServiceClient();
  const result = await runSleeperPlayersSync(supabase);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
