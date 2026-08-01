/**
 * Read-only comparison of the two normalization methods on live source data.
 *
 * WRITES NOTHING. It gathers exactly the inputs runCalculateBeaconValues would
 * gather, runs both normalizeSlice (the current method) and calibrateSlice (the
 * new one, against the stored active reference), and reports how far the board
 * would move. No player_value_history row, ranking, trend, or setting is touched.
 *
 * This is the thing to run before changing normalization_method, and again after
 * any future reference rebuild that the drift job flags. Seeing the movement
 * before publishing it is the whole point.
 *
 * Run:
 *   npm run beacon:preview
 *   npm run beacon:preview -- --format dynasty-ppr-sflex
 *   npm run beacon:preview -- --examples 15
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconSettings, loadSignalWeights } from "../lib/beacon/settings";
import { gatherSourceValues, type ExternalSource } from "../lib/beacon/signals/source-value";
import { normalizeSlice, type NormalizedPlayer, type SourcePlayerValue } from "../lib/beacon/normalize";
import { calibrateSlice, buildSyntheticReference } from "../lib/beacon/calibrate";
import { loadActiveReferences, spearman } from "../lib/beacon/reference";
import { isDerivedFormat } from "../lib/beacon/derived-formats";

const SOURCE_SLUG = "ffbeacon";
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
/**
 * Resolved per format below from beacon_value_bands, the same way the engine
 * resolves it (the skill pool shares the QB band). Seeded here only so the pure
 * helpers have something before the DB read; every real comparison uses the
 * resolved band.
 */
let BAND = { floor: 1, ceiling: 10000 };

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Board = Map<string, NormalizedPlayer>;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Longest run of consecutive players sharing one rounded value. */
function longestFlatRun(board: Board): number {
  const values = [...board.values()].map((p) => Math.round(p.value)).sort((a, b) => b - a);
  let best = 0;
  let run = 0;
  for (let i = 0; i < values.length; i += 1) {
    run = i > 0 && values[i] === values[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Players whose within-source order the mapping reversed. Must always be 0. */
function orderingInversions(board: Board, bySource: Map<string, SourcePlayerValue[]>): number {
  let inversions = 0;
  for (const [source, values] of bySource) {
    const rows = values
      .map((v) => {
        const c = board.get(v.playerId)?.contributions.find((x) => x.source === source);
        return c ? { raw: v.value, mapped: c.mappedScaled } : null;
      })
      .filter((r): r is { raw: number; mapped: number } => r !== null)
      .sort((a, b) => a.raw - b.raw);
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].mapped < rows[i - 1].mapped - 1e-12) inversions += 1;
    }
  }
  return inversions;
}

/**
 * Players pinned to the very top or the very bottom of the band. Ties at the
 * ceiling matter for a rankings product: if the top three players all render as
 * 10,000 there is no visible number-one, however defensible the math is.
 */
function bandTies(board: Board): { atCeiling: number; atFloor: number } {
  let atCeiling = 0;
  let atFloor = 0;
  for (const p of board.values()) {
    if (Math.round(p.value) >= BAND.ceiling) atCeiling += 1;
    if (Math.round(p.value) <= BAND.floor) atFloor += 1;
  }
  return { atCeiling, atFloor };
}

function invalidValues(board: Board): number {
  let bad = 0;
  for (const p of board.values()) {
    if (!Number.isFinite(p.value) || p.value < BAND.floor || p.value > BAND.ceiling) bad += 1;
  }
  return bad;
}

