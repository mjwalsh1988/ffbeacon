/**
 * FF Beacon calibrated normalization (pure). The alternative to the canonical
 * curve in ./normalize.ts, selected per format by the normalization_method
 * setting plus the calibration_format_slugs canary allowlist.
 *
 * WHY THIS EXISTS
 * The canonical-curve method indexes every source by its within-source quantile,
 * (i + 0.5) / n. The denominator is that source's own pool size, so a source
 * publishing 640 players and a source publishing 199 assign different quantiles
 * to players they agree about, purely because their lists are different lengths.
 * The blended value then moves when a source lengthens or shortens its catalog,
 * which is an artifact of the catalog rather than an opinion about the player.
 *
 * THE FIX
 * Fit each source onto one shared, stored scale instead of onto whatever the
 * other present sources look like today:
 *   1. A reference is built ONCE from the players every expected source ranks
 *      (buildSyntheticReference below). Restricting to the shared set is what
 *      removes list length from the math: every source prices exactly the same
 *      players, so no source's pool size can influence the scale.
 *   2. Each source is fitted onto that stored reference by quantile mapping over
 *      the players it shares with the reference (fitQuantileMap), sampled on a
 *      41-point grid.
 *   3. Every player's winsorized value is pushed through that map
 *      (applyQuantileMap) and blended by source weight exactly as before.
 * Because the reference is stored rather than recomputed, a source dropping out
 * for a night changes which opinions are averaged but does NOT change the scale
 * they are averaged on. That is the whole stability win.
 *
 * Single-source players get coverage metadata and NOTHING else. No discount, no
 * squeeze, no depth penalty: a short catalog at another source is not evidence
 * about this player, and re-encoding catalog length as a value penalty would
 * reintroduce the bias this module exists to remove.
 */

import { percentileAsc, prepSource, type Contribution, type NormalizedPlayer, type SourcePlayerValue } from "./normalize";
import type { ValueBand } from "./types";

/** Knots sampled when fitting a source onto the reference. */
export const CALIBRATION_GRID_POINTS = 41;

/**
 * A monotone piecewise-linear map from one source's winsorized [0,1] scale onto
 * the reference [0,1] scale. x and y are both non-decreasing and the same
 * length; x[0]/x[last] are the true observed extremes of the shared set, so the
 * endpoints anchor exactly rather than being clipped by a smoothing knot.
 */
export interface QuantileMap {
  x: number[];
  y: number[];
  /** Players used to fit (present in both the source and the reference). */
  paired: number;
}

export interface MappedValue {
  value: number;
  /** False when the input fell outside [x[0], x[last]] and had to be extrapolated. */
  inRange: boolean;
}

/**
 * Fit a source onto the reference by quantile mapping. sourceScaled[i] and
 * referenceScaled[i] must describe the SAME player; the arrays are sorted
 * independently, which is what makes this a distribution match rather than a
 * regression, so a handful of large per-player disagreements cannot tilt it.
 *
 * Returns null when fewer than two pairs exist (nothing to interpolate between).
 */
export function fitQuantileMap(
  sourceScaled: number[],
  referenceScaled: number[],
  gridPoints: number = CALIBRATION_GRID_POINTS,
): QuantileMap | null {
  const paired = Math.min(sourceScaled.length, referenceScaled.length);
  if (paired < 2) return null;
  const g = Math.max(2, Math.floor(gridPoints));

  const xs = [...sourceScaled].slice(0, paired).sort((a, b) => a - b);
  const ys = [...referenceScaled].slice(0, paired).sort((a, b) => a - b);

  const x: number[] = [];
  const y: number[] = [];
  for (let k = 0; k < g; k += 1) {
    const q = (k / (g - 1)) * 100;
    x.push(percentileAsc(xs, q));
    y.push(percentileAsc(ys, q));
  }
  // Guard against float noise reversing a knot pair. percentileAsc on an
  // ascending array is already monotone, so this only ever fixes rounding.
  for (let k = 1; k < g; k += 1) {
    if (x[k] < x[k - 1]) x[k] = x[k - 1];
    if (y[k] < y[k - 1]) y[k] = y[k - 1];
  }
  return { x, y, paired };
}

/**
 * Push one winsorized source value through a fitted map.
 *
 * Above the fitted range the result is clamped to the top knot: a source cannot
 * invent a value higher than the best player the reference has ever seen.
 *
 * Below the fitted range the result is squeezed proportionally toward zero along
 * the line from the origin to the bottom knot. Deep players a source ranks past
 * where the reference has any opinion therefore land BELOW the fitted minimum,
 * never above it, and never at a value the reference would recognise as real.
 * They keep their relative ordering.
 *
 * Ties in x are answered with the highest y at that x, so equal source values
 * always produce equal output (a tie carries no ordering information).
 */
