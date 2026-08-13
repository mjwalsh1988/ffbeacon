/**
 * Rebuild the Beacon Steals board.
 *
 * Run: npm run calculate:draft-value
 *      npm run calculate:draft-value -- --skip-room-adp
 *
 * Two stages, in order:
 *   1. draft_market_adp   our own rooms, aggregated from the pick ledger
 *   2. draft_value_targets the published board
 *
 * Stage 1 feeds stage 2 (as a confidence input), so they run in this order and
 * never in parallel. The nightly cron at /api/cron/rebuild-draft-value runs the
 * same two calls.
 */

import { getServiceClient } from "./_supabase";
import { runBuildRoomAdp } from "../lib/draft-value/room-adp";
import { runBuildDraftValue } from "../lib/draft-value/build";

async function main() {
  const skipRoomAdp = process.argv.includes("--skip-room-adp");
  const supabase = getServiceClient();

  if (skipRoomAdp) {
    console.log("Room ADP: skipped (--skip-room-adp)");
  } else {
    console.log("Stage 1: room ADP from the pick ledger");
    const room = await runBuildRoomAdp(supabase);
    console.log(
      `  ${room.rowsWritten} players across ${room.cohorts} cohorts from ${room.selectionsRead} picks in ${room.durationMs}ms`,
    );
  }

  console.log("Stage 2: the Beacon Steals board");
  const board = await runBuildDraftValue(supabase);
  console.log(
    `  ${board.rowsWritten} rows across ${board.formatsBuilt} formats for season ${board.season} (model ${board.modelVersion}) in ${board.durationMs}ms`,
  );
  for (const skip of board.formatsSkipped) {
    console.log(`  skipped ${skip.slug}: ${skip.reason}`);
  }

  // A run that built nothing is a failure, not a quiet success.
  if (board.formatsBuilt === 0) {
    throw new Error("No formats were built. The board would be stale or empty.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