function compare(before: Board, after: Board) {
  const ids = [...before.keys()].filter((id) => after.has(id));
  const moves = ids.map((id) => after.get(id)!.value - before.get(id)!.value);
  const abs = moves.map(Math.abs);
  const pct = ids.map((id) => {
    const b = before.get(id)!.value;
    return b > 0 ? Math.abs(after.get(id)!.value - b) / b : 0;
  });
  return {
    compared: ids.length,
    meanMove: moves.reduce((a, b) => a + b, 0) / (ids.length || 1),
    meanAbs: abs.reduce((a, b) => a + b, 0) / (ids.length || 1),
    medianMove: median(moves),
    over250: abs.filter((d) => d >= 250).length,
    over500: abs.filter((d) => d >= 500).length,
    over25pct: pct.filter((p) => p >= 0.25).length,
    maxMove: Math.max(0, ...abs),
    spearman: spearman(
      ids.map((id) => before.get(id)!.value),
      ids.map((id) => after.get(id)!.value),
    ),
    perPlayer: ids.map((id) => ({ id, delta: after.get(id)!.value - before.get(id)!.value })),
  };
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * The regression that proves the defect is gone: three synthetic sources that
 * agree perfectly and differ only in list length. Under the current method their
 * contributions for a shared player diverge; under calibration they do not.
 */
function listLengthRegression(): { legacySpread: number; calibratedSpread: number } {
  const curve = (i: number) => Math.round(10000 * Math.exp(-i / 120) + 5);
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ playerId: `p${String(i).padStart(4, "0")}`, value: curve(i) }));
  const bySource = new Map([
    ["a", make(400)],
    ["b", make(500)],
    ["c", make(650)],
  ]);
  const weights = new Map([["a", 1], ["b", 1], ["c", 1]]);
  const ref = buildSyntheticReference({ bySource, minShared: 100 })!;
  const legacy = normalizeSlice({ bySource, weights, band: BAND, minPlayers: 30 });
  const calibrated = calibrateSlice({
    bySource, weights, band: BAND, minPlayers: 30, reference: ref.values,
  });
  const spreadOf = (board: Board) => {
    let worst = 0;
    for (let rank = 20; rank < 400; rank += 1) {
      const c = board.get(`p${String(rank).padStart(4, "0")}`)!.contributions.map((x) => x.mappedScaled);
      worst = Math.max(worst, Math.max(...c) - Math.min(...c));
    }
    return worst;
  };
  return { legacySpread: spreadOf(legacy.players), calibratedSpread: spreadOf(calibrated.players) };
}

