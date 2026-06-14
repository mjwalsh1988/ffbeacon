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
  /** The raw rows, for the run's weights_snapshot. */
  raw: Record<string, unknown>;
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
