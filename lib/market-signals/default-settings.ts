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
  /**
   * The narrowest band, as band width over the mean, that can carry a call.
   * A price that barely moves for a month has a band a few points wide, and a
   * one-point tick then reads as a sell. Under this width the call is hold.
   */
  minBandwidth: number;
  /**
   * Days between a source's updates, by source slug; a source not listed
   * updates daily. A weekly source has about four points in a 30-day window,
   * so its window, required points, band points and stale days scale by this
   * (sourceRules below).
   */
  cadenceDays: Record<string, number>;
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
  minBandwidth: 0.04,
  cadenceDays: { dynastyprocess: 7 },
  enabled: true,
  modelVersion: 2,
};

/** Bands still stored (for the faint profile band) once this many points exist. */
export const MIN_POINTS_FOR_BANDS = 10;

/** No source gets a call on fewer points than this, whatever its cadence. */
export const MIN_POINTS_FLOOR = 3;

/** A slower source's window holds at least this many of its updates. */
export const MIN_WINDOW_UPDATES = 12;

export type SourceRules = {
  cadenceDays: number;
  /** Calendar days in this source's band window. */
  windowDays: number;
  /** Days of history read for this source. */
  lookbackDays: number;
  /** Points required in the window before a call. */
  minPoints: number;
  /** Points required before bands are stored for the profile. */
  minBandPoints: number;
  /** A series (or a stored row) older than this many days is no signal. */
  staleDays: number;
};

/**
 * The per-source reading of the settings. A daily source reads the settings
 * as written. A source that updates every N days gets a window long enough to
 * hold MIN_WINDOW_UPDATES of its updates (a 30-day window holds four weekly
 * points, and a two-sigma band over four points can never be crossed), the
 * required points scaled to what that window can hold, and N - 1 more days
 * before its latest value counts as stale, so its rows do not expire between
 * updates.
 */
export function sourceRules(
  settings: Pick<MarketSignalSettings, "minPoints" | "staleDays" | "cadenceDays"> &
    Partial<Pick<MarketSignalSettings, "windowDays" | "lookbackDays">>,
  source: string,
): SourceRules {
  const baseWindow = settings.windowDays ?? DEFAULT_MARKET_SIGNAL_SETTINGS.windowDays;
  const baseLookback = settings.lookbackDays ?? DEFAULT_MARKET_SIGNAL_SETTINGS.lookbackDays;
  const raw = settings.cadenceDays?.[source];
  const cadence = typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  if (cadence === 1) {
    return {
      cadenceDays: 1,
      windowDays: baseWindow,
      lookbackDays: baseLookback,
      minPoints: settings.minPoints,
      minBandPoints: MIN_POINTS_FOR_BANDS,
      staleDays: settings.staleDays,
    };
  }
  const windowDays = Math.max(baseWindow, cadence * MIN_WINDOW_UPDATES);
  // Points the window can hold, as a share of what the daily window holds.
  const scale = windowDays / baseWindow / cadence;
  return {
    cadenceDays: cadence,
    windowDays,
    lookbackDays: baseLookback + (windowDays - baseWindow),
    minPoints: Math.max(MIN_POINTS_FLOOR, Math.ceil(settings.minPoints * scale)),
    minBandPoints: Math.max(MIN_POINTS_FLOOR, Math.ceil(MIN_POINTS_FOR_BANDS * scale)),
    staleDays: settings.staleDays + cadence - 1,
  };
}

/** A partition with fewer priced players than this on its latest day is skipped. */
export const MIN_PARTITION_PLAYERS = 25;
