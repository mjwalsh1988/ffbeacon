/**
 * Consolidation-aware trade quality.
 *
 * Adding up trade values is the obvious way to compare two sides of a deal and
 * it is wrong in one specific, common way: it says three depth pieces worth
 * 2,000 each are the same thing as one player worth 6,000. They are not. One
 * roster spot holding a startable player beats three holding bench bodies, and
 * every manager knows it, which is why an "even" package offer usually gets
 * refused.
 *
 * So this module scores each asset a SECOND time, on a curve that rises faster
 * than the value itself:
 *
 *   Q(p) = p x [ base + scale x (p / G)^se + peak x (p / (slack x H))^pe ]
 *
 *   p      the asset's normal FF Beacon value
 *   H      the biggest single asset anywhere in this trade
 *   G      the biggest value available in the whole pool, plus a little padding
 *
 * The first term gives every asset a flat share of its value. The second says
 * "how big is this compared with the best asset in the game". The third, with
 * its steep exponent, only wakes up for assets close to the best piece in THIS
 * trade. A depth piece collects roughly a tenth of its value; the headliner
 * collects appreciably more.
 *
 * On top of that, a package of small pieces is discounted piece by piece. Any
 * asset worth less than half the trade's best asset is a "package piece", and
 * the second, third, and fourth of those count for progressively less. One
 * decent secondary asset costs you nothing. Four throw-ins are mostly noise.
 *
 * WHAT COMES OUT
 *   A quality total per side, which decides the winner, and a balancing amount:
 *   the value of the extra asset the losing side would have to add before the
 *   two sides scored the same. That amount is what the surfaces show as a
 *   "Value adjustment" line, so a reader looking at a side with fewer points but
 *   a better player can see exactly why it is still ahead.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   One-for-one trades get no adjustment. There is no consolidation happening in
 *   a swap of single players, so a premium there would be double-counting the
 *   value gap that is already visible. `minAssetsForAdjustment` is that rule.
 *
 *   It never touches stored values. Everything here is computed inside one
 *   trade and thrown away. A player's FF Beacon value is what it always was.
 *
 * Pure and unit-scale-agnostic: hand it any consistent pool of numbers (any
 * source, any format) with that pool's ceiling, and the shape of the curve is
 * the same. That is what lets Signal Check and Trade Finder share it while
 * running on different value sources.
 */

export interface TradeQualityConfig {
  /** Share of its own value every asset collects, however small it is. */
  baseWeight: number;
  /** Weight on "how big is this against the whole pool". */
  scaleWeight: number;
  scaleExponent: number;
  /** Weight on "how close is this to the best asset in the trade". */
  peakWeight: number;
  peakExponent: number;
  /** Keeps the peak term below 1 even for the trade's own best asset. */
  peakSlack: number;
  /** Added to the pool ceiling so the top asset does not sit exactly at 1. */
  poolPadding: number;
  /** Percent of the trade's best asset below which a piece is a package piece. */
  packageThresholdPct: number;
  /** Multipliers for the 1st, 2nd, 3rd... package piece. Last one repeats. */
  packageMultipliers: number[];
  /** The larger side must hold at least this many assets before an adjustment applies. */
  minAssetsForAdjustment: number;
  /** Adjustments below this percent of combined value are dropped as noise. */
  displayThresholdPct: number;
  /** Ceiling on the balancing amount, as a percent of combined value. */
  maxAdjustmentPct: number;
}

export const DEFAULT_TRADE_QUALITY_CONFIG: TradeQualityConfig = {
  baseWeight: 0.1,
  scaleWeight: 0.05,
  scaleExponent: 1.3,
  peakWeight: 0.05,
  peakExponent: 6,
  peakSlack: 1.05,
  poolPadding: 80,
  packageThresholdPct: 50,
  packageMultipliers: [1, 0.85, 0.7, 0.6],
  minAssetsForAdjustment: 2,
  displayThresholdPct: 3.3,
  maxAdjustmentPct: 300,
};

export type QualitySideKey = "a" | "b";

export interface QualityPiece {
  value: number;
  /** Quality before the package multiplier. */
  quality: number;
  multiplier: number;
  /** Quality after the package multiplier. This is what the side total sums. */
  weighted: number;
  /** True when this piece fell below the package threshold. */
  isPackagePiece: boolean;
}

export interface QualitySide {
  rawTotal: number;
  qualityTotal: number;
  pieces: QualityPiece[];
  /** Package pieces that lost value to the diminishing-return sequence. */
  discountedCount: number;
}

export interface TradeQualityResult {
  a: QualitySide;
  b: QualitySide;
  /** The biggest single asset anywhere in the trade. */
  highestAsset: number;
  /** The pool ceiling actually used (poolMax or the trade's own top, padded). */
  ceiling: number;
  /** Which side the quality comparison favours. Null on a dead heat. */
  favoured: QualitySideKey | null;
}

