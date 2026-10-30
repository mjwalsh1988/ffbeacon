/**
 * Market Signals: the Bollinger band math. Pure; no database, no clock.
 *
 * Plan of record: docs/team-blueprint/team-blueprint-plan.md section 5. The
 * algorithm's shape (30-day window, k = 2, five states, a 5% watch zone) is
 * the one dynasty-price-check used; everything else here is new. Nothing is
 * copied from that project's source.
 *
 * A SERIES is one player's market values for one (format, source), ONE POINT
 * PER UTC CALENDAR DAY. A day holding two history rows (the KTC backfill's
 * noon stamp beside a sync stamp) keeps the LATEST captured_at. A row's market
 * value is value minus formula_offset, the same figure lib/calculate-trends.ts
 * uses, so a source with a formula offset is measured on its market number.
 *
 * The WINDOW is the last `windowDays` CALENDAR days ending on the series'
 * latest day, so a missed night produces the same answer whenever the job
 * runs: the window reads days, not row counts.
 *
 * The player profile chart draws its band with `rollingBands` from this same
 * file, and the nightly job writes its row with `computeSignal`, so the chart
 * and the badge agree by construction. Bands are never stored per day.
 */

import type { MarketSignalSettings } from "./default-settings";
import { MIN_POINTS_FOR_BANDS } from "./default-settings";

export type SignalState =
  | "buy"
  | "watch_buy"
  | "hold"
  | "watch_sell"
  | "sell"
  | "baseline"
  | "thin";

/** The states that are a call; baseline and thin are not, and log no change. */
export const CALL_STATES: ReadonlySet<SignalState> = new Set([
  "buy",
  "watch_buy",
  "hold",
  "watch_sell",
  "sell",
]);

export type HistoryPoint = {
  value: number;
  formula_offset: number | null;
  captured_at: string;
};

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of an ISO timestamp in UTC. */
export function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Shift a "YYYY-MM-DD" day by n days (n may be negative). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The market number of one history row. */
export function marketValueOf(row: Pick<HistoryPoint, "value" | "formula_offset">): number {
  return Number(row.value) - Number(row.formula_offset ?? 0);
}

/**
 * Fold history rows into one market value per UTC day, latest captured_at of
 * each day winning. Returns a Map ordered by day ascending.
 */
export function collapseToDays(rows: readonly HistoryPoint[]): Map<string, number> {
  const best = new Map<string, { at: number; market: number }>();
  for (const row of rows) {
    const at = Date.parse(row.captured_at);
    if (!Number.isFinite(at)) continue;
    const day = utcDay(row.captured_at);
    const prev = best.get(day);
    if (!prev || at > prev.at) best.set(day, { at, market: marketValueOf(row) });
  }
  const days = [...best.keys()].sort();
  return new Map(days.map((d) => [d, best.get(d)!.market]));
}

export type Bands = {
  n: number;
  mean: number;
  /** Sample standard deviation (n - 1). Null when n < 2. */
  stdev: number | null;
  upper: number | null;
  lower: number | null;
  width: number | null;
};

/** Mean, sample stdev and the k-sigma band over a window's values. */
export function computeBands(values: readonly number[], k: number): Bands {
  const n = values.length;
  if (n === 0) return { n, mean: 0, stdev: null, upper: null, lower: null, width: null };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { n, mean, stdev: null, upper: null, lower: null, width: null };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const stdev = Math.sqrt(variance);
  const upper = mean + k * stdev;
  const lower = mean - k * stdev;
  return { n, mean, stdev, upper, lower, width: upper - lower };
}

/** Values of the window ending on `endDay` (inclusive), oldest first. */
export function windowValues(
  series: ReadonlyMap<string, number>,
  endDay: string,
  windowDays: number,
): number[] {
  const start = addDays(endDay, -(windowDays - 1));
  const out: number[] = [];
  for (const [day, v] of series) {
    if (day >= start && day <= endDay) out.push(v);
  }
  return out;
}

export type ClassifyInput = {
  latest: number;
  bands: Bands;
  points: number;
  prev: SignalState | null;
  thin: boolean;
  settings: Pick<MarketSignalSettings, "minPoints" | "watchPct" | "holdBackPct">;
};

/**
 * The five states, then hysteresis (plan 5.3). Boundaries are inclusive. A
 * player who crossed a band edge keeps the call until his value falls back
 * more than holdBackPct of the band width inside it, which is the one
 * deliberate change from the reference project, whose calls flipped daily
 * around a boundary.
 */
