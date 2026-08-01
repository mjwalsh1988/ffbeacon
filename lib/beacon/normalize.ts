/**
 * FF Beacon normalization (pure). Trimmed-P99 + median canonical curve +
 * quantile matching, per (position, format). See plan v3.1 section 4.
 *
 * Why: source value scales and curve shapes differ (KTC crowdsource, FC trades,
 * DP ECR-decay). Dividing by raw max is fragile (one glitch compresses everyone;
 * ceiling-alignment ignores shape). Instead:
 *   1. Winsorize each source above its P99 (kills single-glitch compression).
 *   2. Build a canonical 0..1 curve as the per-quantile MEDIAN across sources
 *      (robust to one odd source; preserves the consensus elite-tier gap).
 *   3. Map each player to the canonical value at their within-source quantile,
 *      so differently-shaped input curves align and disagreement collapses to
 *      genuine ranking disagreement.
 *   4. Blend mapped contributions across sources by weight; scale into the band.
 *
 * Below MIN_PLAYERS_FOR_QUANTILE players a source degrades to direct P99 scaling
 * and the player is flagged confidence_degraded.
 */

import type { ValueBand } from "./types";

export const GRID_SIZE = 101; // canonical curve sampled at q = 0, 0.01, ... 1.0

export interface SourcePlayerValue {
  playerId: string;
  value: number;
}

export interface NormalizeInput {
  bySource: Map<string, SourcePlayerValue[]>;
  weights: Map<string, number>; // source_value weight per source slug
  band: ValueBand;
  minPlayers: number;
}

export interface Contribution {
  source: string;
  rawValue: number;
  quantile: number;
  mappedScaled: number;
  thin: boolean;
  /**
   * Calibrated-path only (lib/beacon/calibrate.ts). Left undefined by
   * normalizeSlice so the quantile_median rollback path emits byte-identical
   * metadata to what it emitted before calibration existed.
   */
  calibratedScaled?: number;
  /** Calibrated-path only: was the raw value inside the fitted quantile range? */
  inFittedRange?: boolean;
  /** Calibrated-path only: how many players this source shares with the reference. */
  pairedWithReference?: number;
}

export interface NormalizedPlayer {
  playerId: string;
  value: number; // band-scaled blended
  scaled: number; // [0,1] blended
  degraded: boolean;
  contributions: Contribution[];
  /** Calibrated-path only: how many sources priced this player. */
  coverage?: number;
  /** Calibrated-path only: coverage <= 1. Metadata for the UI, never a discount. */
  lowConfidence?: boolean;
}

export interface SourceAudit {
  source: string;
  n: number;
  p99: number;
  qualified: boolean;
  ksBefore: number;
  ksAfter: number;
}

export interface NormalizeResult {
  players: Map<string, NormalizedPlayer>;
  audits: SourceAudit[];
  canonical: number[];
}