export function applyQuantileMap(map: QuantileMap, value: number): MappedValue {
  const { x, y } = map;
  const last = x.length - 1;
  const xMin = x[0];
  const xMax = x[last];

  if (value >= xMax) return { value: y[last], inRange: value <= xMax };
  if (value <= xMin) {
    if (value === xMin) return { value: y[0], inRange: true };
    const squeezed = xMin > 0 ? y[0] * (value / xMin) : y[0];
    return { value: Math.min(y[0], Math.max(0, squeezed)), inRange: false };
  }

  // Last knot whose x is <= value. x is non-decreasing so a linear scan from the
  // upper end resolves ties to the highest matching index.
  let hi = last;
  while (hi > 0 && x[hi - 1] > value) hi -= 1;
  const lo = hi - 1;
  const span = x[hi] - x[lo];
  if (span <= 0) return { value: y[hi], inRange: true };
  const t = (value - x[lo]) / span;
  return { value: y[lo] + (y[hi] - y[lo]) * t, inRange: true };
}

export interface CalibrationAudit {
  source: string;
  n: number;
  p99: number;
  /** Players shared with the reference, i.e. how much evidence the fit had. */
  paired: number;
  /** False when the source had too few paired players and fell back to P99 scaling. */
  fitted: boolean;
  fittedMin: number | null;
  fittedMax: number | null;
  belowRange: number;
  aboveRange: number;
}

export interface CalibrateInput {
  bySource: Map<string, SourcePlayerValue[]>;
  /** source_value weight per source slug. */
  weights: Map<string, number>;
  band: ValueBand;
  /** Minimum players for a source to be fitted rather than degraded. */
  minPlayers: number;
  /** playerId -> reference_scaled in [0,1], from the stored active reference. */
  reference: Map<string, number>;
  gridPoints?: number;
}

export interface CalibrateResult {
  players: Map<string, NormalizedPlayer>;
  audits: CalibrationAudit[];
  referenceSize: number;
}

/**
 * Normalize one (position, format) slice against a stored reference.
 *
 * Output shape matches normalizeSlice so the orchestrator's downstream handling
 * (combine, bands, overrides, rounding) is identical either way. The only
 * additions are optional diagnostic fields the quantile_median path leaves unset.
 *
 * A source sharing fewer than minPlayers players with the reference cannot be
 * fitted; it degrades to its own P99 scaling and is flagged thin + degraded,
 * mirroring how normalizeSlice treats a source too small for quantile matching.
 * That degradation is per source and always visible in the audit, never a silent
 * substitution of a different reference.
 */
export function calibrateSlice(input: CalibrateInput): CalibrateResult {
  const { bySource, weights, band, minPlayers, reference } = input;
  const gridPoints = input.gridPoints ?? CALIBRATION_GRID_POINTS;

  const audits: CalibrationAudit[] = [];
  const calibratedBySource = new Map<string, Map<string, MappedValue>>();
  const thinSources = new Set<string>();
  const pairedBySource = new Map<string, number>();
  const rawBySource = new Map<string, Map<string, number>>();
  const quantileBySource = new Map<string, Map<string, number>>();

  for (const [source, values] of bySource) {
    if (values.length === 0) continue;
    const prep = prepSource(source, values, minPlayers);
    quantileBySource.set(source, prep.quantileByPlayer);
    const raw = new Map<string, number>();
    for (const v of values) raw.set(v.playerId, v.value);
    rawBySource.set(source, raw);

    // Pair the source against the reference, in a deterministic player order so
    // an identical input always fits an identical map.
    const sharedIds = [...prep.scaledByPlayer.keys()]
      .filter((id) => reference.has(id))
      .sort();
    const xs = sharedIds.map((id) => prep.scaledByPlayer.get(id) ?? 0);
    const ys = sharedIds.map((id) => reference.get(id) ?? 0);
    pairedBySource.set(source, sharedIds.length);

    const map = sharedIds.length >= minPlayers ? fitQuantileMap(xs, ys, gridPoints) : null;
    const out = new Map<string, MappedValue>();
    let below = 0;
    let above = 0;

    if (map) {
      for (const [playerId, scaled] of prep.scaledByPlayer) {
        const m = applyQuantileMap(map, scaled);
        if (!m.inRange) {
          if (scaled > map.x[map.x.length - 1]) above += 1;
          else below += 1;
        }
        out.set(playerId, m);
      }
    } else {
      thinSources.add(source);
      for (const [playerId, scaled] of prep.scaledByPlayer) {
        out.set(playerId, { value: scaled, inRange: true });
      }
    }
    calibratedBySource.set(source, out);

    audits.push({
      source,
      n: prep.n,
      p99: prep.p99,
      paired: sharedIds.length,
      fitted: map !== null,
      fittedMin: map ? map.x[0] : null,
      fittedMax: map ? map.x[map.x.length - 1] : null,
      belowRange: below,
      aboveRange: above,
    });
  }

  // A per-source degradation is tolerable and visible. Every source degrading is
  // not: the blend would then be raw P99 scaling with no reference involved at
  // all, which is the uncalibrated board wearing the calibrated label. Refuse,
  // and let the caller abort the run before it writes anything.
  if (audits.length > 0 && audits.every((a) => !a.fitted)) {
    throw new Error(
      `Calibration failed: no source shares at least ${minPlayers} players with the reference (${reference.size} players). Sources: ${audits.map((a) => `${a.source} ${a.paired} paired`).join(", ")}. Refusing to publish an uncalibrated board as calibrated.`,
    );
  }

  const players = new Map<string, NormalizedPlayer>();
  const allPlayerIds = new Set<string>();
  for (const out of calibratedBySource.values()) {
    for (const id of out.keys()) allPlayerIds.add(id);
  }

  for (const playerId of allPlayerIds) {
    const contributions: Contribution[] = [];
    let num = 0;
    let den = 0;
    let degraded = false;
    for (const [source, out] of calibratedBySource) {
      const m = out.get(playerId);
      if (m === undefined) continue;
      const w = weights.get(source) ?? 1;
      num += w * m.value;
      den += w;
      const thin = thinSources.has(source);
      if (thin) degraded = true;
      contributions.push({
        source,
        rawValue: rawBySource.get(source)?.get(playerId) ?? 0,
        quantile: quantileBySource.get(source)?.get(playerId) ?? 1,
        mappedScaled: m.value,
        thin,
        calibratedScaled: m.value,
        inFittedRange: m.inRange,
        pairedWithReference: pairedBySource.get(source) ?? 0,
      });
    }
    if (den <= 0) continue;
    const scaled = num / den;
    const coverage = contributions.length;
    players.set(playerId, {
      playerId,
      scaled,
      value: band.floor + scaled * (band.ceiling - band.floor),
      degraded,
      contributions,
      coverage,
      // Metadata only. The value above is NOT touched by coverage.
      lowConfidence: coverage <= 1,
    });
  }

  return { players, audits, referenceSize: reference.size };
}

