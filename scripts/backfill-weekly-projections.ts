/**
 * Sleeper weekly point-projection BACKFILL (one-time).
 *
 * The nightly sync (scripts/sync-weekly-projections.ts) only refreshes the
 * current season's upcoming weeks. To power "projected vs actual" comparisons on
 * the player profile we also need the projections Sleeper published for weeks
 * that have already been played in prior seasons. Sleeper's per-week projections
 * endpoint serves those historical rows (verified for 2024/2025), so this script
 * pulls whole past seasons and upserts them into player_weekly_projections.
 *
 * Reuses runWeeklyProjectionsSync per season (weeks 1-18), so storage, matching,
 * and the unique key are identical to the nightly path. Upserts on
 * (source, season_type, season, week, sleeper_player_id) make re-runs idempotent.
 *
 * ABSOLUTE RULE (per project instructions): backfill is a one-time operation.
 * NEVER wire this into the nightly cron.
 *
 * Run:
 *   npm run backfill:weekly-projections                    # last 2 completed seasons
 *   npm run backfill:weekly-projections -- --seasons 2023,2024,2025
 *   npm run backfill:weekly-projections -- --from-season 2022 --to-season 2025
 */

import { getServiceClient } from "./_supabase";
import { runWeeklyProjectionsSync, REGULAR_SEASON_LAST_WEEK } from "../lib/sync-weekly-projections";
import { currentNflSeason } from "../lib/sleeper";

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Resolve which seasons to backfill from CLI flags, defaulting to the two most
 *  recently completed seasons (the current season is still in progress / future). */
function resolveSeasons(): number[] {
  const explicit = argVal("--seasons");
  if (explicit) {
    return explicit
      .split(",")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }
  const from = argVal("--from-season");
  const to = argVal("--to-season");
  if (from && to) {
    const a = Number.parseInt(from, 10);
    const b = Number.parseInt(to, 10);
    const out: number[] = [];
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) out.push(y);
    return out;
  }
  const current = Number(currentNflSeason());
  return [current - 2, current - 1];
}

async function main() {
  const seasons = resolveSeasons();
  if (seasons.length === 0) {
    console.error("No seasons resolved to backfill.");
    process.exit(1);
  }

  const supabase = getServiceClient();
  console.log(`[backfill:weekly-projections] seasons: ${seasons.join(", ")}`);

  let grandTotal = 0;
  for (const season of seasons) {
    console.log(`\n=== ${season} (weeks 1-${REGULAR_SEASON_LAST_WEEK}) ===`);
    const result = await runWeeklyProjectionsSync(supabase, {
      season,
      fromWeek: 1,
      toWeek: REGULAR_SEASON_LAST_WEEK,
      seasonType: "regular",
    });
    grandTotal += result.totalStored;
    console.log(
      `   ${season}: stored ${result.totalStored} (matched ${result.matchedPlayers}, unmatched ${result.unmatchedPlayers})` +
        (result.skipped ? ` [skipped: ${result.reason}]` : ""),
    );
  }

  console.log(`\n[backfill:weekly-projections] done. Total stored: ${grandTotal}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
