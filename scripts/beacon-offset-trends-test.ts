/**
 * B2 offset-aware trend verification, using the PRODUCTION computeTrendRows()
 * (the exact function that writes player_value_trends). Synthetic rows with
 * 7-day bookends so the window is covered, proving:
 *   silent change  => market unchanged => change_7d 0, trend stable (NO chip)
 *   true-signal     => market moves    => change_7d != 0, trend up    (chip)
 *   external source => formula_offset 0 => behaves exactly as before (parity)
 *
 * Run: npm run beacon:offset-test
 */

import { computeTrendRows } from "../lib/calculate-trends";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 5, 13, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function row(
  player_id: string,
  source: string,
  value: number,
  formula_offset: number,
  tMs: number,
) {
  return {
    id: `${player_id}-${source}-${tMs}`,
    player_id,
    format_config_id: "F1",
    source,
    value,
    captured_at: iso(tMs),
    formula_offset,
  };
}

// Two ffbeacon players, each published 5000 -> 6000 across a 7-day window.
// silent: today's row carries offset 1000, so market stays 5000.
// true:   today's row carries offset 0, so market moves to 6000.
// Plus a ktc player (offset 0) to confirm external parity.
const rows = [
  row("silent", "ffbeacon", 5000, 0, now - 7 * DAY),
  row("silent", "ffbeacon", 6000, 1000, now),
  row("true", "ffbeacon", 5000, 0, now - 7 * DAY),
  row("true", "ffbeacon", 6000, 0, now),
  row("ext", "ktc", 5000, 0, now - 7 * DAY),
  row("ext", "ktc", 6000, 0, now),
];

const out = computeTrendRows(rows, now, new Map([["ffbeacon", 2], ["ktc", 2]]));
const byKey = new Map(out.map((r) => [`${r.player_id}|${r.source}`, r]));

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

const s = byKey.get("silent|ffbeacon")!;
const t = byKey.get("true|ffbeacon")!;
const e = byKey.get("ext|ktc")!;

console.log("\nSILENT change (formula-induced, must NOT show as movement) --------");
assert("current_value is published 6000", s.current_value === 6000, `got ${s.current_value}`);
assert("value_7d_ago is market 5000", s.value_7d_ago === 5000, `got ${String(s.value_7d_ago)}`);
assert("change_7d is 0 (market unchanged) -> NO chip", s.change_7d === 0, `got ${String(s.change_7d)}`);
assert("trend_7d is stable", s.trend_7d === "stable", `got ${String(s.trend_7d)}`);
assert("window is covered (bookends present)", s.show_trend_7d === true);

console.log("\nTRUE-SIGNAL change (real movement, must show as chip) ------------");
assert("current_value is published 6000", t.current_value === 6000, `got ${t.current_value}`);
assert("value_7d_ago is market 5000", t.value_7d_ago === 5000, `got ${String(t.value_7d_ago)}`);
assert("change_7d is +1000 (market moved) -> chip", t.change_7d === 1000, `got ${String(t.change_7d)}`);
assert("trend_7d is up", t.trend_7d === "up", `got ${String(t.trend_7d)}`);
assert("window is covered (bookends present)", t.show_trend_7d === true);

console.log("\nEXTERNAL parity (offset 0, unchanged behavior) -------------------");
assert("current_value 6000", e.current_value === 6000);
assert("change_7d +1000 (published == market when offset 0)", e.change_7d === 1000, `got ${String(e.change_7d)}`);

console.log("\nKEY CONTRAST: silent change_7d=" + String(s.change_7d) + " vs true change_7d=" + String(t.change_7d));
console.log(`\n==== OFFSET TRENDS: ${failed === 0 ? "ALL PASS" : "FAILURES"} (${passed} passed, ${failed} failed) ====`);
process.exit(failed === 0 ? 0 : 1);
