/**
 * Types for the FAAB strategy calculator.
 *
 * The calculator is a pure function (lib/faab/calculate-faab.ts) driven by an
 * editable settings document (lib/faab/default-settings.ts holds the fallback
 * defaults; the admin page persists overrides to faab_calculator_settings).
 *
 * Nothing here reads or writes player values. The calculator only CONSUMES the
 * rank/value numbers the page already resolved for the active source + format.
 */

export type NeedLevel = "low" | "medium" | "high";

/** One band of the playerRatio -> baseline FAAB curve. Ordered low ratio to
 * high. maxRatio === null means "and above" (the final band). */
export interface BidBand {
  /** Stable identifier so the admin UI can key/edit rows. */
  id: string;
  minRatio: number;
  /** null === infinity (final band). */
  maxRatio: number | null;
  tierLabel: string;
  /** Baseline bid as a percent of remaining budget, before adjustments. */
  minPct: number;
  maxPct: number;
  /** Hard cap (percent of budget) for this tier, applied after every
   * adjustment so high need cannot inflate a deep flyer into a huge bid. */
  capPct: number;
}

export interface UserDefaults {
  defaultTeams: number;
  teamOptions: number[];
  defaultStarters: number;
  starterOptions: number[];
  defaultNeed: NeedLevel;
  defaultBudget: number;
}

export interface DepthAdjustments {
  /** leagueDemand <= this is a "shallow" league. */
  shallowMaxDemand: number;
  /** leagueDemand <= this (and above shallow) is "standard"; above is "deep". */
  standardMaxDemand: number;
  /** playerRatio <= this counts as an "elite" player for depth adjustments. */
  eliteRatioMax: number;
  /** playerRatio >= this counts as a "fringe / depth" player. */
  depthRatioMin: number;
  /** Shallow league: boost elite players by this percent. */
  shallowEliteBoostPct: number;
  /** Shallow league: cut fringe / depth players by this percent. */
  shallowDepthCutPct: number;
  /** Deep league: trim the elite emphasis by this percent. */
  deepEliteBoostReductionPct: number;
  /** Deep league: boost fringe / depth players by this percent. */
  deepDepthBoostPct: number;
}

export interface NeedMultipliers {
  low: number;
  medium: number;
  high: number;
}

/** Inclusive percent-of-budget range. */
export interface PctRange {
  minPct: number;
  maxPct: number;
}

export interface DumpSettings {
  enabled: boolean;
  /** dumpRankThreshold = leagueDemand * thresholdRatio. */
  thresholdRatio: number;
  /** valueScore at or above this also flags a dump candidate. */
  valueScoreThreshold: number;
  ranges: Record<NeedLevel, PctRange>;
}

export interface ValueNormalization {
  /** replacementRank = round(leagueDemand * this). */
  replacementRankMultiplier: number;
  /** eliteRank = max(1, round(leagueDemand * this)). */
  eliteRankMultiplier: number;
  valueScoreClampMin: number;
  valueScoreClampMax: number;
  /** valueScore at which the value modifier is neutral (no change). */
  valueScoreNeutral: number;
  /** Maximum +/- percent the value modifier can move a bid. */
  valueAdjustmentMaxPct: number;
}

export interface ResultCopy {
  economyNotice: string;
  missingValueNote: string;
  dumpNote: string;
  teamsHelp: string;
  startersHelp: string;
}

export interface FaabSettings {
  userDefaults: UserDefaults;
  bidCurve: BidBand[];
  depthAdjustments: DepthAdjustments;
  needMultipliers: NeedMultipliers;
  dump: DumpSettings;
  valueNormalization: ValueNormalization;
  copy: ResultCopy;
}

/** The selected player, reduced to only what the calculator consumes. */
export interface FaabPlayerInput {
  overallRank: number | null;
  positionRank?: number | null;
  value: number | null;
}

/** One entry of the resolved player pool (the page's ranked list for the
 * active source + format). Used only to locate replacement/elite value. */
export interface FaabPoolEntry {
  overallRank: number;
  value: number | null;
}

export interface FaabCalcInput {
  player: FaabPlayerInput;
  remainingBudget: number;
  needLevel: NeedLevel;
  teams: number;
  offensiveStarters: number;
  settings: FaabSettings;
  /** Optional. When absent or valueless, the calc falls back to rank-only. */
  playerPool?: FaabPoolEntry[];
}

export type AggressionLabel =
  | "Conservative"
  | "Balanced"
  | "Aggressive"
  | "Empty the Clip";

export interface FaabDebugContext {
  leagueDemand: number;
  playerRatio: number | null;
  bandId: string | null;
  baselineMinPct: number;
  baselineMaxPct: number;
  depthTier: "shallow" | "standard" | "deep";
  depthMultiplier: number;
  valueScore: number | null;
  valueMultiplier: number;
  needMultiplier: number;
  replacementRank: number;
  eliteRank: number;
  replacementValue: number | null;
  eliteValue: number | null;
  preCapMinPct: number;
  preCapMaxPct: number;
  capPct: number | null;
  dumpRankThreshold: number;
  isDumpCandidate: boolean;
  usedValueData: boolean;
}

export interface FaabResult {
  lowBid: number;
  highBid: number;
  lowPct: number;
  highPct: number;
  targetPct: number;
  tierLabel: string;
  aggressionLabel: AggressionLabel;
  isDumpCandidate: boolean;
  explanation: string;
  notices: string[];
  debugContext: FaabDebugContext;
}
