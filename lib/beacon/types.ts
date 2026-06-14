/**
 * FF Beacon signal pipeline core types.
 *
 * Every input to the engine is a Signal: a typed, weighted, confidence-scaled
 * contribution toward one player's FF Beacon value in one format. Producers
 * (source_value, stat_value, stat_performance, manual, ai_adjust) all emit this
 * shape; the engine combines them. See plan v3.1 section 3.
 */

export type SignalType =
  | "source_value"
  | "stat_value"
  | "stat_performance"
  | "manual"
  | "ai_adjust";

export type SignalKind = "base" | "adjustment" | "override";

export interface BeaconSignal {
  type: SignalType;
  playerId: string;
  formatConfigId: string | null; // null = applies to all formats
  kind: SignalKind;
  /** base/override: a value already normalized into the position+format band. */
  value?: number;
  /** adjustment: a proportional nudge, e.g. +0.08 = up 8%. */
  adjustmentPct?: number;
  /** manual override only: true => formula-induced, excluded from trend math. */
  silent?: boolean;
  weight: number;
  confidence: number;
  meta?: Record<string, unknown>;
}

/** A resolved per-position value band. */
export interface ValueBand {
  floor: number;
  ceiling: number;
}

export const SOURCE_SLUG = "ffbeacon" as const;
