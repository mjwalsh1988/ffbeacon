/**
 * Rewrite FF Beacon value history onto the calibrated scale.
 *
 * WHY THIS EXISTS
 * Calibrated normalization went live on 2026-08-01. Every FF Beacon row before
 * that was produced by the old canonical-curve method, which sat on a different
 * scale, so the two eras are not comparable. Trends compare today against 7, 30,
 * and 90 days ago, which meant the cutover rendered as a market crash: the
 * dynasty boards showed an average 7-day change of -45 to -53 percent, with 480
 * to 502 players down more than 20 percent, none of which happened.
 *
 * This puts the whole series on one scale instead of hiding the seam. For each
 * historical snapshot it recomputes what the calibrated base value would have
 * been, using the SAME stored reference the live engine now uses, and rescales
 * the published value by the ratio between the new and old base.
 *
 * WHY A RATIO RATHER THAN A FULL RECOMPUTE
 * published = clamp(base * factor) with manual overrides and rounding on top.
 * Every skill row already stores its own `base` and `factor` in metadata, so
 *
 *     new_value = old_value * (new_base / old_base)
 *
 * carries the recent-form factor, the manual overrides, the band clamp, and the
 * rounding through untouched. It also means the derived boards need no special
 * handling: a TE-premium value is baseline * (1 + boost), so applying the
 * baseline player's ratio keeps the derived board exactly consistent with its
 * baseline without recomputing a TE boost from stat profiles that have since
 * moved.
 *
 * WHAT IT DOES NOT TOUCH
 * K and DEF rows. They are normalized from a single synthetic stat source and
 * never went through calibration, so their history is already on one scale.
 *
 * SAFETY
 * Dry run by default; --write is required to change anything. Rewritten rows
 * carry metadata.recalibrated recording the original value and the ratio
 * applied, so the change is auditable per row.
 *
 * This used to also point at player_value_history_ffbeacon_pre_calibration
 * (migration 0161) as a restore path. That table was dropped by migration 0207
 * once the rewritten series had been reviewed: it shows no seam at the
 * 2026-08-01 boundary and has carried three weeks of nightly recomputes on top
 * of it. The remaining undo path is a point-in-time restore.
 *
 * Run:
 *   npm run backfill:beacon-calibrated -- --limit 3
 *   npm run backfill:beacon-calibrated -- --limit 3 --write
 *   npm run backfill:beacon-calibrated -- --write
 */

import { getServiceClient } from "./_supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../lib/database.types";
import { withRetry, chunkUpsert } from "../lib/supabase/retry";
import { loadBeaconSettings, loadSignalWeights } from "../lib/beacon/settings";
import { loadPositionByPlayer } from "../lib/beacon/signals/source-value";
import { calibrateSlice } from "../lib/beacon/calibrate";
import { loadActiveReferences } from "../lib/beacon/reference";
import { INHERITED_FORMATS } from "../lib/beacon/derived-formats";
import { gatherTeBoost } from "../lib/beacon/derive";
import { staleDaysFor, type StaleDays } from "../lib/beacon/freshness";
import type { SourcePlayerValue } from "../lib/beacon/normalize";

const SOURCE_SLUG = "ffbeacon";
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const PAGE = 1000;
const MS_PER_DAY = 86_400_000;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const WRITE = process.argv.includes("--write");

interface SourceRow {
  playerId: string;
  formatId: string;
  source: string;
  value: number;
  capturedMs: number;
}