export interface TradeBalanceResult extends TradeQualityResult {
  /**
   * False when no adjustment was applied: a one-for-one, a dead heat, or an
   * adjustment small enough to be noise. Effective totals equal raw totals.
   */
  applied: boolean;
  /**
   * Value of the hypothetical asset the trailing side would have to add before
   * the two sides score the same. Zero when nothing was applied.
   */
  balancingAsset: number;
  /** True when the solver hit its ceiling instead of converging. */
  capped: boolean;
  /** Points credited to the favoured side. Zero when nothing was applied. */
  adjustment: number;
  /** Raw total plus the adjustment, per side. What the verdict compares. */
  effective: Record<QualitySideKey, number>;
}

/** Bisection steps. 60 halvings resolves any realistic range to under a point. */
const SOLVER_STEPS = 60;

function positive(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The value the curve measures everything against.
 *
 * `poolMax` is the top of the relevant value pool (the most valuable player in
 * this format and source). When we do not have it, the trade's own best asset
 * stands in, which keeps the shape sane rather than pretending to a precision
 * we do not have.
 */
export function poolCeiling(
  poolMax: number | null,
  highestAsset: number,
  config: TradeQualityConfig,
): number {
  const base = Math.max(positive(poolMax ?? 0), positive(highestAsset), 1);
  return base + Math.max(0, config.poolPadding);
}

/** One asset's quality score, before any package discount. */
export function assetQuality(
  value: number,
  highestAsset: number,
  ceiling: number,
  config: TradeQualityConfig,
): number {
  const p = positive(value);
  if (p === 0) return 0;

  // Every coefficient here is admin-editable, and the ratios are all in (0, 1],
  // where a negative exponent means "get bigger as the asset gets smaller". That
  // inverts the whole model on a typo, so exponents floor at zero and the
  // multiplicative terms are clamped. A bad setting should make the curve dull,
  // never make it lie.
  const scaleExponent = Math.max(0, config.scaleExponent);
  const peakExponent = Math.max(0, config.peakExponent);

  const scaleRatio = Math.min(p / Math.max(ceiling, 1), 1);
  const scaleTerm = Math.max(0, config.scaleWeight) * Math.pow(scaleRatio, scaleExponent);

  const slack = Math.max(config.peakSlack, 1);
  const peakRatio = Math.min(p / Math.max(slack * positive(highestAsset), 1), 1);
  const peakTerm = Math.max(0, config.peakWeight) * Math.pow(peakRatio, peakExponent);

  const weight = Math.max(0, config.baseWeight) + scaleTerm + peakTerm;
  return Number.isFinite(weight) ? p * weight : 0;
}

function packageMultiplier(index: number, config: TradeQualityConfig): number {
  const list = config.packageMultipliers;
  if (!list || list.length === 0) return 1;
  const m = list[Math.min(index, list.length - 1)];
  return Number.isFinite(m) && m >= 0 ? m : 1;
}

/**
 * Score one side.
 *
 * Package pieces are ranked among themselves, best first, so the strongest
 * secondary asset keeps its full contribution and the tail is what fades. An
 * asset at or above the threshold never enters the sequence at all.
 */
export function sideQuality(
  values: number[],
  highestAsset: number,
  ceiling: number,
  config: TradeQualityConfig,
): QualitySide {
  const threshold = positive(highestAsset) * (config.packageThresholdPct / 100);
  const sorted = [...values].map(positive).sort((x, y) => y - x);

  const pieces: QualityPiece[] = [];
  let packageIndex = 0;
  let qualityTotal = 0;
  let rawTotal = 0;
  let discountedCount = 0;

  for (const value of sorted) {
    const quality = assetQuality(value, highestAsset, ceiling, config);
    const isPackagePiece = value < threshold;
    const multiplier = isPackagePiece ? packageMultiplier(packageIndex, config) : 1;
    if (isPackagePiece) packageIndex += 1;
    if (multiplier < 1) discountedCount += 1;

    const weighted = quality * multiplier;
    rawTotal += value;
    qualityTotal += weighted;
    pieces.push({ value, quality, multiplier, weighted, isPackagePiece });
  }

  return { rawTotal, qualityTotal, pieces, discountedCount };
}

/** Score both sides of a trade against each other. */
export function compareTradeQuality(
  valuesA: number[],
  valuesB: number[],
  poolMax: number | null,
  config: TradeQualityConfig,
): TradeQualityResult {
  const all = [...valuesA, ...valuesB].map(positive);
  const highestAsset = all.length > 0 ? Math.max(...all) : 0;
  const ceiling = poolCeiling(poolMax, highestAsset, config);

  const a = sideQuality(valuesA, highestAsset, ceiling, config);
  const b = sideQuality(valuesB, highestAsset, ceiling, config);

  const favoured: QualitySideKey | null =
    a.qualityTotal > b.qualityTotal ? "a" : b.qualityTotal > a.qualityTotal ? "b" : null;

  return { a, b, highestAsset, ceiling, favoured };
}

/**
 * How much the trailing side would have to add to draw level.
 *
 * The whole comparison is recomputed for every candidate, because adding an
 * asset can change which pieces count as package pieces and, if the candidate
 * is bigger than anything already in the deal, can move H itself. A closed-form
 * answer would have to ignore both.
 *
 * Bisection rather than anything cleverer: the gap grows monotonically as the
 * candidate grows, the range is bounded, and sixty halvings is exact enough for
 * a number we round before displaying.
 */
export function solveTradeBalance(
  valuesA: number[],
  valuesB: number[],
  poolMax: number | null,
  config: TradeQualityConfig,
): TradeBalanceResult {
  const base = compareTradeQuality(valuesA, valuesB, poolMax, config);
  const rawA = base.a.rawTotal;
  const rawB = base.b.rawTotal;
  const combined = rawA + rawB;

  const unadjusted: TradeBalanceResult = {
    ...base,
    applied: false,
    balancingAsset: 0,
    capped: false,
    adjustment: 0,
    effective: { a: rawA, b: rawB },
  };

  if (!base.favoured || combined <= 0) return unadjusted;

  // A one-for-one has no consolidation to price. The value gap between two
  // single players is already the whole story and charging a premium on top of
  // it would count the same difference twice.
  const largestSide = Math.max(valuesA.length, valuesB.length);
  if (largestSide < config.minAssetsForAdjustment) return unadjusted;

  const favoured = base.favoured;
  const trailing: QualitySideKey = favoured === "a" ? "b" : "a";
  const favouredValues = favoured === "a" ? valuesA : valuesB;
  const trailingValues = favoured === "a" ? valuesB : valuesA;
  const rawFavoured = favoured === "a" ? rawA : rawB;
  const rawTrailing = favoured === "a" ? rawB : rawA;

  /** Quality gap once the trailing side has been handed an asset worth x. */
  const gapWith = (x: number): number => {
    const probe = compareTradeQuality(
      favouredValues,
      x > 0 ? [...trailingValues, x] : trailingValues,
      poolMax,
      config,
    );
    return probe.b.qualityTotal - probe.a.qualityTotal;
  };

  if (gapWith(0) >= 0) return unadjusted;

  const ceilingX = Math.max(combined * (config.maxAdjustmentPct / 100), 1);
  let capped = false;
  let lo = 0;
  let hi = ceilingX;

  if (gapWith(hi) < 0) {
    capped = true;
    lo = hi;
  } else {
    for (let i = 0; i < SOLVER_STEPS; i += 1) {
      const mid = (lo + hi) / 2;
      if (gapWith(mid) < 0) lo = mid;
      else hi = mid;
    }
    lo = (lo + hi) / 2;
  }

  const balancingAsset = lo;
  const rawAdjustment = Math.max(0, rawTrailing + balancingAsset - rawFavoured);

  // Below the noise floor we apply nothing at all rather than applying a hidden
  // amount. A total that does not equal the sum of the assets above it is a bug
  // report waiting to happen, whatever the arithmetic says.
  const floor = combined * (config.displayThresholdPct / 100);
  if (rawAdjustment < floor) return unadjusted;

  const effective: Record<QualitySideKey, number> = { a: rawA, b: rawB };
  effective[favoured] = rawFavoured + rawAdjustment;

  return {
    ...base,
    applied: true,
    balancingAsset,
    capped,
    adjustment: rawAdjustment,
    effective,
  };
}

/**
 * What one package costs against another, in quality terms.
 *
 * Used by Trade Finder while it is still assembling offers: `ratio` under 1
 * means the outgoing package is weaker than what it is being offered for, which
 * is the shape of a lowball however well the raw values line up.
 */
export function qualityBalance(
  incoming: number[],
  outgoing: number[],
  poolMax: number | null,
  config: TradeQualityConfig,
): { incomingQuality: number; outgoingQuality: number; ratio: number } {
  const cmp = compareTradeQuality(incoming, outgoing, poolMax, config);
  const incomingQuality = cmp.a.qualityTotal;
  const outgoingQuality = cmp.b.qualityTotal;
  const ratio = incomingQuality > 0 ? outgoingQuality / incomingQuality : 0;
  return { incomingQuality, outgoingQuality, ratio };
}

/** Parse an admin-editable "1, 0.85, 0.7, 0.6" string into multipliers. */
export function parsePackageMultipliers(
  raw: string,
  fallback: number[] = DEFAULT_TRADE_QUALITY_CONFIG.packageMultipliers,
): number[] {
  const parsed = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
  return parsed.length > 0 ? parsed : [...fallback];
}
