/**
 * Signal Check core domain types.
 *
 * These are the durable contracts shared across the value engine, rules
 * interpreter, pipeline, freeze layer, and UI. The deterministic pipeline is:
 *
 *   raw FF Beacon values
 *   -> format resolution (trace only; values are already format-specific)
 *   -> post-format asset calibration rules
 *   -> side totals (pre)
 *   -> post-aggregation trade-shape rules incl. pile-on
 *   -> side totals (post)
 *   -> Beacon Verdict (margin + neutral threshold)
 *   -> confidence
 *   -> trace-based plain-language explanation
 *
 * V1 uses FF Beacon Values only (source slug "ffbeacon"). There is no public
 * value-source selector. Draft picks are DYNASTY-ONLY assets: redraft formats
 * never carry picks (enforced server-side, see format.allowsPicks).
 */

import type { TradeQualityConfig } from "@/lib/trade-quality";

export type { TradeQualityConfig };

// ---------------------------------------------------------------------------
// Input model (what the builder submits / what a saved analysis replays)
// ---------------------------------------------------------------------------

export type AssetKind = "player" | "pick";

export type SideKey = "a" | "b";

export type PickPosition = "early" | "mid" | "late";

export interface PlayerAssetInput {
  kind: "player";
  /** players.id (uuid). Must resolve to a real row; no free-text assets. */
  playerId: string;
}

export interface PickAssetInput {
  kind: "pick";
  season: number;
  round: number;
  /** Optional. When absent, the engine falls back to a generic season+round value. */
  pickPosition?: PickPosition;
  /**
   * True when pickPosition was ESTIMATED from the originating team's projected
   * finish (see lib/league-pick-slots.ts) rather than chosen by a user. Travels
   * in the input so a frozen analysis can still say which it was on replay.
   * Never set by the manual builder or On The Clock, which send real choices.
   */
  slotEstimated?: boolean;
}

export type AssetInput = PlayerAssetInput | PickAssetInput;

export interface SidesInput {
  a: AssetInput[];
  b: AssetInput[];
}

export interface AnalysisInput {
  formatSlug: string;
  sides: SidesInput;
}

// ---------------------------------------------------------------------------
// Priced assets (after the value engine)
// ---------------------------------------------------------------------------

export interface PricedPlayer {
  kind: "player";
  /** Stable id used in the trace and value maps (the players.id uuid). */
  assetId: string;
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  /** Sleeper id for the headshot CDN. null when the player has no mapping. */
  sleeperId: string | null;
  baseValue: number;
  /** True when no FF Beacon value row exists for this player+format. */
  noValue: boolean;
}

export interface PricedPick {
  kind: "pick";
  /** Stable id, e.g. "pick:2026:1:mid". */
  assetId: string;
  season: number;
  round: number;
  pickPosition: PickPosition | "unknown";
  /** Human label, e.g. "2026 1st (mid)". */
  label: string;
  baseValue: number;
  noValue: boolean;
  /**
   * True when the price is the season+round blend across early/mid/late rather
   * than one slot's value. Set on a Sleeper-sourced pick we could not slot.
   */
  blendedValue: boolean;
  /** True when the slot came from projected standings, not from a user. */
  slotEstimated: boolean;
}

export type PricedAsset = PricedPlayer | PricedPick;

// ---------------------------------------------------------------------------
// Rule trace
// ---------------------------------------------------------------------------

export type TracePhase =
  | "value_engine"
  | "post_format_calibration"
  | "post_aggregation_trade_shape";

export type TraceScope =
  | "value"
  | "single_asset"
  | "one_side"
  | "whole_trade";

export interface RuleTraceEntry {
  /** "value-engine" for engine entries; the rule uuid for calibration/shape rules. */
  ruleId: string;
  ruleVersion: number | null;
  ruleLabel: string;
  phase: TracePhase;
  scope: TraceScope;
  side: SideKey | null;
  assetId: string | null;
  valueBefore: number | null;
  /** Signed delta applied (points). Null for non-value entries (e.g. shape labels). */
  adjustment: number | null;
  valueAfter: number | null;
  /** Public, plain-language sentence (no raw points unless admin enables it). */
  publicExplanation: string;
  /** Admin/debug detail (never shown publicly). */
  adminDebug: string;
}