async function main() {
  const supabase = getServiceClient();
  const nowMs = Date.now();
  const onlyFormat = argValue("--format");
  const exampleCount = Number(argValue("--examples") ?? 10);

  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);
  const blend = new Map<string, number>();
  for (const w of weights) {
    if (w.signalType === "source_value" && w.isEnabled && w.sourceSlug) blend.set(w.sourceSlug, w.weight);
  }

  const { data: ffRow } = await supabase
    .from("source_registry").select("supported_format_slugs").eq("slug", SOURCE_SLUG).single();
  const ffSlugs = ffRow?.supported_format_slugs ?? [];
  const { data: formatRows } = await supabase.from("format_configs").select("id, slug, display_order");
  const formats = (formatRows ?? [])
    .filter((f) => ffSlugs.includes(f.slug))
    .filter((f) => !isDerivedFormat(f.slug))
    .filter((f) => !onlyFormat || f.slug === onlyFormat)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  // Same band resolution the engine uses: exact (position, format) row first,
  // then the global row for that position. The skill pool shares the QB band.
  const { data: bandRows } = await supabase
    .from("beacon_value_bands").select("position, format_config_id, floor, ceiling");
  const resolveBand = (formatId: string) => {
    const exact = (bandRows ?? []).find((b) => b.position === "QB" && b.format_config_id === formatId);
    const global = (bandRows ?? []).find((b) => b.position === "QB" && b.format_config_id === null);
    const row = exact ?? global;
    return { floor: Number(row?.floor ?? 0), ceiling: Number(row?.ceiling ?? 10000) };
  };

  const { data: srcRows } = await supabase
    .from("source_registry")
    .select("slug, update_cadence, supported_format_slugs, data_type")
    .eq("is_active", true).order("priority");
  const sources: ExternalSource[] = (srcRows ?? [])
    .filter((s) => s.slug !== SOURCE_SLUG && Array.isArray(s.data_type) && s.data_type.includes("player_value_history"))
    .map((s) => ({ slug: s.slug, cadence: s.update_cadence, supportedFormatSlugs: s.supported_format_slugs }));

  const gather = await gatherSourceValues(supabase, {
    sources,
    ffbeaconFormats: formats.map((f) => ({ slug: f.slug, id: f.id })),
    staleDays: settings.staleDays,
    nowMs,
  });
  const references = await loadActiveReferences(supabase, formats.map((f) => f.id));

  // Names for the example tables. One paged pass over the players we care about.
  const nameById = new Map<string, string>();
  const posById = gather.positionByPlayer;
  {
    const ids = new Set<string>();
    for (const m of gather.byFormat.values()) for (const vals of m.values()) for (const v of vals) ids.add(v.playerId);
    const list = [...ids];
    for (let i = 0; i < list.length; i += 200) {
      const { data } = await supabase.from("players").select("id, full_name").in("id", list.slice(i, i + 200));
      for (const r of data ?? []) nameById.set(r.id, r.full_name ?? r.id);
    }
  }
  const label = (id: string) => `${nameById.get(id) ?? id} (${posById.get(id) ?? "?"})`;

  console.log("=".repeat(78));
  console.log("FF Beacon normalization preview: current (quantile_median) vs calibrated");
  console.log("READ ONLY. Nothing below was written to the database.");
  console.log(`Live setting: normalization_method=${settings.normalizationMethod}, canary=[${settings.calibrationFormatSlugs.join(", ") || "empty"}]`);
  console.log("=".repeat(78));

  const reg = listLengthRegression();
  console.log("\nSYNTHETIC LIST-LENGTH REGRESSION (three sources, identical opinions, lengths 400/500/650)");
  console.log(`  worst cross-source contribution spread, current    : ${reg.legacySpread.toFixed(6)}`);
  console.log(`  worst cross-source contribution spread, calibrated : ${reg.calibratedSpread.toFixed(6)}`);
  console.log(`  verdict: ${reg.calibratedSpread < 1e-9 ? "PASS, list-length bias fully removed" : "FAIL, bias remains"}`);

  for (const f of formats) {
    const ref = references.get(f.id);
    const bySourceAll = gather.byFormat.get(f.id) ?? new Map<string, SourcePlayerValue[]>();
    const bySource = new Map<string, SourcePlayerValue[]>();
    for (const [slug, values] of bySourceAll) {
      if (!blend.has(slug)) continue;
      const skill = values.filter((v) => SKILL_POSITIONS.has(posById.get(v.playerId) ?? ""));
      if (skill.length > 0) bySource.set(slug, skill);
    }

    console.log("\n" + "-".repeat(78));
    console.log(`FORMAT ${f.slug}`);
    console.log("-".repeat(78));
    if (!ref) {
      console.log("  No active reference. Skipped.");
      continue;
    }
    BAND = resolveBand(f.id);
    console.log(`  reference v${ref.version}, ${ref.sharedPlayerCount} shared players, built ${ref.generatedAt}`);
    console.log(`  source pools: ${[...bySource].map(([s, v]) => `${s} ${v.length}`).join(", ")}`);
    console.log(`  band: ${BAND.floor} to ${BAND.ceiling}`);

    const current = normalizeSlice({ bySource, weights: blend, band: BAND, minPlayers: settings.minPlayersForQuantile });
    const calibrated = calibrateSlice({
      bySource, weights: blend, band: BAND,
      minPlayers: settings.minPlayersForQuantile,
      reference: ref.values, gridPoints: settings.calibrationGridPoints,
    });

    const c = compare(current.players, calibrated.players);
    console.log(`\n  BOARD SIZE      current ${current.players.size}, calibrated ${calibrated.players.size}, compared ${c.compared}`);
    console.log(`  MOVEMENT        mean ${fmt(c.meanMove)}, mean abs ${fmt(c.meanAbs)}, median ${fmt(c.medianMove)}, max abs ${fmt(c.maxMove)}`);
    console.log(`  THRESHOLDS      >=250: ${c.over250}, >=500: ${c.over500}, >=25%: ${c.over25pct}`);
    console.log(`  RANK CORRELATION spearman ${c.spearman.toFixed(4)}`);
    console.log(`  FLAT RUN        current ${longestFlatRun(current.players)}, calibrated ${longestFlatRun(calibrated.players)} (of ${calibrated.players.size})`);
    console.log(`  INVERSIONS      current ${orderingInversions(current.players, bySource)}, calibrated ${orderingInversions(calibrated.players, bySource)}`);
    console.log(`  INVALID VALUES  current ${invalidValues(current.players)}, calibrated ${invalidValues(calibrated.players)}`);
    const tiesCur = bandTies(current.players);
    const tiesCal = bandTies(calibrated.players);
    console.log(`  BAND TIES       at 10000: current ${tiesCur.atCeiling}, calibrated ${tiesCal.atCeiling}   |   at 0: current ${tiesCur.atFloor}, calibrated ${tiesCal.atFloor}`);

    const coverage = new Map<number, number>();
    for (const p of calibrated.players.values()) {
      const n = p.coverage ?? p.contributions.length;
      coverage.set(n, (coverage.get(n) ?? 0) + 1);
    }
    console.log(`  COVERAGE        ${[...coverage.entries()].sort((a, b) => b[0] - a[0]).map(([n, k]) => `${n} src: ${k}`).join(", ")}`);
    console.log(`  SINGLE SOURCE   ${[...calibrated.players.values()].filter((p) => p.lowConfidence).length}`);
    console.log("  PER SOURCE FIT");
    for (const a of calibrated.audits) {
      console.log(`    ${a.source.padEnd(15)} pool ${String(a.n).padStart(4)}, paired ${String(a.paired).padStart(4)}, fitted ${a.fitted}, below-range ${a.belowRange}, above-range ${a.aboveRange}`);
    }

    const sorted = [...c.perPlayer].sort((a, b) => b.delta - a.delta);
    console.log(`\n  LARGEST INCREASES`);
    for (const r of sorted.slice(0, exampleCount)) {
      console.log(`    ${label(r.id).padEnd(34)} ${fmt(current.players.get(r.id)!.value)} -> ${fmt(calibrated.players.get(r.id)!.value)}  (${r.delta >= 0 ? "+" : ""}${fmt(r.delta)})  [${calibrated.players.get(r.id)!.coverage} src]`);
    }
    console.log(`  LARGEST DECREASES`);
    for (const r of sorted.slice(-exampleCount).reverse()) {
      console.log(`    ${label(r.id).padEnd(34)} ${fmt(current.players.get(r.id)!.value)} -> ${fmt(calibrated.players.get(r.id)!.value)}  (${fmt(r.delta)})  [${calibrated.players.get(r.id)!.coverage} src]`);
    }

    // Named players to watch. These are the regression cases the validation
    // called out: a legitimate single-source redraft player who must NOT be
    // discounted, and deep single-source players whose old values were inflated.
    const watch = (argValue("--watch") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (watch.length > 0) {
      console.log(`  WATCHED PLAYERS`);
      for (const needle of watch) {
        const hits = [...calibrated.players.keys()].filter((id) =>
          (nameById.get(id) ?? "").toLowerCase().includes(needle.toLowerCase()),
        );
        if (hits.length === 0) {
          console.log(`    ${needle.padEnd(28)} not on this board`);
          continue;
        }
        for (const id of hits) {
          const cur = current.players.get(id)!;
          const cal = calibrated.players.get(id)!;
          const srcs = cal.contributions
            .map((x) => `${x.source}${x.inFittedRange === false ? "*" : ""}`)
            .join("+");
          console.log(
            `    ${label(id).padEnd(28)} ${fmt(cur.value)} -> ${fmt(cal.value)} (${cal.value - cur.value >= 0 ? "+" : ""}${fmt(cal.value - cur.value)})  [${cal.coverage} src: ${srcs}]${cal.lowConfidence ? " low-confidence" : ""}`,
          );
        }
      }
    }

    const top = [...calibrated.players.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 5);
    console.log(`  TOP OF BOARD (calibrated)`);
    for (const [id, p] of top) {
      console.log(`    ${label(id).padEnd(34)} ${fmt(p.value)}  (was ${fmt(current.players.get(id)!.value)})`);
    }

    // ---- Source dropout, preview only. The stored reference never changes. ----
    console.log(`\n  SOURCE DROPOUT (calibrated board vs its own all-sources board)`);
    for (const dropped of [...bySource.keys()]) {
      const remaining = new Map(bySource);
      remaining.delete(dropped);
      if (remaining.size === 0) continue;
      const calOut = calibrateSlice({
        bySource: remaining, weights: blend, band: BAND,
        minPlayers: settings.minPlayersForQuantile,
        reference: ref.values, gridPoints: settings.calibrationGridPoints,
      });
      const curOut = normalizeSlice({ bySource: remaining, weights: blend, band: BAND, minPlayers: settings.minPlayersForQuantile });
      const calMove = compare(calibrated.players, calOut.players);
      const curMove = compare(current.players, curOut.players);
      console.log(
        `    drop ${dropped.padEnd(15)} calibrated mean abs ${fmt(calMove.meanAbs).padStart(6)}, max ${fmt(calMove.maxMove).padStart(6)}, board ${calOut.players.size}` +
        `   |   current mean abs ${fmt(curMove.meanAbs).padStart(6)}, max ${fmt(curMove.maxMove).padStart(6)}`,
      );
    }

    // Source returning: rerun with the full set and confirm we land exactly back.
    const restored = calibrateSlice({
      bySource, weights: blend, band: BAND,
      minPlayers: settings.minPlayersForQuantile,
      reference: ref.values, gridPoints: settings.calibrationGridPoints,
    });
    const back = compare(calibrated.players, restored.players);
    console.log(`    source returns  mean abs ${back.meanAbs.toFixed(6)}, spearman ${back.spearman.toFixed(6)} (0 and 1 = no hysteresis)`);
  }

  console.log("\n" + "=".repeat(78));
  console.log("Preview complete. No database writes were performed.");
  console.log("=".repeat(78));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
