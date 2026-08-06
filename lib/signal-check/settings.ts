/**
 * Loads Signal Check settings and the active ruleset from the database.
 *
 * Settings live in beacon_settings under the signal_check* categories (seeded
 * in migration 0104). DEFAULT_SETTINGS mirrors those seeds so the engine and
 * unit tests can run without a database and so a missing row degrades to a
 * sensible default rather than undefined.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ConfidenceLevel, SignalCheckSettings } from "./types";
import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  parsePackageMultipliers,
} from "@/lib/trade-quality";
import { dbRuleSchema, type ParsedRule } from "./rules/schema";

type Client = SupabaseClient<Database>;

export const DEFAULT_SETTINGS: SignalCheckSettings = {
  enabled: true,
  publicLabel: "Signal Check",
  resultLabel: "Beacon Verdict",
  marginPrecision: 1,
  showRawValues: false,
  showConfidence: true,
  showTradeShape: true,
  sleeperImportsEnabled: true,
  shareLinksEnabled: true,
  shareImagesEnabled: true,
  autocompleteMinLength: 4,
  maxAssetsPerSide: 12,

  neutralThresholdPct: 2.5,
  neutralLabel: "Near even",
  blowoutThresholdPct: 20,
  blowoutLabel: "Lopsided",
  winTemplate: "Side {side} wins by {margin}% of total trade value.",
  compoundingMode: "sequential",

  quality: { ...DEFAULT_TRADE_QUALITY_CONFIG },
  qualityEnabled: true,
  qualityAdjustmentLabel: "Value adjustment",
  // Says only what is true on every trade that fires an adjustment. An earlier
  // draft opened "Side {side} gives up more total value", which is false
  // whenever the two sides start level and consolidation alone separates them.
  qualityTemplate:
    "Side {side} carries the more concentrated package, so the smaller pieces on the other side, the ones worth under half the best asset in the deal, count for less than their face value.",

  // Superseded by the quality pass above. Left in place so an admin can fall
  // back to the old depth discount, but off by default: running both would
  // charge the same package twice.
  pileOnEnabled: false,
  pileOnTopK: 2,
  pileOnCurveBase: 0.9,
  pileOnMaxPenaltyPct: 25,
  pileOnMinAssets: 3,
  pileOnTemplate:
    "Side {side} receives several lower-value pieces, so depth beyond the top {k} assets is discounted.",

  shapeEnabled: true,
  shapeLabels: {
    consolidation: "Consolidation trade",
    depth: "Depth package",
    stud_swap: "Stud-for-stud swap",
    win_now: "Win-now move",
    rebuild: "Rebuild move",
    pick_heavy: "Pick-heavy deal",
    roster_clog: "Roster clog risk",
    format_driven: "Format-driven win",
    near_even: "Near-even swap",
  },
  shapePickSharePct: 50,
  shapeBestSharePct: 60,

  confidenceEnabled: true,
  confidenceLowMax: 40,
  confidenceHighMin: 70,
  confidenceLabels: {
    low: "Low confidence",
    medium: "Medium confidence",
    high: "High confidence",
  },

  defaultFormatSlug: "redraft-ppr-std",
  disabledFormatSlugs: [],
  sleeperFormatOverrideAllowed: false,
};

type RawValue = number | boolean | string;

function buildSettings(map: Map<string, RawValue>): SignalCheckSettings {
  const num = (key: string, fallback: number): number => {
    const v = map.get(key);
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = map.get(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const str = (key: string, fallback: string): string => {
    const v = map.get(key);
    return typeof v === "string" ? v : fallback;
  };

  const d = DEFAULT_SETTINGS;
  const q = DEFAULT_TRADE_QUALITY_CONFIG;
  const compoundingRaw = str("signal_check_compounding_mode", d.compoundingMode);
  const compoundingMode: SignalCheckSettings["compoundingMode"] =
    compoundingRaw === "against_base" ? "against_base" : "sequential";

  const disabled = str("signal_check_disabled_formats", "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    enabled: bool("signal_check_enabled", d.enabled),
    publicLabel: str("signal_check_public_label", d.publicLabel),
    resultLabel: str("signal_check_result_label", d.resultLabel),
    marginPrecision: num("signal_check_margin_precision", d.marginPrecision),
    showRawValues: bool("signal_check_show_raw_values", d.showRawValues),
    showConfidence: bool("signal_check_show_confidence", d.showConfidence),
    showTradeShape: bool("signal_check_show_trade_shape", d.showTradeShape),
    sleeperImportsEnabled: bool("signal_check_sleeper_imports", d.sleeperImportsEnabled),
    shareLinksEnabled: bool("signal_check_share_links", d.shareLinksEnabled),
    shareImagesEnabled: bool("signal_check_share_images", d.shareImagesEnabled),
    autocompleteMinLength: num("signal_check_autocomplete_min", d.autocompleteMinLength),
    maxAssetsPerSide: num("signal_check_max_assets_per_side", d.maxAssetsPerSide),

    neutralThresholdPct: num("signal_check_neutral_threshold", d.neutralThresholdPct),
    neutralLabel: str("signal_check_neutral_label", d.neutralLabel),
    blowoutThresholdPct: num("signal_check_blowout_threshold", d.blowoutThresholdPct),
    blowoutLabel: str("signal_check_blowout_label", d.blowoutLabel),
    winTemplate: str("signal_check_win_template", d.winTemplate),
    compoundingMode,

    quality: {
      baseWeight: num("signal_check_quality_base_weight", q.baseWeight),
      scaleWeight: num("signal_check_quality_scale_weight", q.scaleWeight),
      scaleExponent: num("signal_check_quality_scale_exponent", q.scaleExponent),
      peakWeight: num("signal_check_quality_peak_weight", q.peakWeight),
      peakExponent: num("signal_check_quality_peak_exponent", q.peakExponent),
      peakSlack: num("signal_check_quality_peak_slack", q.peakSlack),
      poolPadding: num("signal_check_quality_pool_padding", q.poolPadding),
      packageThresholdPct: num("signal_check_quality_package_threshold", q.packageThresholdPct),
      packageMultipliers: parsePackageMultipliers(
        str("signal_check_quality_package_multipliers", q.packageMultipliers.join(", ")),
        q.packageMultipliers,
      ),
      minAssetsForAdjustment: num("signal_check_quality_min_assets", q.minAssetsForAdjustment),
      displayThresholdPct: num("signal_check_quality_display_threshold", q.displayThresholdPct),
      maxAdjustmentPct: num("signal_check_quality_max_adjustment", q.maxAdjustmentPct),
    },
    qualityEnabled: bool("signal_check_quality_enabled", d.qualityEnabled),
    qualityAdjustmentLabel: str("signal_check_quality_label", d.qualityAdjustmentLabel),
    qualityTemplate: str("signal_check_quality_template", d.qualityTemplate),

    pileOnEnabled: bool("signal_check_pileon_enabled", d.pileOnEnabled),
    pileOnTopK: num("signal_check_pileon_top_k", d.pileOnTopK),
    pileOnCurveBase: num("signal_check_pileon_curve_base", d.pileOnCurveBase),
    pileOnMaxPenaltyPct: num("signal_check_pileon_max_penalty", d.pileOnMaxPenaltyPct),
    pileOnMinAssets: num("signal_check_pileon_min_assets", d.pileOnMinAssets),
    pileOnTemplate: str("signal_check_pileon_template", d.pileOnTemplate),

    shapeEnabled: bool("signal_check_shape_enabled", d.shapeEnabled),
    shapeLabels: {
      consolidation: str("signal_check_shape_consolidation", d.shapeLabels.consolidation),
      depth: str("signal_check_shape_depth", d.shapeLabels.depth),
      stud_swap: str("signal_check_shape_stud_swap", d.shapeLabels.stud_swap),
      win_now: str("signal_check_shape_win_now", d.shapeLabels.win_now),
      rebuild: str("signal_check_shape_rebuild", d.shapeLabels.rebuild),
      pick_heavy: str("signal_check_shape_pick_heavy", d.shapeLabels.pick_heavy),
      roster_clog: str("signal_check_shape_roster_clog", d.shapeLabels.roster_clog),
      format_driven: str("signal_check_shape_format_driven", d.shapeLabels.format_driven),
      near_even: str("signal_check_shape_near_even", d.shapeLabels.near_even),
    },
    shapePickSharePct: num("signal_check_shape_pick_share", d.shapePickSharePct),
    shapeBestSharePct: num("signal_check_shape_best_share", d.shapeBestSharePct),

    confidenceEnabled: bool("signal_check_confidence_enabled", d.confidenceEnabled),
    confidenceLowMax: num("signal_check_confidence_low_max", d.confidenceLowMax),
    confidenceHighMin: num("signal_check_confidence_high_min", d.confidenceHighMin),
    confidenceLabels: {
      low: str("signal_check_confidence_low", d.confidenceLabels.low),
      medium: str("signal_check_confidence_medium", d.confidenceLabels.medium),
      high: str("signal_check_confidence_high", d.confidenceLabels.high),
    } as Record<ConfidenceLevel, string>,

    defaultFormatSlug: str("signal_check_default_format", d.defaultFormatSlug),
    disabledFormatSlugs: disabled,
    sleeperFormatOverrideAllowed: bool("signal_check_sleeper_override", d.sleeperFormatOverrideAllowed),
  };
}

export async function loadSignalCheckSettings(supabase: Client): Promise<SignalCheckSettings> {
  const { data, error } = await supabase
    .from("beacon_settings")
    .select("key, value")
    .like("category", "signal_check%");
  if (error || !data) return { ...DEFAULT_SETTINGS };
  const map = new Map<string, RawValue>();
  for (const row of data) {
    const v = row.value as unknown;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      map.set(row.key, v);
    }
  }
  return buildSettings(map);
}

export interface ActiveRuleset {
  version: number | null;
  rules: ParsedRule[];
}

async function loadRulesFor(
  supabase: Client,
  rulesetId: string,
  version: number,
): Promise<ParsedRule[]> {
  const { data: rows } = await supabase
    .from("signal_check_rules")
    .select(
      "id, scope, phase, sort_order, condition, action, stackable, stack_group, max_adjustment, admin_label, public_explanation_template, enabled",
    )
    .eq("ruleset_id", rulesetId)
    .order("sort_order", { ascending: true });

  const rules: ParsedRule[] = [];
  for (const row of rows ?? []) {
    const parsed = dbRuleSchema.safeParse(row);
    if (!parsed.success) {
      console.error(`[signal-check] skipping invalid rule ${(row as { id?: string }).id}`, parsed.error.issues);
      continue;
    }
    const r = parsed.data;
    rules.push({
      id: r.id,
      rulesetVersion: version,
      scope: r.scope,
      phase: r.phase,
      sortOrder: r.sort_order,
      condition: r.condition,
      action: r.action,
      stackable: r.stackable,
      stackGroup: r.stack_group,
      maxAdjustment: r.max_adjustment,
      adminLabel: r.admin_label,
      publicExplanationTemplate: r.public_explanation_template,
      enabled: r.enabled,
    });
  }
  return rules;
}

/**
 * Load the single active published ruleset and its enabled rules, parsed and
 * validated. Corrupt rows are skipped (logged) rather than failing the whole
 * analysis. Returns an empty ruleset when none is active.
 */
export async function loadActiveRuleset(supabase: Client): Promise<ActiveRuleset> {
  const { data: ruleset } = await supabase
    .from("signal_check_rulesets")
    .select("id, version")
    .eq("is_active", true)
    .maybeSingle();
  if (!ruleset) return { version: null, rules: [] };
  return { version: ruleset.version, rules: await loadRulesFor(supabase, ruleset.id, ruleset.version) };
}

/** Load a specific ruleset's rules by id (for regression preview against a
 * draft or a prior version). Returns an empty ruleset when the id is unknown. */
export async function loadRulesetById(supabase: Client, rulesetId: string): Promise<ActiveRuleset> {
  const { data: ruleset } = await supabase
    .from("signal_check_rulesets")
    .select("id, version")
    .eq("id", rulesetId)
    .maybeSingle();
  if (!ruleset) return { version: null, rules: [] };
  return { version: ruleset.version, rules: await loadRulesFor(supabase, ruleset.id, ruleset.version) };
}
