/**
 * FF Beacon value engine - CLI entrypoint.
 *
 * Implementation lives in lib/calculate-beacon-values.ts so the same code path
 * is used by the future cron endpoint. ffbeacon stays is_active=false; this only
 * populates player_value_history / draft_pick_values for the audit.
 *
 * Run: npm run calculate:beacon
 */

import { getServiceClient } from "./_supabase";
import { runCalculateBeaconValues } from "../lib/calculate-beacon-values";

async function main() {
  const supabase = getServiceClient();
  const res = await runCalculateBeaconValues(supabase);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