export function classifySignal(input: ClassifyInput): SignalState {
  const { latest, bands, points, prev, thin, settings } = input;
  if (thin) return "thin";
  const { upper, lower, width } = bands;
  if (upper === null || lower === null || width === null || width === 0) return "baseline";
  if (points < settings.minPoints) return "baseline";

  let signal: SignalState;
  if (latest >= upper) signal = "sell";
  else if (latest >= upper - settings.watchPct * width) signal = "watch_sell";
  else if (latest <= lower) signal = "buy";
  else if (latest <= lower + settings.watchPct * width) signal = "watch_buy";
  else signal = "hold";

  if (
    prev === "sell" &&
    (signal === "watch_sell" || signal === "hold") &&
    latest >= upper - settings.holdBackPct * width
  ) {
    signal = "sell";
  }
  if (
    prev === "buy" &&
    (signal === "watch_buy" || signal === "hold") &&
    latest <= lower + settings.holdBackPct * width
  ) {
    signal = "buy";
  }
  return signal;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export type SignalComputation = {
  asOfDay: string;
  marketValue: number;
  mean: number | null;
  stdev: number | null;
  upper: number | null;
  lower: number | null;
  bandPct: number | null;
  bandwidth: number | null;
  points: number;
  signal: SignalState;
};

export type ComputeSignalInput = {
  series: ReadonlyMap<string, number>;
  /** The run's reference day ("YYYY-MM-DD"), for the stale check. */
  runDay: string;
  prev: SignalState | null;
  /** Top market value in the partition on its latest day, for the thin floor. */
  topMarketValue: number;
  settings: Pick<
    MarketSignalSettings,
    "windowDays" | "k" | "watchPct" | "holdBackPct" | "minPoints" | "staleDays" | "floorPct"
  >;
};

/**
 * One player's signal row, or null when his series is stale (latest day more
 * than staleDays before the run day) or empty: a stale series writes nothing
 * and leaves the previous row alone.
 *
 * Bands are stored once at least MIN_POINTS_FOR_BANDS points exist, so the
 * profile can draw a faint band while the call still reads "baseline".
 */
export function computeSignal(input: ComputeSignalInput): SignalComputation | null {
  const { series, runDay, prev, topMarketValue, settings } = input;
  if (series.size === 0) return null;
  let latestDay = "";
  for (const day of series.keys()) if (day > latestDay) latestDay = day;
  if (daysBetween(latestDay, runDay) > settings.staleDays) return null;

  const latest = series.get(latestDay)!;
  const values = windowValues(series, latestDay, settings.windowDays);
  const bands = computeBands(values, settings.k);
  const storeBands = bands.n >= MIN_POINTS_FOR_BANDS && bands.width !== null;
  const thin = topMarketValue > 0 && latest < settings.floorPct * topMarketValue;
  const signal = classifySignal({ latest, bands, points: bands.n, prev, thin, settings });

  const bandPct =
    storeBands && bands.width! > 0 ? round3((latest - bands.lower!) / bands.width!) : null;
  const bandwidth =
    storeBands && bands.mean !== 0 ? round3(bands.width! / bands.mean) : null;

  return {
    asOfDay: latestDay,
    marketValue: round1(latest),
    mean: storeBands ? round1(bands.mean) : null,
    stdev: storeBands ? round1(bands.stdev!) : null,
    upper: storeBands ? round1(bands.upper!) : null,
    lower: storeBands ? round1(bands.lower!) : null,
    bandPct,
    bandwidth,
    points: bands.n,
    signal,
  };
}

/** Whether moving from prev to next is a logged state change. */
export function isLoggedChange(prev: SignalState | null, next: SignalState): boolean {
  return CALL_STATES.has(next) && prev !== next;
}

/** The day the current signal began: carried while unchanged, else today. */
export function signalSince(
  prev: SignalState | null,
  prevSince: string | null,
  next: SignalState,
  asOfDay: string,
): string {
  return prev === next && prevSince ? prevSince : asOfDay;
}

export type RollingBand = { day: string; upper: number; lower: number };

/**
 * The band per day for a chart: for every day with a value, the band over the
 * window ending that day, once `minPoints` points exist in it. Same window and
 * same arithmetic as computeSignal, so the last entry equals the cron's row
 * for the same series.
 */
export function rollingBands(
  series: ReadonlyMap<string, number>,
  settings: Pick<MarketSignalSettings, "windowDays" | "k" | "minPoints">,
): RollingBand[] {
  const out: RollingBand[] = [];
  for (const day of series.keys()) {
    const values = windowValues(series, day, settings.windowDays);
    if (values.length < settings.minPoints) continue;
    const bands = computeBands(values, settings.k);
    if (bands.upper === null || bands.lower === null) continue;
    out.push({ day, upper: round1(bands.upper), lower: round1(bands.lower) });
  }
  return out;
}
