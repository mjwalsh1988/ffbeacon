/**
 * FF Beacon B1 reliability tests (synthetic, deterministic, no DB).
 *
 * Proves the "degrades, doesn't die" floor behavior at the unit level:
 *   (a) a snapshot older than its cadence cutoff is excluded from the blend
 *   (b) a single surviving base signal produces a valid value (no empty-set /
 *       divide-by-zero)
 *   (c) an all-stale (player, format) is skipped (combine returns null), never
 *       written as 0/null
 *
 * Run: npm run beacon:tests
 */

import { isFresh, staleCutoffMs, FALLBACK_STALE_DAYS, MS_PER_DAY } from "../lib/beacon/freshness";
import { combine, weightedAverage } from "../lib/beacon/engine";
import type { ValueBand } from "../lib/beacon/types";

let passed = 0;
let failed = 0;
function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? "  (" + detail + ")" : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

const BAND: ValueBand = { floor: 0, ceiling: 10000 };
const nowMs = Date.UTC(2026, 5, 13, 12, 0, 0); // fixed anchor

console.log("\n(a) Staleness exclusion --------------------------------------");
{
  // Three sources' newest snapshot for one player/format. ktc + fc daily and
  // fresh; dynastyprocess daily but 9 days stale (cutoff is 3 days).
  const snapshots = [
    { source: "ktc", cadence: "daily", value: 9000, capturedAtMs: nowMs - 0.5 * MS_PER_DAY },
    { source: "fantasycalc", cadence: "daily", value: 8800, capturedAtMs: nowMs - 1 * MS_PER_DAY },
    { source: "dynastyprocess", cadence: "daily", value: 100, capturedAtMs: nowMs - 9 * MS_PER_DAY },
  ];
  const fresh = snapshots.filter((s) =>
    isFresh(s.capturedAtMs, s.cadence, nowMs, FALLBACK_STALE_DAYS),
  );
  const freshSlugs = fresh.map((s) => s.source).sort();
  assert(
    "stale daily source (9d old, cutoff 3d) excluded from the blend",
    !freshSlugs.includes("dynastyprocess") && freshSlugs.length === 2,
    `fresh = [${freshSlugs.join(", ")}]`,
  );
  const cutoff = staleCutoffMs("daily", nowMs, FALLBACK_STALE_DAYS);
  assert(
    "cutoff is exactly 3 days before now for a daily source",
    cutoff === nowMs - 3 * MS_PER_DAY,
  );
  // weekly tolerance is wider: a 9-day-old weekly snapshot is still fresh.
  assert(
    "same 9d-old snapshot is FRESH under weekly cadence (10d cutoff)",
    isFresh(nowMs - 9 * MS_PER_DAY, "weekly", nowMs, FALLBACK_STALE_DAYS),
  );
}

console.log("\n(b) Single surviving base signal ----------------------------");
{
  // After staleness removed all but one source, the blend has one base input.
  const wa = weightedAverage([{ value: 7321, weight: 1 }]);
  assert("weightedAverage of a single input returns that value exactly", wa === 7321, `got ${wa}`);

  const result = combine({
    baseInputs: [{ value: 7321, weight: 1 }],
    adjustInputs: [],
    overrides: [],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  });
  assert(
    "combine with one base signal yields a valid finite published value",
    result !== null && Number.isFinite(result.published) && result.published === 7321,
    result ? `published ${result.published}` : "null",
  );
  assert(
    "no divide-by-zero: weightedAverage with zero total weight returns null (not NaN)",
    weightedAverage([{ value: 5000, weight: 0 }]) === null,
  );
}

console.log("\n(c) All-stale (player, format) skipped, never 0/null --------");
{
  // Every source stale -> no base inputs survive -> combine returns null (skip).
  const result = combine({
    baseInputs: [],
    adjustInputs: [],
    overrides: [],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  });
  assert("combine with zero base inputs returns null (skip signal)", result === null);
  assert(
    "skip is null, NOT a 0 or any finite write",
    result === null && !(typeof result === "number"),
  );
  // An adjustment with no base must also skip (cannot adjust nothing).
  const adjOnly = combine({
    baseInputs: [],
    adjustInputs: [{ adjustmentPct: 0.1, weight: 1, confidence: 1 }],
    overrides: [],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  });
  assert("adjustment-only with no base also skips (null)", adjOnly === null);
}

console.log("\n(bonus) Silent vs true-signal offset ------------------------");
{
  // True-signal set_value moves the market (shows as movement).
  const trueSig = combine({
    baseInputs: [{ value: 5000, weight: 1 }],
    adjustInputs: [],
    overrides: [{ type: "set_value", magnitude: 6000, silent: false }],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  })!;
  assert(
    "true-signal set_value: published == market == 6000, offset 0 (shows as movement)",
    trueSig.published === 6000 && trueSig.market === 6000 && trueSig.formulaOffset === 0,
  );
  // Silent set_value moves published but keeps market at base (hidden from trends).
  const silent = combine({
    baseInputs: [{ value: 5000, weight: 1 }],
    adjustInputs: [],
    overrides: [{ type: "set_value", magnitude: 6000, silent: true }],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  })!;
  assert(
    "silent set_value: published 6000, market stays 5000, offset 1000 (hidden from trends)",
    silent.published === 6000 && silent.market === 5000 && silent.formulaOffset === 1000,
  );
}

console.log("\n(bonus) Factor clamp ----------------------------------------");
{
  const hot = combine({
    baseInputs: [{ value: 5000, weight: 1 }],
    adjustInputs: [{ adjustmentPct: 5, weight: 1, confidence: 1 }], // rawFactor 6
    overrides: [],
    band: BAND,
    factorMin: 0.5,
    factorMax: 1.5,
  })!;
  assert(
    "rawFactor 6 clamps to 1.5 and flags saturation",
    hot.factor === 1.5 && hot.factorSaturated && hot.published === 7500,
    `published ${hot.published}`,
  );
}

console.log(`\n==== RELIABILITY: ${failed === 0 ? "ALL PASS" : "FAILURES"} (${passed} passed, ${failed} failed) ====`);
process.exit(failed === 0 ? 0 : 1);
