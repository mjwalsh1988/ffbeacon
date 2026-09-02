/**
 * Rebuild recency-weighted projection reliability (player_projection_accuracy).
 * Implementation lives in lib/calculate-projection-accuracy.ts.
 *
 * Run: npm run calculate:projection-accuracy
 */

import { getServiceClient } from "./_supabase";
import { runCalculateProjectionAccuracy } from "../lib/calculate-projection-accuracy";

async function main() {
  const supabase = getServiceClient();
  console.log("Rebuilding projection accuracy...");
  const result = await runCalculateProjectionAccuracy(supabase);
  console.log(
    `Done. ${result.rowsWritten} rows for ${result.playersScored} players (current season ${result.currentSeason}) in ${result.durationMs}ms.`,
  );
  for (const s of result.perSource) {
    const mae = s.meanAbsoluteError === null ? "n/a" : s.meanAbsoluteError.toFixed(2);
    const bias = s.meanError === null ? "n/a" : s.meanError.toFixed(2);
    console.log(`  ${s.source}: MAE ${mae}, bias ${bias}, ${s.weeksGraded} graded weeks (PPR)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
