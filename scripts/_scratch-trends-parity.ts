/**
 * SCRATCH parity + timing harness for the Phase 1 date-bound change.
 * NOT part of the app or any cron. Does NOT write to the database.
 * Safe to delete after verification.
 *
 * Loads player_value_history two ways (full table vs 140-day bounded), runs the
 * exact same computeTrendRows() over each with a single shared nowMs, then
 * diffs the two output sets field-by-field to prove the date bound does not
 * change any written value. Also reports load timings.
 *
 * Run: npm run scratch:trends-parity
 */

import { getServiceClient } from "./_supabase";
import {
  loadAllHistory,
  computeTrendRows,
  HISTORY_LOOKBACK_DAYS,
  type TrendRow,
} from "../lib/calculate-trends";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function keyOf(r: TrendRow): string {
  return `${r.player_id}|${r.format_config_id}|${r.source}`;
}

async function main() {
  const supabase = getServiceClient();

  // Single shared anchor so windows + updated_at are identical across both runs.
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - HISTORY_LOOKBACK_DAYS * MS_PER_DAY).toISOString();

  console.log("Loading FULL history (old behavior)...");
  const tFullStart = Date.now();
  const fullRows = await loadAllHistory(supabase);
  const fullLoadMs = Date.now() - tFullStart;
  console.log(`  ${fullRows.length} rows in ${(fullLoadMs / 1000).toFixed(1)}s`);

  console.log(`Loading BOUNDED history (last ${HISTORY_LOOKBACK_DAYS} days)...`);
  const tBoundStart = Date.now();
  const boundedRows = await loadAllHistory(supabase, sinceIso);
  const boundLoadMs = Date.now() - tBoundStart;
  console.log(`  ${boundedRows.length} rows in ${(boundLoadMs / 1000).toFixed(1)}s`);

  // Tie-boundary completeness: the bounded compound-cursor load must return
  // EXACTLY the rows of the full load whose captured_at >= cutoff, with no
  // skipped or duplicated rows across the ~2000-row timestamp ties.
  const cutoffMs = new Date(sinceIso).getTime();
  const expectedBounded = fullRows.filter(
    (r) => new Date(r.captured_at).getTime() >= cutoffMs,
  );
  const boundedIds = new Set(boundedRows.map((r) => r.id));
  const expectedIds = new Set(expectedBounded.map((r) => r.id));
  const dupCount = boundedRows.length - boundedIds.size;
  let missingFromBounded = 0;
  for (const id of expectedIds) if (!boundedIds.has(id)) missingFromBounded += 1;
  let extraInBounded = 0;
  for (const id of boundedIds) if (!expectedIds.has(id)) extraInBounded += 1;

  console.log("\n==== TIE-BOUNDARY COMPLETENESS ====");
  console.log(`bounded rows:           ${boundedRows.length}`);
  console.log(`expected (full>=cutoff): ${expectedBounded.length}`);
  console.log(`duplicate ids in bounded: ${dupCount}`);
  console.log(`expected rows missing:    ${missingFromBounded}`);
  console.log(`unexpected extra rows:    ${extraInBounded}`);

  console.log("Computing trends for both row sets (shared nowMs)...");
  const a = computeTrendRows(fullRows, nowMs);
  const b = computeTrendRows(boundedRows, nowMs);

  const mapA = new Map(a.map((r) => [keyOf(r), r]));
  const mapB = new Map(b.map((r) => [keyOf(r), r]));

  const onlyInFull: string[] = [];
  const onlyInBounded: string[] = [];
  for (const k of mapA.keys()) if (!mapB.has(k)) onlyInFull.push(k);
  for (const k of mapB.keys()) if (!mapA.has(k)) onlyInBounded.push(k);

  const fields = Object.keys(a[0] ?? {}) as Array<keyof TrendRow>;
  let fieldMismatches = 0;
  const sampleMismatches: string[] = [];
  for (const [k, ra] of mapA) {
    const rb = mapB.get(k);
    if (!rb) continue;
    for (const f of fields) {
      if (ra[f] !== rb[f]) {
        fieldMismatches += 1;
        if (sampleMismatches.length < 20) {
          sampleMismatches.push(`${k} :: ${String(f)}  full=${String(ra[f])}  bounded=${String(rb[f])}`);
        }
      }
    }
  }

  console.log("\n==== PARITY RESULT ====");
  console.log(`full combos:    ${a.length}`);
  console.log(`bounded combos: ${b.length}`);
  console.log(`only in full:    ${onlyInFull.length}`);
  console.log(`only in bounded: ${onlyInBounded.length}`);
  console.log(`field mismatches on shared combos: ${fieldMismatches}`);
  if (sampleMismatches.length > 0) {
    console.log("sample mismatches:");
    for (const m of sampleMismatches) console.log(`  ${m}`);
  }
  if (onlyInFull.length > 0) {
    console.log("sample only-in-full keys (would no longer be re-written):");
    for (const k of onlyInFull.slice(0, 20)) {
      const r = mapA.get(k)!;
      console.log(`  ${k}  data_points_30d=${r.data_points_30d} change_30d=${String(r.change_30d)}`);
    }
  }

  console.log("\n==== TIMING ====");
  console.log(`full load:    ${(fullLoadMs / 1000).toFixed(1)}s  (${fullRows.length} rows)`);
  console.log(`bounded load: ${(boundLoadMs / 1000).toFixed(1)}s  (${boundedRows.length} rows)`);
  const speedup = boundLoadMs > 0 ? (fullLoadMs / boundLoadMs).toFixed(2) : "n/a";
  console.log(`load speedup: ${speedup}x`);

  const clean =
    onlyInFull.length === 0 &&
    onlyInBounded.length === 0 &&
    fieldMismatches === 0 &&
    dupCount === 0 &&
    missingFromBounded === 0 &&
    extraInBounded === 0;
  console.log(`\nPARITY: ${clean ? "IDENTICAL (PASS)" : "DIFFERENCES FOUND (review above)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
