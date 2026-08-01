/**
 * Small numeric helpers for the Power Pulse engine.
 *
 * The random number generator is seeded and deterministic on purpose: the same
 * roster state must produce the same playoff odds on every recompute, otherwise
 * a page reload would show the number drifting for no reason a user can see.
 */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (values.length - 1));
}

/**
 * Cumulative distribution of the standard normal, via the Abramowitz and Stegun
 * 7.1.26 error function approximation. Accurate to about 1.5e-7, which is far
 * beyond what a win probability needs.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a team scoring `meanA` with spread `sigmaA` outscores a team
 * scoring `meanB` with spread `sigmaB`. Treats the two weekly totals as
 * independent normals, so the difference is normal with the summed variance.
 *
 * Independence is a simplification. Two teams in the same league can share a
 * player only in the sense of facing the same NFL defenses, and the effect on a
 * head-to-head is second order.
 */
export function winProbability(
  meanA: number,
  sigmaA: number,
  meanB: number,
  sigmaB: number,
): number {
  const combined = Math.sqrt(sigmaA * sigmaA + sigmaB * sigmaB);
  if (combined <= 0) {
    if (meanA === meanB) return 0.5;
    return meanA > meanB ? 1 : 0;
  }
  return normalCdf((meanA - meanB) / combined);
}

/** Deterministic 32-bit generator (mulberry32). Same seed, same season. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One draw from a normal distribution using the Box-Muller transform. Clamped
 * at zero because a fantasy team cannot score negative points in practice.
 */
export function normalDraw(rng: () => number, m: number, sigma: number): number {
  if (sigma <= 0) return Math.max(0, m);
  let u = rng();
  if (u <= 0) u = Number.EPSILON;
  const v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0, m + z * sigma);
}

/**
 * Convert raw values into within-league z-scores. A league where every team is
 * nearly identical gets all zeros rather than a magnified ranking of noise.
 */
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = stdev(values);
  if (sd <= 1e-9) return values.map(() => 0);
  return values.map((v) => (v - m) / sd);
}

/**
 * Map a within-league z-score onto the display scale.
 *
 * We use the normal percentile rather than a straight linear stretch of the
 * z-score. A linear map leaves the best team in a twelve-team league sitting
 * around 65, which does not read like a power score: users expect the league's
 * strongest roster to be near the top of the scale. Running the z-score through
 * the normal CDF puts an average team at 50, a clearly-best team in the high
 * 80s, and a clearly-worst team in single digits, while still preserving
 * magnitude, since a team barely above average lands at 55 rather than 85.
 *
 * `sharpness` scales the z-score before the percentile, so an admin can make
 * the scale more or less punishing without touching the model itself.
 */
export function zToDisplay(
  z: number,
  opts: { min: number; max: number; sharpness: number },
): number {
  const percentile = normalCdf(z * (opts.sharpness || 1));
  return clamp(Math.round(opts.min + (opts.max - opts.min) * percentile), opts.min, opts.max);
}

/**
 * Rank an array descending, 1 = highest. Ties take the same rank, and the next
 * distinct value skips accordingly (standard competition ranking).
 */
export function rankDescending(values: (number | null)[]): (number | null)[] {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .filter((e): e is { value: number; index: number } => e.value !== null && Number.isFinite(e.value));
  indexed.sort((a, b) => b.value - a.value);

  const out: (number | null)[] = values.map(() => null);
  let lastValue: number | null = null;
  let lastRank = 0;
  indexed.forEach((entry, i) => {
    const rank = lastValue !== null && entry.value === lastValue ? lastRank : i + 1;
    out[entry.index] = rank;
    lastValue = entry.value;
    lastRank = rank;
  });
  return out;
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