export interface ReferenceSourceDiagnostic {
  source: string;
  /** Players this source publishes for the format. */
  n: number;
  p99: number;
}

export interface SyntheticReference {
  /** playerId -> reference_scaled in [0,1], top player anchored at 1. */
  values: Map<string, number>;
  /** Deterministically ordered ids the reference was built from. */
  sharedPlayers: string[];
  diagnostics: ReferenceSourceDiagnostic[];
}

export interface BuildReferenceInput {
  /** EXPECTED sources only. Every one of them must be present and fresh. */
  bySource: Map<string, SourcePlayerValue[]>;
  minShared: number;
}

/**
 * Build the synthetic consensus reference for one format.
 *
 * Only players every expected source ranks are eligible. That intersection is
 * the point: with an identical player set at every source, no source's catalog
 * length can influence the resulting scale.
 *
 * Each source is winsorized at its own P99 WITHIN the shared set and scaled to
 * [0,1]; the reference is the per-player median of those scaled values, then
 * anchored so the top player sits at 1. Taking the median rather than the mean
 * keeps one eccentric source from dragging the curve, and taking values rather
 * than ranks preserves the real gap between the elite tier and everyone else,
 * which a pure rank consensus would flatten.
 *
 * Returns null when the shared set is smaller than minShared. The caller must
 * treat that as a refusal to build, never as a reason to build something weaker.
 */
export function buildSyntheticReference(input: BuildReferenceInput): SyntheticReference | null {
  const { bySource, minShared } = input;
  const sources = [...bySource.entries()].filter(([, v]) => v.length > 0);
  if (sources.length === 0) return null;

  let shared: string[] = sources[0][1].map((v) => v.playerId);
  for (let i = 1; i < sources.length; i += 1) {
    const ids = new Set(sources[i][1].map((v) => v.playerId));
    shared = shared.filter((id) => ids.has(id));
  }
  const sharedPlayers = [...new Set(shared)].sort();
  if (sharedPlayers.length < minShared) return null;

  const diagnostics: ReferenceSourceDiagnostic[] = [];
  const scaledBySource: Array<Map<string, number>> = [];

  for (const [source, values] of sources) {
    const byPlayer = new Map(values.map((v) => [v.playerId, v.value]));
    const asc = sharedPlayers.map((id) => byPlayer.get(id) ?? 0).sort((a, b) => a - b);
    const p99 = percentileAsc(asc, 99);
    const denom = p99 > 0 ? p99 : 1;
    const scaled = new Map<string, number>();
    for (const id of sharedPlayers) {
      const v = byPlayer.get(id) ?? 0;
      scaled.set(id, Math.min(1, Math.max(0, Math.min(v, p99) / denom)));
    }
    scaledBySource.push(scaled);
    diagnostics.push({ source, n: values.length, p99 });
  }

  const values = new Map<string, number>();
  let max = 0;
  for (const id of sharedPlayers) {
    const m = median(scaledBySource.map((s) => s.get(id) ?? 0));
    values.set(id, m);
    if (m > max) max = m;
  }
  if (max > 0 && max !== 1) {
    for (const id of sharedPlayers) values.set(id, (values.get(id) ?? 0) / max);
  }

  return { values, sharedPlayers, diagnostics };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
