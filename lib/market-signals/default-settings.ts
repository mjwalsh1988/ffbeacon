/**
 * Code defaults for Market Signals (plan section 5.8).
 *
 * What the nightly engine runs on when market_signal_settings is missing,
 * empty or older than the schema. Changing windowDays or k changes every row
 * on the next run; the admin page says so beside those two fields.
 * modelVersion is stored on every signal row.
 */

export interface MarketSignalSettings {
  /** Calendar days in the band window. */
  windowDays: number;
  /** Band half-width in sample standard deviations. */
  k: number;
  /** Share of the band width that counts as "near" a band edge. */
  watchPct: number;
  /** Share of the band width a value must fall back inside before a buy or sell clears. */
  holdBackPct: number;
  /** Days with a value required inside the window before a call is made. */
  minPoints: number;
  /** A series whose latest day is older than this many days is skipped. */
  staleDays: number;
  /** Days of history read per partition (window plus slack for gaps). */
  lookbackDays: number;
  /** A value under this share of the partition's top value is a thin market. */
  floorPct: number;
  enabled: boolean;
  modelVersion: number;
}

export const DEFAULT_MARKET_SIGNAL_SETTINGS: MarketSignalSettings = {
  windowDays: 30,
  k: 2.0,
  watchPct: 0.05,
  holdBackPct: 0.1,
  minPoints: 24,
  staleDays: 3,
  lookbackDays: 45,
  floorPct: 0.05,
  enabled: true,
  modelVersion: 1,
};

/** Bands still stored (for the faint profile band) once this many points exist. */
export const MIN_POINTS_FOR_BANDS = 10;

/** A partition with fewer priced players than this on its latest day is skipped. */
export const MIN_PARTITION_PLAYERS = 25;
