/**
 * Sleeper weekly stats historical backfill.
 *
 * Imports raw weekly player stats from Sleeper's (undocumented but stable)
 * stats endpoint into player_stats, for seasons 2016-2025, season types
 * regular + post + pre. Each stat lands in its own column via
 * lib/sleeper-stats-map.ts; the full raw payload (including opponent, team,
 * game_id, and the nested stat map) is preserved in player_stats.metadata.
 *
 *   GET https://api.sleeper.com/stats/nfl/{season}/{week}?season_type={type}
 *
 * (See lib/sleeper.ts getWeeklyStats: the .com host carries the per-game
 * opponent that the legacy .app/v1 endpoint omitted.)
 *
 * Player matching: Sleeper stats are keyed by Sleeper player_id, which we map
 * to our players.id via external_ids.sleeper. Entries with no match in our
 * players table cannot be stored (player_stats.player_id is a FK) and are
 * counted + sampled into a per-run unmatched log. Older seasons and preseason
 * weeks naturally match at a lower rate (retired players, camp rosters).
 *
 * Data integrity: counting columns default 0, rate/context columns (snap_pct,
 * off_snp, tm_off_snp, rec_tgt, target_share, pts_allow, yds_allow) are NULL
 * when Sleeper did not record them, never 0. snap_pct is derived NULL-safe from
 * off_snp / tm_off_snp. See lib/sleeper-stats-map.ts.
 *
 * Idempotent via the unique (player_id, week, season, season_type) constraint;
 * re-running refreshes values and adds no duplicate rows. ONE-TIME operation,
 * never wired into the nightly cron.
 *
 * Run:
 *   npm run backfill:sleeper-stats                 # all seasons 2016-2025
 *   npm run backfill:sleeper-stats -- --season 2024  # one season (QA)
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getServiceClient, withRetry, chunkUpsert } from "./_supabase";
import { getWeeklyStats, type SleeperSeasonType } from "../lib/sleeper";
import { mapStatPayloadToRow } from "../lib/sleeper-stats-map";
import { loadSleeperIdMap } from "../lib/sync-sleeper-stats";
import type { Database } from "../lib/database.types";

type StatInsert = Database["public"]["Tables"]["player_stats"]["Insert"];

const ALL_SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const SEASON_TYPES: SleeperSeasonType[] = ["regular", "post", "pre"];
const FETCH_CONCURRENCY = 4;
const UPSERT_BATCH_SIZE = 500;
const UNMATCHED_LOG_PATH = join(tmpdir(), "backfill-sleeper-stats-unmatched.json");

function weeksFor(seasonType: SleeperSeasonType, season: number): number[] {
  if (seasonType === "regular") {
    // 17-game schedule (18 weeks) began in 2021; earlier seasons stop at 17.
    const last = season >= 2021 ? 18 : 17;
    return Array.from({ length: last }, (_, i) => i + 1);
  }
  if (seasonType === "post") return [1, 2, 3, 4, 5];
  return [1, 2, 3, 4]; // pre
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type WeekResult = {
  entries: number;
  matched: number;
  unmatched: number;
  snapNonNull: number;
  unmatchedSample: string[];
};

async function main() {
  const args = process.argv.slice(2);
  const seasonIdx = args.indexOf("--season");
  const seasons =
    seasonIdx >= 0 ? [Number.parseInt(args[seasonIdx + 1] ?? "", 10)] : ALL_SEASONS;
  if (seasons.some((s) => !Number.isFinite(s))) {
    console.error("Invalid --season value. Use a 4-digit year.");
    process.exit(1);
  }

  const supabase = getServiceClient();

  // Load the Sleeper-id -> players.id map once (shared with the nightly sync).
  console.log("Loading player map...");
  const idBySleeper = await loadSleeperIdMap(supabase);
  console.log(`  ${idBySleeper.size} players carry a Sleeper id`);

  const unmatchedBySeason: Record<number, Set<string>> = {};
  let grandRows = 0;

  for (const season of seasons) {
    const tasks: Array<{ seasonType: SleeperSeasonType; week: number }> = [];
    for (const seasonType of SEASON_TYPES) {
      for (const week of weeksFor(seasonType, season)) tasks.push({ seasonType, week });
    }

    const results = await mapPool(tasks, FETCH_CONCURRENCY, async ({ seasonType, week }) => {
      const entries = await getWeeklyStats(seasonType, season, week);
      const res: WeekResult = {
        entries: entries.length,
        matched: 0,
        unmatched: 0,
        snapNonNull: 0,
        unmatchedSample: [],
      };
      if (entries.length === 0) return res;

      const rows: StatInsert[] = [];
      const now = new Date().toISOString();
      for (const { sleeperId, payload } of entries) {
        const playerId = idBySleeper.get(sleeperId);
        if (!playerId) {
          res.unmatched += 1;
          if (res.unmatchedSample.length < 25) res.unmatchedSample.push(sleeperId);
          continue;
        }
        const mapped = mapStatPayloadToRow(payload as Record<string, unknown>);
        if (mapped.snap_pct !== null) res.snapNonNull += 1;
        rows.push({
          player_id: playerId,
          week,
          season,
          season_type: seasonType,
          metadata: payload as Database["public"]["Tables"]["player_stats"]["Row"]["metadata"],
          updated_at: now,
          ...mapped,
        } as StatInsert);
      }
      res.matched = rows.length;

      await chunkUpsert(rows, UPSERT_BATCH_SIZE, async (chunk) => {
        await withRetry(
          async () => {
            const { error } = await supabase
              .from("player_stats")
              .upsert(chunk, {
                onConflict: "player_id,week,season,season_type",
                ignoreDuplicates: false,
              });
            if (error) throw error;
          },
          { label: `player_stats upsert ${season} ${seasonType} wk${week}` },
        );
      });
      return res;
    });

    // Aggregate the season's coverage.
    const agg = results.reduce(
      (a, r) => {
        a.entries += r.entries;
        a.matched += r.matched;
        a.unmatched += r.unmatched;
        a.snapNonNull += r.snapNonNull;
        return a;
      },
      { entries: 0, matched: 0, unmatched: 0, snapNonNull: 0 },
    );
    const seenUnmatched = new Set<string>();
    for (const r of results) for (const s of r.unmatchedSample) seenUnmatched.add(s);
    unmatchedBySeason[season] = seenUnmatched;
    grandRows += agg.matched;

    const matchPct = agg.entries ? ((agg.matched / agg.entries) * 100).toFixed(1) : "0.0";
    const snapPct = agg.matched ? ((agg.snapNonNull / agg.matched) * 100).toFixed(1) : "0.0";
    console.log(
      `${season}: entries=${agg.entries}, matched=${agg.matched} (${matchPct}%), ` +
        `unmatched=${agg.unmatched}, snap_pct non-null on ${agg.snapNonNull}/${agg.matched} rows (${snapPct}%)`,
    );
  }

  writeFileSync(
    UNMATCHED_LOG_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        seasons,
        unmatched_sample_by_season: Object.fromEntries(
          Object.entries(unmatchedBySeason).map(([s, set]) => [s, Array.from(set)]),
        ),
      },
      null,
      2,
    ),
  );

  console.log(`\nDone. Upserted ${grandRows} player_stats rows. Unmatched samples at ${UNMATCHED_LOG_PATH}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