/** Percentile (0..100) of an ascending-sorted array, linear interpolation. */
export function percentileAsc(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

/** Value of a descending-sorted array at fractional position f in [0,1]. */
function interpDescAtFraction(sortedDesc: number[], f: number): number {
  const n = sortedDesc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedDesc[0];
  const pos = f * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedDesc[lo];
  return sortedDesc[lo] + (sortedDesc[hi] - sortedDesc[lo]) * (pos - lo);
}

/** Evaluate a curve sampled on a uniform [0,1] grid at q. */
function evalCurve(curve: number[], q: number): number {
  const g = curve.length;
  if (g === 0) return 0;
  if (g === 1) return curve[0];
  const pos = Math.min(1, Math.max(0, q)) * (g - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return curve[lo];
  return curve[lo] + (curve[hi] - curve[lo]) * (pos - lo);
}

/** Kolmogorov-Smirnov distance between two unsorted samples. */
export function ksDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  const all = [...as, ...bs].sort((x, y) => x - y);
  let d = 0;
  for (const v of all) {
    const ca = cdf(as, v);
    const cb = cdf(bs, v);
    d = Math.max(d, Math.abs(ca - cb));
  }
  return d;
}

function cdf(sortedAsc: number[], v: number): number {
  // fraction of samples <= v via binary search
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

export interface SourcePrep {
  source: string;
  n: number;
  p99: number;
  qualified: boolean;
  scaledDesc: number[]; // winsorized/p99, sorted desc
  scaledByPlayer: Map<string, number>;
  quantileByPlayer: Map<string, number>;
}

/**
 * Winsorize one source at its P99 and scale to [0,1], recording each player's
 * within-source quantile. Exported so the calibrated path (./calibrate.ts) reuses
 * the exact same outlier handling; its behaviour here is unchanged.
 */
export function prepSource(
  source: string,
  values: SourcePlayerValue[],
  minPlayers: number,
): SourcePrep {
  const sortedDesc = [...values].sort((x, y) => y.value - x.value);
  const n = sortedDesc.length;
  const asc = [...sortedDesc].map((v) => v.value).reverse();
  const p99 = percentileAsc(asc, 99);
  const denom = p99 > 0 ? p99 : 1;

  const scaledByPlayer = new Map<string, number>();
  const quantileByPlayer = new Map<string, number>();
  const scaledDesc: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = sortedDesc[i];
    const winsor = Math.min(row.value, p99);
    const scaled = Math.min(1, Math.max(0, winsor / denom));
    scaledByPlayer.set(row.playerId, scaled);
    quantileByPlayer.set(row.playerId, (i + 0.5) / n);
    scaledDesc.push(scaled);
  }
  return {
    source,
    n,
    p99,
    qualified: n >= minPlayers,
    scaledDesc,
    scaledByPlayer,
    quantileByPlayer,
  };
}

/** Normalize one (position, format) slice into band-scaled blended values. */
export function normalizeSlice(input: NormalizeInput): NormalizeResult {
  const { bySource, weights, band, minPlayers } = input;
  const preps: SourcePrep[] = [];
  for (const [source, values] of bySource) {
    if (values.length === 0) continue;
    preps.push(prepSource(source, values, minPlayers));
  }

  const qualified = preps.filter((p) => p.qualified);
  const curveSources = qualified.length > 0 ? qualified : preps; // degraded fallback

  // Canonical curve: per-grid-point median of each curve source's scaled value
  // at that quantile. Enforce monotonic non-increasing (q=0 is the top).
  const canonical: number[] = [];
  for (let g = 0; g < GRID_SIZE; g += 1) {
    const q = g / (GRID_SIZE - 1);
    const samples = curveSources.map((p) => interpDescAtFraction(p.scaledDesc, q));
    canonical.push(median(samples));
  }
  for (let g = 1; g < canonical.length; g += 1) {
    if (canonical[g] > canonical[g - 1]) canonical[g] = canonical[g - 1];
  }

  // Map + audit per source.
  const audits: SourceAudit[] = [];
  const mappedBySource = new Map<string, Map<string, number>>();
  const canonicalSample = canonical; // canonical value distribution reference
  for (const p of preps) {
    const mapped = new Map<string, number>();
    const useDirect = !p.qualified; // thin source -> direct scaling, no canonical map
    for (const [playerId, q] of p.quantileByPlayer) {
      const m = useDirect
        ? (p.scaledByPlayer.get(playerId) ?? 0)
        : evalCurve(canonical, q);
      mapped.set(playerId, m);
    }
    mappedBySource.set(p.source, mapped);

    const rawScaled = [...p.scaledByPlayer.values()];
    const mappedVals = [...mapped.values()];
    audits.push({
      source: p.source,
      n: p.n,
      p99: p.p99,
      qualified: p.qualified,
      ksBefore: ksDistance(rawScaled, canonicalSample),
      ksAfter: ksDistance(mappedVals, canonicalSample),
    });
  }

  // Blend across sources per player.
  const players = new Map<string, NormalizedPlayer>();
  const allPlayerIds = new Set<string>();
  for (const p of preps) for (const id of p.quantileByPlayer.keys()) allPlayerIds.add(id);

  for (const playerId of allPlayerIds) {
    const contributions: Contribution[] = [];
    let num = 0;
    let den = 0;
    let degraded = false;
    for (const p of preps) {
      const mapped = mappedBySource.get(p.source);
      const m = mapped?.get(playerId);
      if (m === undefined) continue;
      const w = weights.get(p.source) ?? 1;
      num += w * m;
      den += w;
      if (!p.qualified) degraded = true;
      contributions.push({
        source: p.source,
        rawValue: rawValueOf(bySource, p.source, playerId),
        quantile: p.quantileByPlayer.get(playerId) ?? 1,
        mappedScaled: m,
        thin: !p.qualified,
      });
    }
    if (den <= 0) continue;
    const scaled = num / den;
    players.set(playerId, {
      playerId,
      scaled,
      value: band.floor + scaled * (band.ceiling - band.floor),
      degraded,
      contributions,
    });
  }

  return { players, audits, canonical };
}

function rawValueOf(
  bySource: Map<string, SourcePlayerValue[]>,
  source: string,
  playerId: string,
): number {
  const list = bySource.get(source);
  if (!list) return 0;
  for (const r of list) if (r.playerId === playerId) return r.value;
  return 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
