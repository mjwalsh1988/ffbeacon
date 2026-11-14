/**
 * One-time backfill: the last full capture of every past-season league, which
 * freezes it (LPI-T02).
 *
 * Run:  npx tsx --env-file=.env.local scripts/backfill-league-final-capture.ts
 *       ... --dry-run          list what would run, touch nothing
 *       ... --limit 25         stop after this many leagues
 *       ... --concurrency 3    leagues at once (default 3; the Sleeper budget paces them)
 *
 * NEVER WIRE THIS INTO A CRON. A past-season league also gets this capture the
 * next time anyone opens it (lib/league-pulse.ts captureLeagueRawData). This
 * script exists because every capture stored before migration 0379 ran the old
 * transaction walk, which stopped after three empty weeks: on 2026-11-13 a
 * sampled 2024 league had moves in weeks 8 through 17 and none of them stored.
 * Without this run those leagues are repaired and frozen only if someone views
 * them.
 *
 * What it does per league is exactly pulseLeagueFootprint with force: the core
 * rows, then the capture set, which for a past season walks every transaction
 * week from week 0, refetches the whole matchup slate, takes every completed
 * draft, and stamps leagues.frozen_at only when all of it landed. A league
 * that fails stays unfrozen and is picked up by a re-run.
 *
 * Idempotent: it selects only past-season leagues with frozen_at null, and every
 * write is an upsert by natural key. A frozen league is never touched again.
 */

import { getServiceClient } from "./_supabase";
import { isPastSeason, pulseLeagueFootprint } from "../lib/league-pulse";
import { currentNflSeason, mapLimit } from "../lib/sleeper";
import { countSleeperCalls } from "../lib/sleeper-budget";
import { fetchAllRows } from "../lib/supabase/fetch-all";

function numberArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = numberArg("--limit", Number.POSITIVE_INFINITY);
  const concurrency = numberArg("--concurrency", 3);
  const supabase = getServiceClient();
  const current = Number(currentNflSeason());

  const rows = await fetchAllRows("past-season leagues", (from, to) =>
    supabase
      .from("leagues")
      .select("id, sleeper_league_id, season")
      .lt("season", current)
      .is("frozen_at", null)
      .order("season", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const targets = rows.filter((r) => isPastSeason(Number(r.season), current)).slice(0, limit);
  console.log(`${targets.length} past-season leagues to capture and freeze (current season ${current}).`);
  if (dryRun) {
    for (const r of targets) console.log(`  ${r.sleeper_league_id} (${r.season})`);
    return;
  }

  let frozen = 0;
  let failed = 0;
  let calls = 0;
  const started = Date.now();
  await mapLimit(targets, concurrency, async (row) => {
    try {
      const { result, calls: used } = await countSleeperCalls(() =>
        pulseLeagueFootprint(supabase, row.sleeper_league_id, { force: true }),
      );
      calls += used;
      if (result.ok) frozen += 1;
      else {
        failed += 1;
        console.warn(`  ${row.sleeper_league_id} (${row.season}): ${result.error}`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`  ${row.sleeper_league_id} (${row.season}) threw: ${(err as Error).message}`);
    }
    const done = frozen + failed;
    if (done % 25 === 0) console.log(`  ...${done}/${targets.length}`);
  });

  const { count } = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .not("frozen_at", "is", null);

  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s: ${frozen} captured, ${failed} failed, ${calls} Sleeper calls. ${count ?? "?"} leagues are frozen in total.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