// ---------------------------------------------------------------------------
// Per-asset and per-side results
// ---------------------------------------------------------------------------

export interface AssetResult {
  asset: PricedAsset;
  side: SideKey;
  baseValue: number;
  /** Value after per-asset (post-format) calibration rules. */
  adjustedValue: number;
}

export interface AnalyzedSide {
  side: SideKey;
  assets: AssetResult[];
  /** Sum of adjusted asset values BEFORE trade-shape rules. */
  totalPre: number;
  /** Side total AFTER trade-shape rules. Still the plain sum of the assets. */
  totalPost: number;
  /**
   * Consolidation credit for this side, in points. Zero on the side that did
   * not win the quality comparison, and zero whenever no adjustment applied.
   */
  consolidationAdjustment: number;
  /** totalPost + consolidationAdjustment. What the verdict compares. */
  effectiveTotal: number;
}

// ---------------------------------------------------------------------------
// Verdict / shape / confidence
// ---------------------------------------------------------------------------

export interface BeaconVerdict {
  /** Rendered public label (win sentence, neutral label, or blowout label). */
  label: string;
  winnerSide: SideKey | null;
  /** Margin as a percent, rounded to the admin precision. */
  marginPct: number;
  /** Unrounded margin percent for thresholds/debug. */
  marginRaw: number;
  isNeutral: boolean;
  isBlowout: boolean;
}

/**
 * The consolidation pass: what the quality comparison found, and what it cost
 * the trailing side. `applied` false means the raw totals stand untouched (a
 * one-for-one, a dead heat, quality scoring switched off, or an adjustment
 * small enough that showing it would be noise).
 */
export interface ConsolidationResult {
  enabled: boolean;
  applied: boolean;
  /** Side the quality comparison favours. Null when nothing separated them. */
  favouredSide: SideKey | null;
  /** Points credited to the favoured side. Zero when not applied. */
  adjustment: number;
  /** The adjustment as a percent of the combined effective value. */
  adjustmentPct: number;
  /** Quality totals per side, for the trace and admin debugging. */
  qualityTotals: Record<SideKey, number>;
  /** Package pieces discounted per side. Drives the roster-clog shape. */
  discountedCounts: Record<SideKey, number>;
  /** True when the solver hit its ceiling instead of converging. */
  capped: boolean;
}

export interface TradeShapeResult {
  enabled: boolean;
  /** Internal key, e.g. "consolidation". Null when shapes are disabled or none matched. */
  key: string | null;
  /** Admin-configured public label for the key. */
  label: string | null;
}

export type ConfidenceLevel = "low" | "medium" | "high";

export interface ConfidenceFactor {
  key: string;
  contribution: number;
  note: string;
}

export interface ConfidenceResult {
  enabled: boolean;
  level: ConfidenceLevel | null;
  label: string | null;
  /** 0..100 composite score. */
  score: number;
  factors: ConfidenceFactor[];
}

// ---------------------------------------------------------------------------
// Format / source context resolved for the analysis
// ---------------------------------------------------------------------------

export interface ResolvedFormat {
  slug: string;
  display: string;
  configId: string;
  leagueType: string; // "redraft" | "dynasty"
  /** True only for dynasty formats. Picks are rejected when false. */
  allowsPicks: boolean;
}

export interface ResolvedSource {
  /** Player-value source slug. Always "ffbeacon" in V1. */
  slug: string;
  display: string;
  /** Pick-value source slug (ffbeacon, falling back to ktc if needed). */
  pickSlug: string;
  pickDisplay: string;
}

// ---------------------------------------------------------------------------
// Full analysis result
// ---------------------------------------------------------------------------

