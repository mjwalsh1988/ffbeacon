/**
 * Live loader for the FF Beacon tunables. Everything the engine needs to tune
 * comes from beacon_settings (global scalars) and beacon_signal_weights
 * (per-signal / per-source). There are NO hardcoded operational constants in the
 * engine: freshness.ts etc. carry only fallback defaults used when a row is
 * absent. Plan v3.1 requirement: everything tunable lives in the admin area.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { FALLBACK_STALE_DAYS, type StaleDays } from "./freshness";
import { DEFAULT_AI_SYSTEM_PROMPT } from "./signals/ai-adjust";

export interface BeaconSettings {
  staleDays: StaleDays;
  factorMin: number;
  factorMax: number;
  minPlayersForQuantile: number;
  normalizationMethod: string;
  aiEnabled: boolean;
  aiModel: string;
  aiAdjustmentBound: number;
  /** Live, admin-editable system prompt sent to the model ({bound} substituted at call time). */
  aiSystemPrompt: string;
  /** Per-run cap on live Anthropic calls (cost control). */
  aiMaxCalls: number;
  /** Candidate gate: normalized cross-source disagreement >= this. */
  aiMinSpread: number;
  /** Candidate gate: abs(stat_performance adjustment) >= this. */
  aiMinMover: number;
  /** Global multiplier applied ONLY to ffbeacon draft pick values at recompute. 1 = no change. */
  pickValueMultiplier: number;
  /**
   * Format slugs pinned to calibrated normalization regardless of
   * normalizationMethod. The canary control: one slug here switches one board
   * over, clearing the list rolls every board back. See resolveNormalizationMethod.
   */
  calibrationFormatSlugs: string[];
  /** Minimum players every expected source must share before a reference is built. */
  calibrationMinSharedPlayers: number;
  /** Knots used when fitting a source onto the reference. */
  calibrationGridPoints: number;
  /** How old the active reference may get before the rebuild job replaces it. */
  calibrationRebuildDays: number;
  /** Reference age that raises an alert (it never stops the engine). */
  calibrationMaxAgeDays: number;
  calibrationDriftMeanAbs: number;
  calibrationDriftPlayerMax: number;
  calibrationDriftPct250: number;
  calibrationDriftMinSpearman: number;
  /** The raw rows, for the run's weights_snapshot. */
  raw: Record<string, unknown>;
}

export type NormalizationMethod = "quantile_median" | "calibrated";

/**
 * Which normalization one format uses.
 *
 * The canary allowlist wins over the global method, so the staged rollout is a
 * single text box: put one slug in it and that board alone switches, with the
 * global setting still reading quantile_median for everything else. Emptying the
 * box is the rollback, and it needs no deploy and no data change.
 *
 * Derived boards (every TE-premium format, the best-ball presets) inherit their
 * baseline's finished rows and never normalize, so listing one has no effect.
 */
export function resolveNormalizationMethod(
  formatSlug: string,
  settings: Pick<BeaconSettings, "normalizationMethod" | "calibrationFormatSlugs">,
): NormalizationMethod {
  if (settings.calibrationFormatSlugs.includes(formatSlug)) return "calibrated";
  return settings.normalizationMethod === "calibrated" ? "calibrated" : "quantile_median";
}

/** Parse the comma-separated canary allowlist. Blank entries are dropped. */
export function parseFormatSlugList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface SignalWeight {
  signalType: string;
  sourceSlug: string | null;
  weight: number;
  confidenceCap: number;
  isEnabled: boolean;
  params: Record<string, unknown>;
}

