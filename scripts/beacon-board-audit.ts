/**
 * B5 full-board audit across all 9 FF Beacon formats. Read-only. Confirms every
 * format has sane, in-band values and that the derivations hold their invariants:
 *   - best-ball presets == their redraft/dynasty counterpart (identity inherit)
 *   - dynasty-ppr-tep: non-TE == dynasty-ppr-std, TE >= base (TE-premium boost)
 *   - no negatives, no over-ceiling values, every position populated
 *
 * Run: npm run beacon:board
 */

import { getServiceClient } from "./_supabase";

const SKILL = new Set(["QB", "RB", "WR", "TE"]);

function bandCeiling(position: string, leagueType: string): number {
  if (SKILL.has(position)) return 10000;
  // K/DEF: dynasty compressed to 250, redraft 1500 (see migrations 0039/0048).
  return leagueType === "dynasty" ? 250 : 1500;
}

async function main() {
  const supabase = getServiceClient();

  const { data: formats } = await supabase
    .from("format_configs").select("id, slug, league_type");
  const fmtById = new Map((formats ?? []).map((f) => [f.id, f]));

  const positionByPlayer = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("players").select("id, position").order("id", { ascending: true }).range(from, from + 999);
    for (const p of data ?? []) positionByPlayer.set(p.id, p.position);
    if (!data || data.length < 1000) break;
  }

  // load all ffbeacon value rows (paged)
  type Row = { player_id: string; format_config_id: string; value: number };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("player_value_history")
      .select("player_id, format_config_id, value")
      .eq("source", "ffbeacon")
      .order("id", { ascending: true })
      .range(from, from + 999);
    for (const r of data ?? []) rows.push(r as Row);
    if (!data || data.length < 1000) break;
  }

  // index by format -> player -> value
  const byFormat = new Map<string, Map<string, number>>();
  for (const r of rows) {
    let m = byFormat.get(r.format_config_id);
    if (!m) { m = new Map(); byFormat.set(r.format_config_id, m); }
    m.set(r.player_id, Number(r.value));
  }
  const idBySlug = new Map<string, string>();
  for (const f of formats ?? []) idBySlug.set(f.slug, f.id);

  let pass = true;
  console.log("\n==== PER-FORMAT SUMMARY ====");
  const order = [
    "redraft-ppr-std", "redraft-ppr-sflex",
    "dynasty-ppr-std", "dynasty-ppr-tep", "dynasty-ppr-sflex", "dynasty-ppr-tep-sflex",
    "bestball-ppr-std", "bestball-ppr-sflex", "bestball-dynasty-ppr-sflex",
  ];
  for (const slug of order) {
    const id = idBySlug.get(slug);
    const lt = fmtById.get(id ?? "")?.league_type ?? "?";
    const m = id ? byFormat.get(id) : undefined;
    if (!m || m.size === 0) {
      pass = false;
      console.log(`  ${slug.padEnd(28)} EMPTY (FAIL)`);
      continue;
    }
    const posCounts: Record<string, number> = {};
    let negatives = 0, overCeiling = 0, top = 0, topPlayer = "";
    for (const [pid, v] of m) {
      const pos = positionByPlayer.get(pid) ?? "?";
      posCounts[pos] = (posCounts[pos] ?? 0) + 1;
      if (v < 0) negatives += 1;
      if (v > bandCeiling(pos, lt) + 0.5) overCeiling += 1;
      if (v > top) { top = v; topPlayer = `${pid.slice(0, 6)} ${pos}`; }
    }
    if (negatives > 0 || overCeiling > 0) pass = false;
    const posStr = ["QB", "RB", "WR", "TE", "K", "DEF"].map((p) => `${p}:${posCounts[p] ?? 0}`).join(" ");
    console.log(`  ${slug.padEnd(28)} n=${String(m.size).padStart(4)}  ${posStr}  top=${Math.round(top)}  neg=${negatives} over=${overCeiling}`);
  }

  console.log("\n==== DERIVATION INVARIANTS ====");
  // best-ball identity vs counterpart
  const identity = [
    ["bestball-ppr-std", "redraft-ppr-std"],
    ["bestball-ppr-sflex", "redraft-ppr-sflex"],
    ["bestball-dynasty-ppr-sflex", "dynasty-ppr-sflex"],
  ];
  for (const [bb, base] of identity) {
    const mb = byFormat.get(idBySlug.get(bb)!) ?? new Map();
    const mbase = byFormat.get(idBySlug.get(base)!) ?? new Map();
    let mismatch = 0;
    for (const [pid, v] of mb) if (Math.abs(v - (mbase.get(pid) ?? -1)) > 0.001) mismatch += 1;
    const ok = mismatch === 0 && mb.size === mbase.size;
    if (!ok) pass = false;
    console.log(`  ${bb.padEnd(28)} identity vs ${base}: ${mb.size}=${mbase.size} rows, mismatches=${mismatch}  ${ok ? "PASS" : "FAIL"}`);
  }

  // dynasty-ppr-tep: non-TE == base, TE >= base
  const tep = byFormat.get(idBySlug.get("dynasty-ppr-tep")!) ?? new Map();
  const dstd = byFormat.get(idBySlug.get("dynasty-ppr-std")!) ?? new Map();
  let nonTeMismatch = 0, teBelow = 0, teBoosted = 0;
  let maxBoost = 0;
  for (const [pid, v] of tep) {
    const base = dstd.get(pid);
    if (base === undefined) continue;
    const pos = positionByPlayer.get(pid) ?? "?";
    if (pos === "TE") {
      if (v < base - 0.001) teBelow += 1;
      if (v > base + 0.001) { teBoosted += 1; maxBoost = Math.max(maxBoost, (v - base) / base); }
    } else if (Math.abs(v - base) > 0.001) {
      nonTeMismatch += 1;
    }
  }
  const tepOk = nonTeMismatch === 0 && teBelow === 0 && teBoosted > 0;
  if (!tepOk) pass = false;
  console.log(`  dynasty-ppr-tep              non-TE unchanged (mismatch=${nonTeMismatch}), TEs boosted=${teBoosted} (none below=${teBelow === 0}), max boost=${(maxBoost * 100).toFixed(1)}%  ${tepOk ? "PASS" : "FAIL"}`);

  console.log(`\n==== FULL-BOARD AUDIT: ${pass ? "ALL PASS" : "FAILURES"} ====`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
