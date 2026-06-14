/**
 * FF Beacon engine core (pure). No DB access, so every branch is unit-testable.
 *
 * Combines base signals (weighted average), adjustment signals (bounded factor),
 * and an optional manual override (short-circuit) into a published value plus a
 * formula_offset that keeps silent manual changes out of the trend math.
 * See plan v3.1 sections 3b, 3c, 7.
 */

import type { ValueBand } from "./types";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Weighted average with a hard floor-safety guard. Returns null for an empty
 * set or all-zero weights, so the caller SKIPS the player rather than writing a
 * 0 or NaN. A single surviving item returns its value exactly. Plan v3.1, 3b/3c.
 */
export function weightedAverage(
  items: Array<{ value: number; weight: number }>,
): number | null {
  if (items.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const it of items) {
    num += it.weight * it.value;
    den += it.weight;
  }
  if (den <= 0) return null;
  return num / den;
}

export interface BaseInput {
  value: number; // already normalized into the band
  weight: number;
}

export interface AdjustInput {
  adjustmentPct: number;
  weight: number;
  confidence: number;
}

export interface OverrideInput {
  /** 'multiplier' | 'delta' | 'set_value'. set_value short-circuits base/factor. */
  type: "multiplier" | "delta" | "set_value";
  magnitude: number;
  silent: boolean;
}

export interface CombineParams {
  baseInputs: BaseInput[];
  adjustInputs: AdjustInput[];
  /** Manual overrides applied as the silent/true-signal layer (may be empty). */
  overrides: OverrideInput[];
  band: ValueBand;
  factorMin: number;
  factorMax: number;
}

export interface CombineResult {
  /** Stored in player_value_history.value. Reflects overrides (display worth). */
  published: number;
  /** What trends consume (published - formulaOffset). Silent overrides excluded. */
  market: number;
  /** published - market. Non-zero only when a silent override moved the value. */
  formulaOffset: number;
  factorSaturated: boolean;
  /** Diagnostics for the metadata breakdown. */
  base: number | null;
  rawFactor: number;
  factor: number;
}

/**
 * Combine signals for one (player, format). Returns null to SKIP the player
 * (no base signal survived) so the prior Beacon row stands; never emits 0/null.
 *
 * Override precedence: a set_value override short-circuits base/factor entirely.
 * multiplier/delta overrides apply on top of base*factor. The silent flag splits
 * the result into market (trend-basis, silent excluded) and published (display,
 * silent included); formulaOffset = published - market.
 */
export function combine(params: CombineParams): CombineResult | null {
  const { baseInputs, adjustInputs, overrides, band, factorMin, factorMax } = params;

  const setValue = lastOf(overrides, (o) => o.type === "set_value");
  const nonSetOverrides = overrides.filter((o) => o.type !== "set_value");

  // marketValue = the trend-basis value: base*factor plus true-signal overrides,
  // silent overrides excluded. publishedValue = marketValue plus silent overrides.
  let marketValue: number;
  let publishedValue: number;
  let baseDiag: number | null = null;
  let rawFactor = 1;
  let factor = 1;
  let saturated = false;

  if (setValue) {
    // Absolute override short-circuits base/factor. A true-signal set_value moves
    // the market (shows as movement); a silent set_value moves only published.
    const target = clamp(setValue.magnitude, band.floor, band.ceiling);
    if (setValue.silent) {
      // market stays at what base*factor would produce (so trends ignore the set).
      const computed = computeBaseFactor(
        baseInputs,
        adjustInputs,
        nonSetOverrides,
        band,
        factorMin,
        factorMax,
      );
      if (computed === null) return null; // no base to anchor the silent market
      marketValue = computed.value;
      baseDiag = computed.base;
      rawFactor = computed.rawFactor;
      factor = computed.factor;
      saturated = computed.saturated;
      publishedValue = target;
    } else {
      marketValue = target;
      publishedValue = target;
    }
  } else {
    const computed = computeBaseFactor(
      baseInputs,
      adjustInputs,
      [],
      band,
      factorMin,
      factorMax,
    );
    if (computed === null) return null; // floor safety: skip, never write 0/null
    baseDiag = computed.base;
    rawFactor = computed.rawFactor;
    factor = computed.factor;
    saturated = computed.saturated;

    // Split overrides into silent and true-signal, apply each multiplicatively
    // or additively. true-signal -> market+published; silent -> published only.
    marketValue = applyOverrides(
      computed.value,
      nonSetOverrides.filter((o) => !o.silent),
      band,
    );
    publishedValue = applyOverrides(
      marketValue,
      nonSetOverrides.filter((o) => o.silent),
      band,
    );
  }

  const formulaOffset = publishedValue - marketValue;
  return {
    published: publishedValue,
    market: marketValue,
    formulaOffset,
    factorSaturated: saturated,
    base: baseDiag,
    rawFactor,
    factor,
  };
}

function computeBaseFactor(
  baseInputs: BaseInput[],
  adjustInputs: AdjustInput[],
  trueSignalOverrides: OverrideInput[],
  band: ValueBand,
  factorMin: number,
  factorMax: number,
): { value: number; base: number; rawFactor: number; factor: number; saturated: boolean } | null {
  const base = weightedAverage(baseInputs);
  if (base === null) return null;

  let rawFactor = 1;
  for (const a of adjustInputs) {
    rawFactor += a.weight * a.confidence * a.adjustmentPct;
  }
  const factor = clamp(rawFactor, factorMin, factorMax);
  const saturated = factor !== rawFactor;

  let value = clamp(base * factor, band.floor, band.ceiling);
  value = applyOverrides(value, trueSignalOverrides, band);
  return { value, base, rawFactor, factor, saturated };
}

function applyOverrides(
  value: number,
  overrides: OverrideInput[],
  band: ValueBand,
): number {
  let v = value;
  for (const o of overrides) {
    if (o.type === "multiplier") v = v * o.magnitude;
    else if (o.type === "delta") v = v + o.magnitude;
  }
  return clamp(v, band.floor, band.ceiling);
}

function lastOf<T>(items: T[], pred: (t: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (pred(items[i])) return items[i];
  }
  return undefined;
}
