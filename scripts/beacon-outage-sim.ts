/**
 * B3 total external-source outage simulation. Proves "degrades, doesn't die":
 * when every external source is stale, skill (source_value) drops out entirely
 * but K/DEF (stat_value) survive, because stat_value reads player_stats, not
 * KTC / FantasyCalc / DynastyProcess.
 *
 * Method: call the real source-value gatherer with nowMs 60 days in the FUTURE,
 * so every real snapshot is older than its staleness cutoff and the gate drops
 * it. Then compute stat_value normally. No DB writes. Run: npm run beacon:outage
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconSettings, loadSignalWeights, findWeight } from "../lib/beacon/settings";
import { gatherSourceValues, type ExternalSource } from "../lib/beacon/signals/source-value";
import { gatherStatValues } from "../lib/beacon/signals/stat-value";
import { mergeScoringConfig } from "../lib/beacon/scoring";

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const supabase = getServiceClient();
  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);

  const { data: ffRow } = await supabase
    .from("source_registry").select("supported_format_slugs").eq("slug", "ffbeacon").single();
  const { data: formats } = await supabase.from("format_configs").select("id, slug");
  const ffbeaconFormats = (formats ?? [])
    .filter((f) => (ffRow?.supported_format_slugs ?? []).includes(f.slug))
    .map((f) => ({ slug: f.slug, id: f.id }));

  const { data: srcRows } = await supabase
    .from("source_registry")
    .select("slug, update_cadence, supported_format_slugs, data_type, is_active")
    .eq("is_active", true);
  const sources: ExternalSource[] = (srcRows ?? [])
    .filter((s) => s.slug !== "ffbeacon" && Array.isArray(s.data_type) && s.data_type.includes("player_value_history"))
    .map((s) => ({ slug: s.slug, cadence: s.update_cadence, supportedFormatSlugs: s.supported_format_slugs }));

  // OUTAGE: anchor 60 days in the future so every real snapshot is stale.
  const outageNow = Date.now() + 60 * DAY;
  const gather = await gatherSourceValues(supabase, {
    sources,
    ffbeaconFormats,
    staleDays: settings.staleDays,
    nowMs: outageNow,
  });

  let totalSourceValues = 0;
  for (const m of gather.byFormat.values()) for (const v of m.values()) totalSourceValues += v.length;

  // stat_value is unaffected by the outage.
  const statWeightRow = findWeight(weights, "stat_value", null);
  const sv = await gatherStatValues(supabase, mergeScoringConfig(statWeightRow?.params));
  let kCount = 0, defCount = 0;
  for (const pid of sv.pointsByPlayer.keys()) {
    const pos = sv.positionByPlayer.get(pid);
    if (pos === "K") kCount += 1; else if (pos === "DEF") defCount += 1;
  }

  console.log("\nSimulated total external-source outage (all sources stale)");
  console.log("Source freshness under outage:");
  for (const f of gather.freshness) {
    console.log(`  ${f.source.padEnd(15)} dropped_for_staleness=${f.droppedForStaleness}  fresh=${f.fresh}  newest=${f.newestCapturedAt}`);
  }

  let pass = true;
  console.log("\nResult:");
  const skillAlive = totalSourceValues > 0;
  if (skillAlive) pass = false;
  console.log(`  source_value (skill) survivors: ${totalSourceValues}  -> skill board ${skillAlive ? "ALIVE (unexpected)" : "EMPTY (skill would be skipped)"}`);
  const kdefAlive = kCount > 0 && defCount > 0;
  if (!kdefAlive) pass = false;
  console.log(`  stat_value survivors: K=${kCount}, DEF=${defCount}  -> K/DEF board ${kdefAlive ? "ALIVE" : "DEAD (unexpected)"}`);

  const allDropped = gather.freshness.every((f) => f.droppedForStaleness);
  if (!allDropped) pass = false;
  console.log(`  all external sources dropped for staleness: ${allDropped}`);

  console.log(`\n==== OUTAGE SIM: ${pass ? "DEGRADED BOARD, NOT DEAD (PASS)" : "REVIEW"} ====`);
  console.log("  Interpretation: a total external outage leaves K/DEF (and any");
  console.log("  future stat-based values) standing; only the source-fed skill");
  console.log("  market goes empty. The engine skips, never writes 0/null.");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