const DEFAULTS = {
  factorMin: 0.5,
  factorMax: 1.5,
  minPlayersForQuantile: 30,
  normalizationMethod: "quantile_median",
  aiEnabled: false,
  aiModel: "claude-haiku-4-5",
  aiAdjustmentBound: 0.12,
  aiMaxCalls: 60,
  aiMinSpread: 0.15,
  aiMinMover: 0.05,
  pickValueMultiplier: 1,
  calibrationMinSharedPlayers: 100,
  calibrationGridPoints: 41,
  calibrationRebuildDays: 30,
  calibrationMaxAgeDays: 45,
  calibrationDriftMeanAbs: 100,
  calibrationDriftPlayerMax: 500,
  calibrationDriftPct250: 0.02,
  calibrationDriftMinSpearman: 0.995,
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export async function loadBeaconSettings(
  supabase: SupabaseClient<Database>,
): Promise<BeaconSettings> {
  const { data, error } = await supabase
    .from("beacon_settings")
    .select("key, value");
  if (error) throw error;

  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key, row.value);
  const raw = Object.fromEntries(map);

  return {
    staleDays: {
      daily: num(map.get("stale_after_days_daily"), FALLBACK_STALE_DAYS.daily),
      weekly: num(map.get("stale_after_days_weekly"), FALLBACK_STALE_DAYS.weekly),
      default: num(map.get("stale_after_days_default"), FALLBACK_STALE_DAYS.default),
    },
    factorMin: num(map.get("factor_min"), DEFAULTS.factorMin),
    factorMax: num(map.get("factor_max"), DEFAULTS.factorMax),
    minPlayersForQuantile: num(
      map.get("min_players_for_quantile"),
      DEFAULTS.minPlayersForQuantile,
    ),
    normalizationMethod:
      typeof map.get("normalization_method") === "string"
        ? (map.get("normalization_method") as string)
        : DEFAULTS.normalizationMethod,
    aiEnabled: map.get("ai_enabled") === true,
    aiModel:
      typeof map.get("ai_model") === "string"
        ? (map.get("ai_model") as string)
        : DEFAULTS.aiModel,
    aiAdjustmentBound: num(map.get("ai_adjustment_bound"), DEFAULTS.aiAdjustmentBound),
    aiSystemPrompt:
      typeof map.get("ai_system_prompt") === "string" && (map.get("ai_system_prompt") as string).trim()
        ? (map.get("ai_system_prompt") as string)
        : DEFAULT_AI_SYSTEM_PROMPT,
    aiMaxCalls: num(map.get("ai_max_calls"), DEFAULTS.aiMaxCalls),
    aiMinSpread: num(map.get("ai_min_spread"), DEFAULTS.aiMinSpread),
    aiMinMover: num(map.get("ai_min_mover"), DEFAULTS.aiMinMover),
    pickValueMultiplier: num(map.get("pick_value_multiplier"), DEFAULTS.pickValueMultiplier),
    calibrationFormatSlugs: parseFormatSlugList(map.get("calibration_format_slugs")),
    calibrationMinSharedPlayers: num(
      map.get("calibration_min_shared_players"),
      DEFAULTS.calibrationMinSharedPlayers,
    ),
    calibrationGridPoints: num(map.get("calibration_grid_points"), DEFAULTS.calibrationGridPoints),
    calibrationRebuildDays: num(
      map.get("calibration_rebuild_days"),
      DEFAULTS.calibrationRebuildDays,
    ),
    calibrationMaxAgeDays: num(map.get("calibration_max_age_days"), DEFAULTS.calibrationMaxAgeDays),
    calibrationDriftMeanAbs: num(
      map.get("calibration_drift_mean_abs"),
      DEFAULTS.calibrationDriftMeanAbs,
    ),
    calibrationDriftPlayerMax: num(
      map.get("calibration_drift_player_max"),
      DEFAULTS.calibrationDriftPlayerMax,
    ),
    calibrationDriftPct250: num(
      map.get("calibration_drift_pct_250"),
      DEFAULTS.calibrationDriftPct250,
    ),
    calibrationDriftMinSpearman: num(
      map.get("calibration_drift_min_spearman"),
      DEFAULTS.calibrationDriftMinSpearman,
    ),
    raw,
  };
}

export async function loadSignalWeights(
  supabase: SupabaseClient<Database>,
): Promise<SignalWeight[]> {
  const { data, error } = await supabase
    .from("beacon_signal_weights")
    .select("signal_type, source_slug, weight, confidence_cap, is_enabled, params");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    signalType: r.signal_type,
    sourceSlug: r.source_slug,
    weight: Number(r.weight),
    confidenceCap: Number(r.confidence_cap),
    isEnabled: r.is_enabled,
    params: (r.params as Record<string, unknown>) ?? {},
  }));
}

/** Lookup helper: find the weight row for a (signal, source) pair. */
export function findWeight(
  weights: SignalWeight[],
  signalType: string,
  sourceSlug: string | null,
): SignalWeight | undefined {
  return weights.find(
    (w) => w.signalType === signalType && (w.sourceSlug ?? null) === (sourceSlug ?? null),
  );
}
