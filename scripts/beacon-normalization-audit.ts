/**
 * FF Beacon B1 normalization audit (real data, dynasty-ppr-sflex skill pool).
 *
 * Reports, per plan v3.1 section 4:
 *   1. Shape convergence  - KS distance source-vs-canonical, before vs after mapping
 *   2. Ranking fidelity   - Spearman(raw source ranking, blended ranking)
 *   3. Outlier guard      - inject a 10x glitch, confirm everyone else moves <1%
 *   4. Non-identity       - blended not byte-identical to any single source (50+ players)
 *
 * Reads the freshest snapshot per (player, source) via the same staleness-gated
 * gatherer the engine uses. Does NOT write to the database.
 *
 * Run: npm run beacon:audit
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconSettings, loadSignalWeights } from "../lib/beacon/settings";
import { gatherSourceValues, type ExternalSource } from "../lib/beacon/signals/source-value";
import { normalizeSlice, type SourcePlayerValue } from "../lib/beacon/normalize";

const AUDIT_FORMAT = "dynasty-ppr-sflex";
const SKILL = new Set(["QB", "RB", "WR", "TE"]);

function spearman(
  aByPlayer: Map<string, number>,
  bByPlayer: Map<string, number>,
): number {
  const shared = [...aByPlayer.keys()].filter((k) => bByPlayer.has(k));
  if (shared.length < 3) return NaN;
  const rank = (vals: Array<[string, number]>): Map<string, number> => {
    const sorted = [...vals].sort((x, y) => y[1] - x[1]); // desc
    const m = new Map<string, number>();
    sorted.forEach(([id], i) => m.set(id, i + 1));
    return m;
  };
  const ra = rank(shared.map((k) => [k, aByPlayer.get(k)!]));
  const rb = rank(shared.map((k) => [k, bByPlayer.get(k)!]));
  const n = shared.length;
  let sumA = 0, sumB = 0;
  for (const k of shared) { sumA += ra.get(k)!; sumB += rb.get(k)!; }
  const mA = sumA / n, mB = sumB / n;
  let cov = 0, va = 0, vb = 0;
  for (const k of shared) {
    const da = ra.get(k)! - mA;
    const db = rb.get(k)! - mB;
    cov += da * db; va += da * da; vb += db * db;
  }
  return cov / Math.sqrt(va * vb);
}

async function main() {
  const supabase = getServiceClient();
  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);
  const enabled = new Map<string, number>();
  for (const w of weights) {
    if (w.signalType === "source_value" && w.isEnabled && w.sourceSlug) enabled.set(w.sourceSlug, w.weight);
  }

  const { data: fmt } = await supabase
    .from("format_configs").select("id, slug").eq("slug", AUDIT_FORMAT).single();
  if (!fmt) throw new Error(`format ${AUDIT_FORMAT} not found`);

  const { data: srcRows } = await supabase
    .from("source_registry")
    .select("slug, update_cadence, supported_format_slugs, data_type, is_active")
    .eq("is_active", true);
  const sources: ExternalSource[] = (srcRows ?? [])
    .filter((s) => s.slug !== "ffbeacon" && Array.isArray(s.data_type) && s.data_type.includes("player_value_history"))
    .map((s) => ({ slug: s.slug, cadence: s.update_cadence, supportedFormatSlugs: s.supported_format_slugs }));

  const gather = await gatherSourceValues(supabase, {
    sources,
    ffbeaconFormats: [{ slug: fmt.slug, id: fmt.id }],
    staleDays: settings.staleDays,
    nowMs: Date.now(),
  });

  const bySourceAll = gather.byFormat.get(fmt.id) ?? new Map();
  const bySource = new Map<string, SourcePlayerValue[]>();
  const blendWeights = new Map<string, number>();
  for (const [slug, values] of bySourceAll) {
    if (!enabled.has(slug)) continue;
    const skill = values.filter((v: SourcePlayerValue) => SKILL.has(gather.positionByPlayer.get(v.playerId) ?? ""));
    if (skill.length === 0) continue;
    bySource.set(slug, skill);
    blendWeights.set(slug, enabled.get(slug)!);
  }

  console.log(`\nAudit format: ${AUDIT_FORMAT}  (minPlayersForQuantile=${settings.minPlayersForQuantile})`);
  console.log(`Sources in blend: ${[...bySource.keys()].map((s) => `${s}(${bySource.get(s)!.length})`).join(", ")}`);

  const band = { floor: 0, ceiling: 10000 };
  const norm = normalizeSlice({ bySource, weights: blendWeights, band, minPlayers: settings.minPlayersForQuantile });

  // 1. Shape convergence
  console.log("\n1) SHAPE CONVERGENCE (KS source-vs-canonical)");
  let convergenceOk = true;
  for (const a of norm.audits) {
    const improved = a.ksAfter <= a.ksBefore + 1e-9;
    if (a.qualified && !(a.ksAfter < 0.05)) convergenceOk = false;
    console.log(`   ${a.source.padEnd(15)} n=${String(a.n).padStart(4)} P99=${a.p99.toFixed(0).padStart(6)} qualified=${a.qualified}  KS before=${a.ksBefore.toFixed(4)}  after=${a.ksAfter.toFixed(4)}  ${improved ? "converged" : "WORSE"}`);
  }

  // blended map for fidelity + non-identity
  const blended = new Map<string, number>();
  for (const np of norm.players.values()) blended.set(np.playerId, np.value);

  // 2. Ranking fidelity
  console.log("\n2) RANKING FIDELITY (Spearman raw source vs blended)");
  let fidelityOk = true;
  for (const [slug, values] of bySource) {
    const raw = new Map(values.map((v) => [v.playerId, v.value]));
    const rho = spearman(raw, blended);
    if (!(rho > 0.9)) fidelityOk = false;
    console.log(`   ${slug.padEnd(15)} Spearman=${rho.toFixed(4)}`);
  }

  // 3. Outlier guard: 10x glitch into ktc top player
  console.log("\n3) OUTLIER GUARD (10x glitch, others must move <1%)");
  const glitchSource = [...bySource.keys()][0];
  const cloned = new Map<string, SourcePlayerValue[]>();
  for (const [slug, values] of bySource) cloned.set(slug, values.map((v) => ({ ...v })));
  const gv = cloned.get(glitchSource)!;
  let topIdx = 0;
  for (let i = 1; i < gv.length; i += 1) if (gv[i].value > gv[topIdx].value) topIdx = i;
  const glitchedPlayer = gv[topIdx].playerId;
  gv[topIdx] = { ...gv[topIdx], value: gv[topIdx].value * 10 };
  const norm2 = normalizeSlice({ bySource: cloned, weights: blendWeights, band, minPlayers: settings.minPlayersForQuantile });
  const blended2 = new Map<string, number>();
  for (const np of norm2.players.values()) blended2.set(np.playerId, np.value);
  let maxPct = 0;
  let movedOver = 0;
  for (const [id, before] of blended) {
    if (id === glitchedPlayer) continue;
    const after = blended2.get(id);
    if (after === undefined) continue;
    const denom = before === 0 ? 1 : Math.abs(before);
    const pct = Math.abs(after - before) / denom * 100;
    if (pct > maxPct) maxPct = pct;
    if (pct >= 1) movedOver += 1;
  }
  const outlierOk = maxPct < 1;
  console.log(`   glitched ${glitchSource} top player x10. Max move among others: ${maxPct.toFixed(4)}%  (players moving >=1%: ${movedOver})  ${outlierOk ? "PASS" : "FAIL"}`);

  // 4. Non-identity vs each single source (50+ shared players)
  console.log("\n4) NON-IDENTITY (blended != any single source, top 50)");
  let nonIdentityOk = true;
  const blendedRanking = [...blended.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const [slug, values] of bySource) {
    const srcRanking = [...values].sort((a, b) => b.value - a.value).map((v) => v.playerId);
    const top = Math.min(50, blendedRanking.length, srcRanking.length);
    let diffs = 0;
    for (let i = 0; i < top; i += 1) if (blendedRanking[i] !== srcRanking[i]) diffs += 1;
    // value identity check over shared players
    const raw = new Map(values.map((v) => [v.playerId, v.value]));
    let identicalValues = 0, shared = 0;
    for (const [id, bv] of blended) { const rv = raw.get(id); if (rv === undefined) continue; shared += 1; if (rv === bv) identicalValues += 1; }
    const identical = shared > 0 && identicalValues === shared;
    if (diffs === 0 || identical) nonIdentityOk = false;
    console.log(`   vs ${slug.padEnd(15)} top50 rank diffs=${diffs}  shared=${shared}  identical-value players=${identicalValues}  ${diffs > 0 && !identical ? "distinct" : "IDENTICAL"}`);
  }

  const allOk = convergenceOk && fidelityOk && outlierOk && nonIdentityOk;
  console.log(`\n==== NORMALIZATION AUDIT: ${allOk ? "ALL PASS" : "REVIEW"} ====`);
  console.log(`   convergence=${convergenceOk}  fidelity=${fidelityOk}  outlier=${outlierOk}  non-identity=${nonIdentityOk}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