export interface SignalCheckAnalysis {
  format: ResolvedFormat;
  source: ResolvedSource;
  sides: Record<SideKey, AnalyzedSide>;
  combinedValue: number;
  verdict: BeaconVerdict;
  consolidation: ConsolidationResult;
  tradeShape: TradeShapeResult;
  confidence: ConfidenceResult;
  explanation: string;
  trace: RuleTraceEntry[];
  hasMissingValues: boolean;
  /** True when any pick was priced by the season+round blend, slot unknown. */
  hasBlendedPicks: boolean;
  /** True when any pick's slot was estimated from projected standings. */
  hasEstimatedPicks: boolean;
  valueEngineVersion: string;
  ruleInterpreterVersion: string;
  rulesetVersion: number | null;
  /** ISO timestamp of the newest value row used (provenance for the frozen row). */
  valueCapturedAt: string | null;
}

// ---------------------------------------------------------------------------
// Resolved settings (loaded from beacon_settings, category signal_check%)
// ---------------------------------------------------------------------------

export interface SignalCheckSettings {
  // General
  enabled: boolean;
  publicLabel: string;
  resultLabel: string;
  marginPrecision: number;
  showRawValues: boolean;
  showConfidence: boolean;
  showTradeShape: boolean;
  sleeperImportsEnabled: boolean;
  shareLinksEnabled: boolean;
  shareImagesEnabled: boolean;
  autocompleteMinLength: number;
  maxAssetsPerSide: number;

  // Verdict
  neutralThresholdPct: number;
  neutralLabel: string;
  blowoutThresholdPct: number;
  blowoutLabel: string;
  winTemplate: string;
  compoundingMode: "sequential" | "against_base";

  // Consolidation quality (replaces pile-on as the depth discount)
  quality: TradeQualityConfig;
  qualityEnabled: boolean;
  /** Row label shown next to the adjustment, e.g. "Value adjustment". */
  qualityAdjustmentLabel: string;
  /** Sentence added to the explanation when an adjustment applies. */
  qualityTemplate: string;

  // Pile-on (legacy depth discount; off by default once quality is on)
  pileOnEnabled: boolean;
  pileOnTopK: number;
  pileOnCurveBase: number;
  pileOnMaxPenaltyPct: number;
  pileOnMinAssets: number;
  pileOnTemplate: string;

  // Trade shape
  shapeEnabled: boolean;
  shapeLabels: Record<string, string>;
  shapePickSharePct: number;
  shapeBestSharePct: number;

  // Confidence
  confidenceEnabled: boolean;
  confidenceLowMax: number;
  confidenceHighMin: number;
  confidenceLabels: Record<ConfidenceLevel, string>;

  // Value / format
  defaultFormatSlug: string;
  disabledFormatSlugs: string[];
  sleeperFormatOverrideAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Public-safe share payload (the ONLY object exposed on public share pages /
// OG images). Built by freeze.ts. Never contains user_id, sleeper_context,
// raw/adjusted values, or the rule trace.
// ---------------------------------------------------------------------------

export interface PublicSidePayload {
  side: SideKey;
  teamLabel: string | null;
  assets: {
    name: string;
    detail: string | null;
    /** Asset kind, so the share page can render a headshot vs a pick badge. */
    kind: "player" | "pick";
    /** Sleeper id for the headshot CDN (player assets only). Public, safe. */
    sleeperId: string | null;
    /** Draft round (pick assets only) for the pick badge. */
    round: number | null;
  }[];
  /**
   * Effective side total (assets plus any consolidation credit). Only present
   * when the admin "show raw values" toggle is on.
   */
  total: number | null;
  /**
   * Consolidation credit for this side, in points. Only present when raw
   * values are shown AND this side actually received one.
   */
  adjustment: number | null;
  /**
   * The same credit as a percent of the combined effective value. Safe to show
   * when raw points are hidden, because it exposes no value scale.
   */
  adjustmentPct: number | null;
}

export interface PublicSharePayload {
  featureLabel: string;
  resultLabel: string;
  verdictLabel: string;
  winnerSide: SideKey | null;
  marginPct: number | null;
  formatDisplay: string;
  tradeShapeLabel: string | null;
  confidenceLabel: string | null;
  explanation: string;
  /** Row label for the consolidation credit, when one is present. */
  adjustmentLabel: string | null;
  sides: PublicSidePayload[];
  valueSnapshotLabel: string | null;
  createdAtIso: string;
}