interface BeaconRow {
  player_id: string;
  format_config_id: string;
  captured_at: string;
  value: number;
  formula_offset: number;
  metadata: Record<string, unknown>;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The value this row had BEFORE any backfill touched it.
 *
 * Rescaling reads the row's own value, so a naive rerun would apply the ratio a
 * second time and halve everything again. The first rewrite records
 * metadata.recalibrated.original_value, so reading through it here makes the
 * whole backfill idempotent: rerunning after a partial or failed pass converges
 * on the same answer instead of compounding.
 */
function originalValueOf(row: BeaconRow): number {
  const rc = row.metadata.recalibrated as { original_value?: unknown } | undefined;
  const prior = Number(rc?.original_value);
  return Number.isFinite(prior) ? prior : row.value;
}

function originalOffsetOf(row: BeaconRow): number {
  const rc = row.metadata.recalibrated as { original_offset?: unknown } | undefined;
  const prior = Number(rc?.original_offset);
  return Number.isFinite(prior) ? prior : row.formula_offset;
}

/**
 * Load every external source value for the formats we care about, once, across
 * the whole backfill window. 64 snapshots times 4 formats times 3 sources would
 * otherwise be ~770 round trips; this is ~175 and then every "as of" slice is
 * computed in memory.
 */
async function loadSourceWindow(
  supabase: SupabaseClient<Database>,
  formatIds: string[],
  sources: string[],
  sinceIso: string,
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  // One paged sweep per (format, source). That shape matches
  // idx_player_value_history_format_source_captured exactly, so each page is an
  // index range scan. A single combined query with an `in` on formats and a
  // keyset over (captured_at, id) cannot use that index and times out.
  for (const formatId of formatIds) {
    for (const source of sources) {
      for (let from = 0; ; from += PAGE) {
        const offset = from;
        const page = await withRetry(
          async () => {
            const { data, error } = await supabase
              .from("player_value_history")
              .select("player_id, value, captured_at")
              .eq("format_config_id", formatId)
              .eq("source", source)
              .gte("captured_at", sinceIso)
              .order("captured_at", { ascending: true })
              .range(offset, offset + PAGE - 1);
            if (error) throw error;
            return data ?? [];
          },
          { label: `source window ${source} page ${from}` },
        );
        for (const r of page) {
          rows.push({
            playerId: r.player_id,
            formatId,
            source,
            value: Number(r.value),
            capturedMs: new Date(r.captured_at).getTime(),
          });
        }
        if (page.length < PAGE) break;
      }
      process.stdout.write(`\r  loaded ${rows.length} source rows...`);
    }
  }
  process.stdout.write(`\r  loaded ${rows.length} source rows.        \n`);
  return rows;
}

/** Every FF Beacon row at one exact snapshot timestamp. */
async function loadBeaconSnapshot(
  supabase: SupabaseClient<Database>,
  capturedAt: string,
): Promise<BeaconRow[]> {
  const out: BeaconRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("player_value_history")
          .select("player_id, format_config_id, captured_at, value, formula_offset, metadata")
          .eq("source", SOURCE_SLUG)
          .eq("captured_at", capturedAt)
          // Ordering by player_id ALONE is not a total order here: a player has
          // one row per format at the same timestamp. Offset paging over a
          // partial order lets Postgres return a row on two pages and drop
          // another, which surfaces as "ON CONFLICT DO UPDATE command cannot
          // affect row a second time". (player_id, format_config_id) is unique
          // once source and captured_at are fixed, so it makes paging stable.
          .order("player_id", { ascending: true })
          .order("format_config_id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `beacon snapshot ${capturedAt} page ${from}` },
    );
    for (const r of page) {
      out.push({
        player_id: r.player_id,
        format_config_id: r.format_config_id,
        captured_at: r.captured_at,
        value: Number(r.value),
        formula_offset: Number(r.formula_offset ?? 0),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      });
    }
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * The source values a run at `asOfMs` would have seen: newest value per player
 * within that source's staleness window, looking only at data that existed then.
 * Mirrors latestFresh in lib/beacon/signals/source-value.ts.
 */
function sliceAsOf(
  index: Map<string, SourceRow[]>,
  formatId: string,
  source: string,
  asOfMs: number,
  cadence: string,
  staleDays: StaleDays,
): SourcePlayerValue[] {
  const rows = index.get(`${formatId}|${source}`);
  if (!rows) return [];
  const cutoffMs = asOfMs - staleDaysFor(cadence, staleDays) * MS_PER_DAY;
  const latest = new Map<string, { value: number; ts: number }>();
  for (const r of rows) {
    if (r.capturedMs > asOfMs || r.capturedMs < cutoffMs) continue;
    const prior = latest.get(r.playerId);
    if (!prior || r.capturedMs > prior.ts) latest.set(r.playerId, { value: r.value, ts: r.capturedMs });
  }
  return [...latest.entries()].map(([playerId, v]) => ({ playerId, value: v.value }));
}

async function main() {
  const supabase = getServiceClient();
  const limit = Number(argValue("--limit") ?? 0);
  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);
  const blend = new Map<string, number>();
  for (const w of weights) {
    if (w.signalType === "source_value" && w.isEnabled && w.sourceSlug) blend.set(w.sourceSlug, w.weight);
  }

  const { data: formatRows, error: fErr } = await supabase
    .from("format_configs").select("id, slug, te_premium_bonus");
  if (fErr) throw fErr;
  const idBySlug = new Map((formatRows ?? []).map((f) => [f.slug, f.id]));
  const slugById = new Map((formatRows ?? []).map((f) => [f.id, f.slug]));

  // Formats that normalize independently are exactly the ones holding an active
  // reference. Anything else is derived and rides its baseline's ratio.
  const { data: activeVersions, error: vErr } = await supabase
    .from("beacon_reference_versions")
    .select("format_config_id").eq("status", "active");
  if (vErr) throw vErr;
  const baseFormatIds = (activeVersions ?? []).map((v) => v.format_config_id);
  if (baseFormatIds.length === 0) throw new Error("No active calibration references. Build them first.");
  const references = await loadActiveReferences(supabase, baseFormatIds);

  // derived format id -> baseline format id
  const baselineOf = new Map<string, string>();
  for (const spec of INHERITED_FORMATS) {
    const d = idBySlug.get(spec.slug);
    const b = idBySlug.get(spec.baselineSlug);
    if (d && b) baselineOf.set(d, b);
  }

  const { data: srcRows, error: sErr } = await supabase
    .from("source_registry").select("slug, update_cadence").eq("is_active", true);
  if (sErr) throw sErr;
  const cadenceBySource = new Map((srcRows ?? []).map((s) => [s.slug, s.update_cadence]));

  const { data: bandRows, error: bErr } = await supabase
    .from("beacon_value_bands").select("position, format_config_id, floor, ceiling");
  if (bErr) throw bErr;
  const bandFor = (formatId: string) => {
    const exact = (bandRows ?? []).find((b) => b.position === "QB" && b.format_config_id === formatId);
    const global = (bandRows ?? []).find((b) => b.position === "QB" && b.format_config_id === null);
    const row = exact ?? global;
    return { floor: Number(row?.floor ?? 0), ceiling: Number(row?.ceiling ?? 10000) };
  };

  console.log(`Mode: ${WRITE ? "WRITE (rows will be rewritten)" : "DRY RUN (nothing will be written)"}`);
  console.log("Loading positions...");
  const positionByPlayer = await loadPositionByPlayer(supabase);

  // Per-TE boost for rebuilding the legacy dynasty-ppr-tep-sflex rows. Read from
  // today's stat profiles, which is an approximation for rows up to seven weeks
  // old; profiles are season aggregates and barely move in the off-season, and
  // the alternative is leaving a board with a known bug baked into its history.
  const numSetting = (key: string, fallback: number): number => {
    const v = settings.raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const legacyTepPremium = Number(
    (formatRows ?? []).find((f) => f.slug === "dynasty-ppr-tep-sflex")?.te_premium_bonus ?? 0,
  );
  const teBoost = legacyTepPremium > 0
    ? await gatherTeBoost(
        supabase,
        legacyTepPremium,
        numSetting("tep_value_sensitivity", 0.5),
        numSetting("tep_value_cap", 0.2),
        numSetting("tep_min_base_pts", 30),
      )
    : new Map<string, number>();

  // Distinct FF Beacon snapshot timestamps, oldest first.
  //
  // Walked one at a time with a keyset cursor rather than paged: there are only
  // ~64 of them across ~339k rows, so asking for "the next timestamp after this
  // one" is 64 tiny index-backed queries instead of 339 full pages.
  //
  // The unit is the exact timestamp, NOT the calendar day. Some days carry two
  // snapshots (the nightly cron plus a manual recompute), and the unique key is
  // (player_id, format_config_id, source, captured_at), so collapsing a day into
  // one bucket would silently drop half its rows.
  // Filtered to ONE base format so the walk rides
  // idx_player_value_history_format_source_captured. Filtering on source alone
  // has no supporting index and full-scans ~339k rows into a statement timeout.
  // Every base format carries all 64 snapshots (a run writes one captured_at
  // across every format), so one of them yields the complete set.
  const stampFormatId = baseFormatIds[0];
  let stamps: string[] = [];
  let stampCursor: string | null = null;
  for (;;) {
    let q = supabase
      .from("player_value_history")
      .select("captured_at")
      .eq("format_config_id", stampFormatId)
      .eq("source", SOURCE_SLUG)
      .order("captured_at", { ascending: true })
      .limit(1);
    if (stampCursor) q = q.gt("captured_at", stampCursor);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    stamps.push(data[0].captured_at);
    stampCursor = data[0].captured_at;
  }
  if (limit > 0) stamps = stamps.slice(-limit);
  console.log(`Snapshots to process: ${stamps.length} (${stamps[0]} .. ${stamps[stamps.length - 1]})`);

  const earliest = new Date(new Date(stamps[0]).getTime() - 14 * MS_PER_DAY).toISOString();
  console.log("Loading source window...");
  const sourceRows = await loadSourceWindow(supabase, baseFormatIds, [...blend.keys()], earliest);
  const index = new Map<string, SourceRow[]>();
  for (const r of sourceRows) {
    const key = `${r.formatId}|${r.source}`;
    const arr = index.get(key);
    if (arr) arr.push(r);
    else index.set(key, [r]);
  }

  let totalRewritten = 0;
  let totalUnchanged = 0;
  let totalSkippedNoRatio = 0;
  let totalKdefLeft = 0;
  let totalLegacyRederived = 0;
  const skipBreakdown = new Map<string, number>();
  const perSnapshot: Array<{ stamp: string; rows: number; meanOld: number; meanNew: number }> = [];

  for (const stamp of stamps) {
    const asOfMs = new Date(stamp).getTime();
    const beaconRows = await loadBeaconSnapshot(supabase, stamp);
    if (beaconRows.length === 0) continue;

    // ratio per (player, base format) for this snapshot
    const ratioByKey = new Map<string, number>();
    const newBaseByKey = new Map<string, number>();

    for (const formatId of baseFormatIds) {
      const ref = references.get(formatId);
      if (!ref) continue;
      const bySource = new Map<string, SourcePlayerValue[]>();
      for (const source of blend.keys()) {
        const cadence = cadenceBySource.get(source) ?? "daily";
        const vals = sliceAsOf(index, formatId, source, asOfMs, cadence, settings.staleDays)
          .filter((v) => SKILL_POSITIONS.has(positionByPlayer.get(v.playerId) ?? ""));
        if (vals.length > 0) bySource.set(source, vals);
      }
      if (bySource.size === 0) {
        console.warn(`  ${stamp} ${slugById.get(formatId)}: no source data as of this snapshot, skipped.`);
        continue;
      }
      const band = bandFor(formatId);
      const calibrated = calibrateSlice({
        bySource,
        weights: blend,
        band,
        minPlayers: settings.minPlayersForQuantile,
        reference: ref.values,
        gridPoints: settings.calibrationGridPoints,
      });
      for (const [playerId, p] of calibrated.players) {
        newBaseByKey.set(`${playerId}|${formatId}`, p.value);
      }
    }

    // Resolve ratios from the existing skill rows, which carry the old base.
    for (const row of beaconRows) {
      if (row.metadata.signal !== "source_value") continue;
      const key = `${row.player_id}|${row.format_config_id}`;
      const newBase = newBaseByKey.get(key);
      if (newBase === undefined) continue;
      const oldBase = Number(row.metadata.base ?? 0);
      if (Number.isFinite(oldBase) && oldBase > 0) {
        ratioByKey.set(key, newBase / oldBase);
      } else {
        // No usable old base (1,590 rows across the series). Fall back to
        // rebuilding the published value from the stored factor instead.
        const factor = Number(row.metadata.factor ?? 1);
        const band = bandFor(row.format_config_id);
        const rebuilt = clamp(newBase * (Number.isFinite(factor) ? factor : 1), band.floor, band.ceiling);
        ratioByKey.set(key, row.value > 0 ? rebuilt / row.value : 1);
      }
    }

    const updates: Array<{
      player_id: string; format_config_id: string; value: number; source: string;
      captured_at: string; formula_offset: number; metadata: Json;
    }> = [];
    let sumOld = 0;
    let sumNew = 0;
    // Baseline published values after rebasing, so a derived board can be
    // rebuilt from them rather than merely rescaled. Filled by the base-format
    // rows below, consumed by the legacy TEP rows after.
    const newPublishedByKey = new Map<string, number>();
    const newOffsetByKey = new Map<string, number>();
    const legacyRows: BeaconRow[] = [];

    for (const row of beaconRows) {
      const signal = row.metadata.signal;
      const position = positionByPlayer.get(row.player_id) ?? "";
      // K and DEF never went through calibration, so their history is already on
      // one scale and must not move. On a BASE board they carry signal
      // 'stat_value', but on a derived board the derive loop copies them across
      // and stamps them 'inherited' like everything else, so the signal alone
      // does not identify them. Gate on the position too, or ~1,600 K/DEF rows
      // per snapshot get miscounted as anomalies.
      if (signal === "stat_value" || position === "K" || position === "DEF") {
        totalKdefLeft += 1;
        continue;
      }

      const isDerived = signal === "inherited" || signal === "tep_derived";
      // Legacy dynasty-ppr-tep-sflex rows. Before migration 0158 that board was
      // computed from scratch against KTC alone, which is the Drake London bug:
      // every skill position drifted from its baseline with no tight end
      // involved. Those rows sit on a third scale that no ratio can rebase, so
      // they are rebuilt in the second pass the way the board is built now.
      //
      // The `note` test is what makes this idempotent. Rebuilding a legacy row
      // rewrites its signal from 'source_value' to 'inherited'/'tep_derived', so
      // on a rerun it would no longer look legacy, fall into the ratio path
      // below, and get the baseline's calibration ratio applied to a value that
      // never sat on the baseline's scale. That is a wrong number, not a no-op.
      // The note survives the rewrite, so a rebuilt row stays on this path.
      const rc = row.metadata.recalibrated as { note?: unknown } | undefined;
      const wasRebuiltFromBaseline = typeof rc?.note === "string";
      const isLegacyDerived =
        baselineOf.has(row.format_config_id) && (!isDerived || wasRebuiltFromBaseline);
      if (isLegacyDerived) {
        legacyRows.push(row);
        continue;
      }

      const ratioKey = isDerived
        ? `${row.player_id}|${baselineOf.get(row.format_config_id) ?? ""}`
        : `${row.player_id}|${row.format_config_id}`;
      const ratio = ratioByKey.get(ratioKey);
      if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) {
        totalSkippedNoRatio += 1;
        const key = `${slugById.get(row.format_config_id) ?? row.format_config_id} / ${String(signal)} / pos ${positionByPlayer.get(row.player_id) ?? "unknown"}`;
        skipBreakdown.set(key, (skipBreakdown.get(key) ?? 0) + 1);
        continue;
      }

      const band = bandFor(row.format_config_id);
      const baseValue = originalValueOf(row);
      const baseOffset = originalOffsetOf(row);
      const newValue = Math.round(clamp(baseValue * ratio, band.floor, band.ceiling));
      const newOffset = Math.round(baseOffset * ratio);
      if (!isDerived) {
        newPublishedByKey.set(`${row.player_id}|${row.format_config_id}`, newValue);
        newOffsetByKey.set(`${row.player_id}|${row.format_config_id}`, newOffset);
      }
      if (newValue === row.value) { totalUnchanged += 1; continue; }

      sumOld += baseValue;
      sumNew += newValue;
      updates.push({
        player_id: row.player_id,
        format_config_id: row.format_config_id,
        value: newValue,
        source: SOURCE_SLUG,
        captured_at: row.captured_at,
        formula_offset: newOffset,
        metadata: {
          ...row.metadata,
          recalibrated: {
            at: "2026-08-01",
            method: "calibrated",
            original_value: baseValue,
            original_offset: baseOffset,
            ratio: Number(ratio.toFixed(6)),
          },
        } as unknown as Json,
      });
    }

    // Second pass: rebuild the legacy TEP board from the rebased baseline,
    // exactly as lib/calculate-beacon-values.ts derives it today. Tight ends get
    // the per-TE boost; nobody else moves relative to the baseline. The row's
    // metadata is rewritten to the derived shape too, so the history stops
    // claiming it came from sources directly.
    for (const row of legacyRows) {
      const baselineId = baselineOf.get(row.format_config_id);
      const baselineKey = `${row.player_id}|${baselineId ?? ""}`;
      const baselineValue = newPublishedByKey.get(baselineKey);
      if (baselineValue === undefined) {
        totalSkippedNoRatio += 1;
        const key = `${slugById.get(row.format_config_id) ?? row.format_config_id} / legacy-tep / not on baseline board`;
        skipBreakdown.set(key, (skipBreakdown.get(key) ?? 0) + 1);
        continue;
      }
      const position = positionByPlayer.get(row.player_id) ?? "";
      const boost = position === "TE" ? (teBoost.get(row.player_id) ?? 0) : 0;
      const band = bandFor(row.format_config_id);
      const newValue = Math.round(clamp(baselineValue * (1 + boost), band.floor, band.ceiling));
      totalLegacyRederived += 1;
      if (newValue === row.value) { totalUnchanged += 1; continue; }

      sumOld += originalValueOf(row);
      sumNew += newValue;
      updates.push({
        player_id: row.player_id,
        format_config_id: row.format_config_id,
        value: newValue,
        source: SOURCE_SLUG,
        captured_at: row.captured_at,
        formula_offset: newOffsetByKey.get(baselineKey) ?? 0,
        metadata: {
          engine: "beacon-v1",
          run_id: row.metadata.run_id ?? null,
          signal: position === "TE" ? "tep_derived" : "inherited",
          inherited_from: slugById.get(baselineId ?? "") ?? null,
          baseline_value: baselineValue,
          placeholder: false,
          ...(position === "TE" ? { te_boost_pct: boost } : {}),
          recalibrated: {
            at: "2026-08-01",
            method: "calibrated",
            original_value: originalValueOf(row),
            note: "rebuilt from baseline; this row predates migration 0158 and was computed from scratch against KTC alone",
          },
        } as unknown as Json,
      });
    }

    if (updates.length > 0) {
      perSnapshot.push({
        stamp,
        rows: updates.length,
        meanOld: sumOld / updates.length,
        meanNew: sumNew / updates.length,
      });
      // Belt and braces after the paging bug above: Postgres rejects an upsert
      // whose payload names the same conflict key twice, so guarantee it cannot.
      const deduped = [...new Map(
        updates.map((u) => [`${u.player_id}|${u.format_config_id}`, u]),
      ).values()];
      if (deduped.length !== updates.length) {
        console.warn(`  ${stamp}: dropped ${updates.length - deduped.length} duplicate rows before upsert`);
      }
      if (WRITE) {
        await chunkUpsert(deduped, 500, async (chunk) => {
          await withRetry(
            async () => {
              const { error } = await supabase
                .from("player_value_history")
                .upsert(chunk, {
                  onConflict: "player_id,format_config_id,source,captured_at",
                  ignoreDuplicates: false,
                });
              if (error) throw error;
            },
            { label: `backfill upsert ${stamp}` },
          );
        });
      }
      totalRewritten += updates.length;
    }
    const pct =
      sumOld > 0 ? (((sumNew - sumOld) / sumOld) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${stamp}  rows ${String(updates.length).padStart(5)}  mean ${Math.round(sumOld / (updates.length || 1))} -> ${Math.round(sumNew / (updates.length || 1))}  (${pct}%)`,
    );
  }

  console.log("\n" + "=".repeat(70));
  console.log(`${WRITE ? "Rewritten" : "Would rewrite"}: ${totalRewritten} rows`);
  console.log(`Unchanged (ratio landed on the same integer): ${totalUnchanged}`);
  console.log(`K/DEF left alone: ${totalKdefLeft}`);
  console.log(`Legacy TEP rows rebuilt from baseline: ${totalLegacyRederived}`);
  console.log(`Skipped, no ratio available: ${totalSkippedNoRatio}`);
  if (skipBreakdown.size > 0) {
    console.log("  breakdown:");
    for (const [k, n] of [...skipBreakdown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`    ${String(n).padStart(6)}  ${k}`);
    }
  }
  console.log("=".repeat(70));
  if (!WRITE) console.log("DRY RUN. Nothing was written. Re-run with --write to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
