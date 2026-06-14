/**
 * FF Beacon value engine orchestrator (library form), matching the
 * lib/sync-*.ts / lib/calculate-trends.ts shape so the CLI script and the future
 * cron endpoint share one code path. Plan v3.1 Phase B1.
 *
 * Flow:
 *   1. Mint a run (beacon_value_runs) -> run_id (never null, never reused).
 *   2. Load tunables LIVE from beacon_settings / beacon_signal_weights / bands.
 *   3. Gather external source values (self-excluded, staleness-gated) + manuals.
 *   4. Per format: normalize the skill pool, combine signals, build rows.
 *      All-stale / no-base (player, format) is SKIPPED, never written 0/null.
 *   5. Copy KTC-baselined picks as source='ffbeacon'.
 *   6. Write player_value_history + draft_pick_values; finalize the run with
 *      source_freshness, skipped_no_signal, factor_saturated for observability.
 *
 * is_active on the ffbeacon registry row stays false; this only populates data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { withRetry, chunkUpsert } from "./supabase/retry";
import { loadBeaconSettings, loadSignalWeights, findWeight } from "./beacon/settings";
import { gatherSourceValues, type ExternalSource } from "./beacon/signals/source-value";
import { gatherStatValues } from "./beacon/signals/stat-value";
import { mergeScoringConfig } from "./beacon/scoring";
import { materializeStatProfiles } from "./beacon/stat-profiles";
import { gatherStatPerformance, mergePerfConfig, type PerfAdjustment } from "./beacon/signals/stat-performance";
import { gatherAiAdjustments, type AiCandidate, type AiResult } from "./beacon/signals/ai-adjust";
import { gatherTeBoost } from "./beacon/derive";
import { loadManualSignals, overridesFor } from "./beacon/signals/manual";
import { normalizeSlice, type SourcePlayerValue } from "./beacon/normalize";
import { combine } from "./beacon/engine";
import type { ValueBand } from "./beacon/types";

const SOURCE_SLUG = "ffbeacon";
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export interface CalculateBeaconResult {
  ok: boolean;
  runId: string;
  playersProcessed: number;
  rowsWritten: number;
  skippedNoSignal: number;
  factorSaturated: number;
  pickRows: number;
  statProfiles: number;
  perfAdjusted: number;
  aiCalls: number;
  aiAdjusted: number;
  perFormat: Array<{ slug: string; rows: number; skipped: number }>;
  freshness: unknown[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export async function runCalculateBeaconValues(
  supabase: SupabaseClient<Database>,
): Promise<CalculateBeaconResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const capturedAt = startedAt; // one snapshot timestamp for the whole run

  // 1. Load tunables LIVE (no hardcoded operational constants).
  const settings = await loadBeaconSettings(supabase);
  const weights = await loadSignalWeights(supabase);

  // 2. Mint the run row -> run_id.
  const weightsSnapshot: Json = {
    settings: settings.raw as Json,
    signal_weights: weights as unknown as Json,
  };
  const runId = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("beacon_value_runs")
        .insert({ status: "running", weights_snapshot: weightsSnapshot })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    { label: "beacon_value_runs insert" },
  );

  try {
    // 3. Formats ffbeacon supports + their ids.
    const { data: ffRow, error: ffErr } = await supabase
      .from("source_registry")
      .select("supported_format_slugs")
      .eq("slug", SOURCE_SLUG)
      .single();
    if (ffErr) throw ffErr;
    const ffSlugs = ffRow.supported_format_slugs ?? [];

    const { data: formats, error: fErr } = await supabase
      .from("format_configs")
      .select("id, slug, league_type, te_premium_bonus");
    if (fErr) throw fErr;
    const ffbeaconFormats = (formats ?? [])
      .filter((f) => ffSlugs.includes(f.slug))
      .map((f) => ({
        slug: f.slug,
        id: f.id,
        leagueType: f.league_type,
        tePremium: Number(f.te_premium_bonus ?? 0),
      }));
    const formatById = new Map(ffbeaconFormats.map((f) => [f.id, f]));
    const fmtBySlug = new Map(ffbeaconFormats.map((f) => [f.slug, f]));

    // External active value sources (self-excluded).
    const { data: srcRows, error: sErr } = await supabase
      .from("source_registry")
      .select("slug, update_cadence, supported_format_slugs, data_type")
      .eq("is_active", true)
      .order("priority");
    if (sErr) throw sErr;
    const sources: ExternalSource[] = (srcRows ?? [])
      .filter(
        (s) =>
          s.slug !== SOURCE_SLUG &&
          Array.isArray(s.data_type) &&
          s.data_type.includes("player_value_history"),
      )
      .map((s) => ({
        slug: s.slug,
        cadence: s.update_cadence,
        supportedFormatSlugs: s.supported_format_slugs,
      }));

    // Enabled source_value weights.
    const enabledSourceWeights = new Map<string, number>();
    for (const w of weights) {
      if (w.signalType === "source_value" && w.isEnabled && w.sourceSlug) {
        enabledSourceWeights.set(w.sourceSlug, w.weight);
      }
    }

    // Position value bands (resolver).
    const { data: bandRows, error: bErr } = await supabase
      .from("beacon_value_bands")
      .select("position, format_config_id, floor, ceiling");
    if (bErr) throw bErr;
    const bandResolve = (position: string, formatId: string): ValueBand => {
      const exact = (bandRows ?? []).find(
        (b) => b.position === position && b.format_config_id === formatId,
      );
      const global = (bandRows ?? []).find(
        (b) => b.position === position && b.format_config_id === null,
      );
      const row = exact ?? global;
      return { floor: Number(row?.floor ?? 0), ceiling: Number(row?.ceiling ?? 10000) };
    };

    // 4. Gather inputs.
    const gather = await gatherSourceValues(supabase, {
      sources,
      ffbeaconFormats: ffbeaconFormats.map((f) => ({ slug: f.slug, id: f.id })),
      staleDays: settings.staleDays,
      nowMs: started,
    });
    const manuals = await loadManualSignals(supabase, started);

    // 5. Per format: normalize the skill pool, combine, build rows.
    type HistoryRow = {
      player_id: string;
      format_config_id: string;
      value: number;
      source: string;
      captured_at: string;
      formula_offset: number;
      metadata: Json;
    };
    const historyRows: HistoryRow[] = [];
    let skippedNoSignal = 0;
    let factorSaturated = 0;
    const perFormat: CalculateBeaconResult["perFormat"] = [];
    const processedPlayers = new Set<string>();

    // Nightly materialization of the scoring-invariant stat profiles. Runs first
    // so stat_performance (and future custom-format compute) read fresh profiles.
    const profileResult = await materializeStatProfiles(supabase);

    // stat_value (B3: K/DEF only). Computed once, reused across formats, and
    // independent of external sources, so K/DEF survive a total external outage.
    const statWeightRow = findWeight(weights, "stat_value", null);
    const statValueEnabled = statWeightRow?.isEnabled ?? false;
    const statWeight = statWeightRow?.weight ?? 1;
    const kPoints = new Map<string, number>();
    const defPoints = new Map<string, number>();
    let statSeasons: number[] = [];
    if (statValueEnabled) {
      const sv = await gatherStatValues(supabase, mergeScoringConfig(statWeightRow?.params));
      statSeasons = sv.seasonsUsed;
      for (const [pid, score] of sv.pointsByPlayer) {
        const pos = sv.positionByPlayer.get(pid);
        if (pos === "K") kPoints.set(pid, score);
        else if (pos === "DEF") defPoints.set(pid, score);
      }
    }

    // stat_performance (B4): a small, bounded recent-form adjustment for skill
    // players, layered on the source_value base. Reads the profiles just
    // materialized. Disabled -> empty map -> no adjustment anywhere.
    const perfWeightRow = findWeight(weights, "stat_performance", null);
    const perfEnabled = perfWeightRow?.isEnabled ?? false;
    const perfWeight = perfWeightRow?.weight ?? 1;
    let perfByPlayer = new Map<string, PerfAdjustment>();
    if (perfEnabled) {
      perfByPlayer = await gatherStatPerformance(supabase, mergePerfConfig(perfWeightRow?.params));
    }

    // ai_adjust (B7): an optional, bounded per-player nudge from an Anthropic
    // model, layered alongside stat_performance. OFF unless all three hold:
    // master ai_enabled, the ai_adjust weight is_enabled, and an API key is set.
    // Candidates are gated (contested across sources OR a sharp recent-form
    // move), capped at ai_max_calls, and cached so unchanged inputs never rebill.
    // Built from the flagship dynasty-ppr-sflex skill slice; the resulting nudge
    // is applied per-player across every format's skill board.
    const aiWeightRow = findWeight(weights, "ai_adjust", null);
    const aiEnabled =
      settings.aiEnabled && (aiWeightRow?.isEnabled ?? false) && Boolean(process.env.ANTHROPIC_API_KEY);
    const aiWeight = aiWeightRow?.weight ?? 1;
    let aiResultByPlayer = new Map<string, AiResult>();
    let aiCalls = 0;
    if (aiEnabled) {
      const flagship = fmtBySlug.get("dynasty-ppr-sflex");
      const flagshipBySource = flagship ? gather.byFormat.get(flagship.id) : undefined;
      if (flagship && flagshipBySource && flagshipBySource.size > 0) {
        const bySource = new Map<string, SourcePlayerValue[]>();
        const blendWeights = new Map<string, number>();
        for (const [slug, values] of flagshipBySource) {
          const w = enabledSourceWeights.get(slug);
          if (w === undefined) continue;
          const skillValues = values.filter((v) =>
            SKILL_POSITIONS.has(gather.positionByPlayer.get(v.playerId) ?? ""),
          );
          if (skillValues.length === 0) continue;
          bySource.set(slug, skillValues);
          blendWeights.set(slug, w);
        }
        if (bySource.size > 0) {
          const poolBand = bandResolve("QB", flagship.id);
          const norm = normalizeSlice({
            bySource,
            weights: blendWeights,
            band: poolBand,
            minPlayers: settings.minPlayersForQuantile,
          });
          // Gate + rank candidates by contestedness so a capped run spends its
          // live calls on the players where the engine most wants a second look.
          const ranked: Array<{
            playerId: string;
            position: string;
            consensusValue: number;
            perSource: Array<{ source: string; value: number }>;
            spread: number;
            perfPct: number;
            priority: number;
          }> = [];
          for (const np of norm.players.values()) {
            const mapped = np.contributions.map((c) => c.mappedScaled);
            const spread = mapped.length >= 2 ? Math.max(...mapped) - Math.min(...mapped) : 0;
            const perf = perfByPlayer.get(np.playerId);
            const perfPct = perf ? perf.adjustmentPct : 0;
            const mover = Math.abs(perfPct);
            if (spread < settings.aiMinSpread && mover < settings.aiMinMover) continue;
            ranked.push({
              playerId: np.playerId,
              position: gather.positionByPlayer.get(np.playerId) ?? "WR",
              consensusValue: Math.round(np.value),
              perSource: np.contributions.map((c) => ({ source: c.source, value: Math.round(c.rawValue) })),
              spread: Number(spread.toFixed(4)),
              perfPct: Number(perfPct.toFixed(4)),
              priority: spread + mover,
            });
          }
          ranked.sort((a, b) => b.priority - a.priority);

          if (ranked.length > 0) {
            // Names for the payload (one query, paged-safe via .in chunks).
            const nameById = new Map<string, string>();
            const ids = ranked.map((r) => r.playerId);
            for (let i = 0; i < ids.length; i += 200) {
              const slice = ids.slice(i, i + 200);
              const { data: nameRows, error: nErr } = await supabase
                .from("players")
                .select("id, full_name")
                .in("id", slice);
              if (nErr) throw nErr;
              for (const r of nameRows ?? []) nameById.set(r.id, r.full_name ?? "");
            }
            const candidates: AiCandidate[] = ranked.map((r) => ({
              playerId: r.playerId,
              payload: {
                name: nameById.get(r.playerId) ?? "",
                position: r.position,
                consensus_value: r.consensusValue,
                per_source_values: r.perSource,
                source_spread: r.spread,
                perf_adjustment_pct: r.perfPct,
              },
            }));
            const gathered = await gatherAiAdjustments(supabase, candidates, {
              model: settings.aiModel,
              bound: settings.aiAdjustmentBound,
              systemPrompt: settings.aiSystemPrompt,
              maxCalls: settings.aiMaxCalls,
            });
            aiResultByPlayer = gathered.map;
            aiCalls = gathered.calls;
          }
        }
      }
    }

    // Shared per-player emit: resolve band, apply manual overrides, combine,
    // build the metadata breakdown, push the row. Returns "skip" when no base
    // signal survived (floor safety) so the caller counts it without writing.
    const emitRow = (
      playerId: string,
      position: string,
      fmt: { slug: string; id: string },
      base: number,
      scaled: number,
      degraded: boolean,
      signal: string,
      contributions: Json,
      extraMeta: Record<string, Json>,
      adjustInputs: Array<{ adjustmentPct: number; weight: number; confidence: number }> = [],
    ): "write" | "skip" => {
      const band = bandResolve(position, fmt.id);
      const overrides = overridesFor(manuals, playerId, fmt.id, started);
      const result = combine({
        baseInputs: [{ value: base, weight: 1 }],
        adjustInputs,
        overrides: overrides.map((o) => ({ type: o.type, magnitude: o.magnitude, silent: o.silent })),
        band,
        factorMin: settings.factorMin,
        factorMax: settings.factorMax,
      });
      if (result === null) return "skip";
      if (result.factorSaturated) factorSaturated += 1;
      // FF Beacon publishes whole-number values like every other source. Round
      // the published value, and derive formula_offset from the rounded market
      // so the trend basis (market = value - formula_offset, see
      // calculate-trends.ts) stays integer-clean. metadata keeps the raw engine
      // floats for diagnostics.
      const publishedValue = Math.round(result.published);
      const marketValue = Math.round(result.market);
      historyRows.push({
        player_id: playerId,
        format_config_id: fmt.id,
        value: publishedValue,
        source: SOURCE_SLUG,
        captured_at: capturedAt,
        formula_offset: publishedValue - marketValue,
        metadata: {
          engine: "beacon-v1",
          run_id: runId,
          signal,
          base: result.base,
          raw_factor: result.rawFactor,
          factor: result.factor,
          factor_saturated: result.factorSaturated,
          scaled,
          confidence_degraded: degraded,
          market: result.market,
          published: result.published,
          formula_offset: result.formulaOffset,
          contributions,
          manual_overrides: overrides.length,
          ...extraMeta,
        },
      });
      processedPlayers.add(playerId);
      return "write";
    };

    for (const fmt of ffbeaconFormats) {
      const bySourceAll = gather.byFormat.get(fmt.id);
      if (!bySourceAll || bySourceAll.size === 0) {
        perFormat.push({ slug: fmt.slug, rows: 0, skipped: 0 });
        continue;
      }

      // Restrict to enabled sources and skill-position players (the only ones
      // external sources value). K/DEF arrive in Phase 3 via stat_value.
      const bySource = new Map<string, SourcePlayerValue[]>();
      const blendWeights = new Map<string, number>();
      for (const [slug, values] of bySourceAll) {
        const w = enabledSourceWeights.get(slug);
        if (w === undefined) continue;
        const skillValues = values.filter((v) =>
          SKILL_POSITIONS.has(gather.positionByPlayer.get(v.playerId) ?? ""),
        );
        if (skillValues.length === 0) continue;
        bySource.set(slug, skillValues);
        blendWeights.set(slug, w);
      }
      if (bySource.size === 0) {
        perFormat.push({ slug: fmt.slug, rows: 0, skipped: 0 });
        continue;
      }

      const poolBand = bandResolve("QB", fmt.id); // skill pool shares the skill band
      const norm = normalizeSlice({
        bySource,
        weights: blendWeights,
        band: poolBand,
        minPlayers: settings.minPlayersForQuantile,
      });

      let rows = 0;
      let skipped = 0;
      for (const np of norm.players.values()) {
        const position = gather.positionByPlayer.get(np.playerId) ?? "WR";
        const perf = perfEnabled ? perfByPlayer.get(np.playerId) : undefined;
        const ai = aiEnabled ? aiResultByPlayer.get(np.playerId) : undefined;
        const adjustInputs: Array<{ adjustmentPct: number; weight: number; confidence: number }> = [];
        const extraMeta: Record<string, Json> = {};
        if (perf) {
          adjustInputs.push({ adjustmentPct: perf.adjustmentPct, weight: perfWeight, confidence: perf.confidence });
          extraMeta.stat_performance = {
            adjustment_pct: perf.adjustmentPct,
            confidence: perf.confidence,
          } as unknown as Json;
        }
        if (ai) {
          adjustInputs.push({ adjustmentPct: ai.adjustmentPct, weight: aiWeight, confidence: ai.confidence });
          extraMeta.ai_adjust = {
            adjustment_pct: ai.adjustmentPct,
            confidence: ai.confidence,
            rationale: ai.rationale,
            cached: ai.cached,
          } as unknown as Json;
        }
        const r = emitRow(
          np.playerId,
          position,
          fmt,
          np.value,
          np.scaled,
          np.degraded,
          "source_value",
          np.contributions as unknown as Json,
          extraMeta,
          adjustInputs,
        );
        if (r === "skip") {
          skipped += 1;
          skippedNoSignal += 1;
        } else {
          rows += 1;
        }
      }

      // K/DEF stat_value pools. Only added to formats that already have a skill
      // board, so we never create an orphan K/DEF-only format. Each position is
      // normalized within itself into its (format-aware) band.
      if (rows > 0 && statValueEnabled) {
        for (const pos of ["K", "DEF"] as const) {
          const pts = pos === "K" ? kPoints : defPoints;
          if (pts.size === 0) continue;
          const band = bandResolve(pos, fmt.id);
          const statNorm = normalizeSlice({
            bySource: new Map([
              ["stat", [...pts].map(([playerId, value]) => ({ playerId, value }))],
            ]),
            weights: new Map([["stat", statWeight]]),
            band,
            minPlayers: settings.minPlayersForQuantile,
          });
          for (const np of statNorm.players.values()) {
            const r = emitRow(
              np.playerId,
              pos,
              fmt,
              np.value,
              np.scaled,
              np.degraded,
              "stat_value",
              np.contributions as unknown as Json,
              { stat_score: pts.get(np.playerId) ?? null, seasons_used: statSeasons as unknown as Json },
            );
            if (r === "skip") {
              skipped += 1;
              skippedNoSignal += 1;
            } else {
              rows += 1;
            }
          }
        }
      }

      perFormat.push({ slug: fmt.slug, rows, skipped });
    }

    // 5b. Derive the formats no external source covers. dynasty-ppr-tep inherits
    // the dynasty 1QB base with a per-TE TE-premium boost; the best-ball presets
    // byte-for-byte inherit their redraft/dynasty counterpart and are flagged
    // placeholder until manually diverged. Reads the in-memory baseline rows.
    const INHERITED: Array<{ slug: string; baselineSlug: string; transform: "te_premium" | "identity" }> = [
      { slug: "dynasty-ppr-tep", baselineSlug: "dynasty-ppr-std", transform: "te_premium" },
      { slug: "bestball-ppr-std", baselineSlug: "redraft-ppr-std", transform: "identity" },
      { slug: "bestball-ppr-sflex", baselineSlug: "redraft-ppr-sflex", transform: "identity" },
      { slug: "bestball-dynasty-ppr-sflex", baselineSlug: "dynasty-ppr-sflex", transform: "identity" },
    ];
    const numSetting = (key: string, fallback: number): number => {
      const v = settings.raw[key];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback;
    };
    let teBoost = new Map<string, number>();
    if (INHERITED.some((s) => s.transform === "te_premium")) {
      const tepFmt = fmtBySlug.get("dynasty-ppr-tep");
      const tePremium = tepFmt?.tePremium ?? 0.5;
      teBoost = await gatherTeBoost(
        supabase,
        tePremium,
        numSetting("tep_value_sensitivity", 0.5),
        numSetting("tep_value_cap", 0.2),
        numSetting("tep_min_base_pts", 30),
      );
    }
    for (const spec of INHERITED) {
      const derived = fmtBySlug.get(spec.slug);
      const baseline = fmtBySlug.get(spec.baselineSlug);
      if (!derived || !baseline) continue;
      const isPlaceholder = spec.transform === "identity";
      let drows = 0;
      for (const br of historyRows.filter((r) => r.format_config_id === baseline.id)) {
        const position = gather.positionByPlayer.get(br.player_id) ?? "WR";
        let value = br.value;
        let signal = "inherited";
        const extra: Record<string, Json> = {
          inherited_from: spec.baselineSlug,
          baseline_value: br.value,
          placeholder: isPlaceholder,
        };
        if (spec.transform === "te_premium" && position === "TE") {
          const b = teBoost.get(br.player_id) ?? 0;
          // Keep derived values whole too. Identity inherits stay integer
          // because the baseline rows are already rounded above.
          value = Math.round(Math.min(10000, br.value * (1 + b)));
          signal = "tep_derived";
          extra.te_boost_pct = b;
        }
        historyRows.push({
          player_id: br.player_id,
          format_config_id: derived.id,
          value,
          source: SOURCE_SLUG,
          captured_at: capturedAt,
          formula_offset: br.formula_offset,
          metadata: { engine: "beacon-v1", run_id: runId, signal, ...extra },
        });
        processedPlayers.add(br.player_id);
        drows += 1;
      }
      const existing = perFormat.find((pf) => pf.slug === spec.slug);
      if (existing) existing.rows = drows;
      else perFormat.push({ slug: spec.slug, rows: drows, skipped: 0 });
    }

    // 6. Write player_value_history.
    let rowsWritten = 0;
    await chunkUpsert(historyRows, 500, async (chunk) => {
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
        { label: "player_value_history upsert (ffbeacon)" },
      );
      rowsWritten += chunk.length;
    });

    // 7. KTC-baselined picks -> source='ffbeacon' for ffbeacon dynasty formats.
    const dynastyFormatIds = ffbeaconFormats
      .filter((f) => formatById.get(f.id)?.leagueType === "dynasty")
      .map((f) => f.id);
    let pickRows = 0;
    if (dynastyFormatIds.length > 0) {
      const { data: ktcPicks, error: pErr } = await supabase
        .from("draft_pick_values")
        .select("season, round, pick_position, format_config_id, value, metadata, captured_at")
        .eq("source", "ktc")
        .in("format_config_id", dynastyFormatIds)
        .order("captured_at", { ascending: false });
      if (pErr) throw pErr;
      // KTC picks carry historical snapshots; keep only the latest per pick key
      // so the single ffbeacon captured_at does not collide on the conflict key.
      const latestPick = new Map<string, (typeof ktcPicks)[number]>();
      for (const p of ktcPicks ?? []) {
        const key = `${p.season}|${p.round}|${p.pick_position}|${p.format_config_id}`;
        if (!latestPick.has(key)) latestPick.set(key, p);
      }
      const pickInserts = [...latestPick.values()].map((p) => ({
        season: p.season,
        round: p.round,
        pick_position: p.pick_position,
        format_config_id: p.format_config_id,
        source: SOURCE_SLUG,
        value: p.value,
        captured_at: capturedAt,
        metadata: { baseline: "ktc", baseline_metadata: p.metadata } as Json,
      }));

      // Inherit picks into the dynasty-baselined derived formats (KTC publishes
      // no picks for these). Picks have no position, so TEP is a no-op: copy.
      const PICK_INHERIT = [
        { slug: "dynasty-ppr-tep", baselineSlug: "dynasty-ppr-std" },
        { slug: "bestball-dynasty-ppr-sflex", baselineSlug: "dynasty-ppr-sflex" },
      ];
      for (const pi of PICK_INHERIT) {
        const dId = fmtBySlug.get(pi.slug)?.id;
        const bId = fmtBySlug.get(pi.baselineSlug)?.id;
        if (!dId || !bId) continue;
        for (const bp of pickInserts.filter((p) => p.format_config_id === bId)) {
          pickInserts.push({
            ...bp,
            format_config_id: dId,
            metadata: { baseline: "ktc", inherited_from: pi.baselineSlug } as Json,
          });
        }
      }

      await chunkUpsert(pickInserts, 500, async (chunk) => {
        await withRetry(
          async () => {
            const { error } = await supabase
              .from("draft_pick_values")
              .upsert(chunk, {
                onConflict: "season,round,pick_position,format_config_id,source,captured_at",
                ignoreDuplicates: false,
              });
            if (error) throw error;
          },
          { label: "draft_pick_values upsert (ffbeacon)" },
        );
        pickRows += chunk.length;
      });
    }

    // 8. Finalize run.
    const finished = Date.now();
    const finishedAt = new Date(finished).toISOString();
    const droppedSources = gather.freshness
      .filter((f) => f.droppedForStaleness)
      .map((f) => f.source);
    const freshnessNote =
      droppedSources.length > 0
        ? `Dropped for staleness: ${droppedSources.join(", ")}`
        : "All sources fresh.";
    const aiNote = aiEnabled
      ? ` AI: ${aiResultByPlayer.size} adjusted, ${aiCalls} live calls.`
      : " AI: off.";
    const notes = `${freshnessNote} Stat profiles: ${profileResult.profiles}. Perf-adjusted skill players: ${perfByPlayer.size}.${aiNote}`;

    await withRetry(
      async () => {
        const { error } = await supabase
          .from("beacon_value_runs")
          .update({
            status: "success",
            finished_at: finishedAt,
            players_processed: processedPlayers.size,
            rows_written: rowsWritten,
            skipped_no_signal: skippedNoSignal,
            factor_saturated: factorSaturated,
            ai_calls: aiCalls,
            source_freshness: gather.freshness as unknown as Json,
            notes,
          })
          .eq("id", runId);
        if (error) throw error;
      },
      { label: "beacon_value_runs finalize" },
    );

    return {
      ok: true,
      runId,
      playersProcessed: processedPlayers.size,
      rowsWritten,
      skippedNoSignal,
      factorSaturated,
      pickRows,
      statProfiles: profileResult.profiles,
      perfAdjusted: perfByPlayer.size,
      aiCalls,
      aiAdjusted: aiResultByPlayer.size,
      perFormat,
      freshness: gather.freshness,
      startedAt,
      finishedAt,
      durationMs: finished - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("beacon_value_runs")
      .update({ status: "error", finished_at: new Date().toISOString(), error: message })
      .eq("id", runId);
    throw err;
  }
}
