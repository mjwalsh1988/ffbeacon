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
  /** True when early/mid/late was assumed rather than supplied/known. */
  assumed: boolean;
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
  /** Sum of adjusted asset values BEFORE trade-shape rules (incl. pile-on). */
  totalPre: number;
  /** Side total AFTER trade-shape rules (incl. pile-on). */
  totalPost: number;
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
  tradeShape: TradeShapeResult;
  confidence: ConfidenceResult;
  explanation: string;
  trace: RuleTraceEntry[];
  hasMissingValues: boolean;
  /** True when any pick used an assumed early/mid/late bucket. */
  hasAssumedPicks: boolean;
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

  // Pile-on
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
  /** Only present when the admin "show raw values" toggle is on. */
  total: number | null;
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
  sides: PublicSidePayload[];
  valueSnapshotLabel: string | null;
  createdAtIso: string;
}
