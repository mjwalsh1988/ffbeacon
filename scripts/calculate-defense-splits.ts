/**
 * Rebuild the opponent-strength model (nfl_defense_vs_position).
 * Implementation lives in lib/calculate-defense-splits.ts.
 *
 * Run: npm run calculate:defense-splits
 *      npm run calculate:defense-splits -- --season 2025
 */

import { getServiceClient } from "./_supabase";
import { runCalculateDefenseSplits } from "../lib/calculate-defense-splits";

async function main() {
  const seasonArg = process.argv.indexOf("--season");
  const seasons =
    seasonArg !== -1 && process.argv[seasonArg + 1]
      ? [Number(process.argv[seasonArg + 1])]
      : undefined;

  const supabase = getServiceClient();
  console.log("Rebuilding defense vs position splits...");
  const result = await runCalculateDefenseSplits(supabase, { seasons });
  console.log(
    `Done. ${result.rowsWritten} rows across seasons ${result.seasons.join(", ")} in ${result.durationMs}ms.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
