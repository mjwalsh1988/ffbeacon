/**
 * Weather forecast adapter: the forecast for one NFL game's kickoff hour and
 * the three hours after it, from one of two free providers.
 *
 * This is the ONLY file allowed to name api.weather.gov or api.met.no, the same
 * rule lib/sleeper.ts follows for Sleeper and lib/nfl-odds.ts for ESPN.
 * lib/nfl-weather-host-guard.test.ts fails the suite on any other file that
 * does.
 *
 * PROVIDERS
 *
 * National Weather Service (api.weather.gov), every US venue. Public domain, no
 * key. Three documents:
 *   /points/{lat},{lon}                 which forecast office and grid cell a
 *                                       coordinate falls in. One lookup per
 *                                       stadium, cached on nfl_stadiums by the
 *                                       sync and re-checked monthly.
 *   /gridpoints/{o}/{x},{y}/forecast/hourly
 *                                       156 hourly periods: temperature (F),
 *                                       wind speed ("10 mph"), wind direction
 *                                       ("NW"), precipitation probability,
 *                                       humidity and a short description.
 *   /gridpoints/{o}/{x},{y}             the raw grid layers, metric, each a
 *                                       list of {validTime, value} RUNS. A run
 *                                       is "2026-10-04T18:00:00+00:00/PT6H":
 *                                       a start and an ISO 8601 duration. Gust,
 *                                       apparent temperature, wind direction in
 *                                       degrees, rain and snow amounts are only
 *                                       here.
 *
 * MET Norway Locationforecast 2.0 (api.met.no), every venue abroad. NLOD 2.0
 * and CC BY 4.0, which need the credit exported below as
 * MET_NORWAY_ATTRIBUTION. One document, hourly for about 60 hours and
 * six-hourly after that. Outside the Nordic region it publishes NO gust and NO
 * precipitation probability, and it never publishes a snowfall amount, so
 * those three figures are null on its forecasts.
 *
 * Both identify a caller by User-Agent, and both act on it: MET Norway answers
 * a generic one with 403. The header names the site and a contact address.
 *
 * THE GAME WINDOW is the clock hour kickoff falls in plus the three after it.
 * A 4:25 PM kickoff reads the 4, 5, 6 and 7 PM hours. temp, feels-like,
 * sustained wind, direction, humidity and the description are the kickoff
 * hour's. Gust, the highest sustained wind and precipitation probability are
 * the worst of the window; rain and snow are summed across it.
 *
 * RUNS BECOME HOURS TWO WAYS. A state (temperature, gust) holds for every hour
 * of its run. An AMOUNT (rain, snow) is a total for the run, so it is spread
 * evenly: 2.54 mm over a six-hour run is 0.42 mm in each hour. Nothing says
 * which of the six hours the rain falls in, and an even spread is the only
 * reading that does not invent that. The same applies to a MET Norway
 * six-hour step.
 *
 * FAILURE POSTURE. A fetch helper never throws. It returns null when the
 * request failed (timeout, non-2xx, oversized or unparseable body), after one
 * retry five seconds later for a 429 or a 5xx. The two provider functions
 * return a status rather than a bare null because "the request failed" and
 * "the provider answered and has not published that hour yet" are different
 * facts: the first is retried and counted as a failure, the second is a game
 * beyond the forecast horizon and is nobody's outage. The pure parsers return
 * null for the second case only.
 */

import { SITE } from "./site";

const NWS_BASE_URL = "https://api.weather.gov";
const MET_NORWAY_FORECAST_URL = "https://api.met.no/weatherapi/locationforecast/2.0/complete";

const DEFAULT_TIMEOUT_MS = 20_000;

/** One retry, this long after a 429 or a 5xx. */
const RETRY_DELAY_MS = 5_000;

/** The gridpoints document is about 200 KB; nothing here is near this. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const HOUR_MS = 3_600_000;

/** Kickoff hour plus the three after it. */
export const GAME_WINDOW_HOURS = 4;

/** The credit MET Norway's licence asks for, and where it links. */
export const MET_NORWAY_ATTRIBUTION = "Weather data from MET Norway";
export const MET_NORWAY_ATTRIBUTION_URL = "https://api.met.no/";

/** National Weather Service data is public domain; the credit is a courtesy. */
export const NWS_ATTRIBUTION = "Weather data from the National Weather Service";
export const NWS_ATTRIBUTION_URL = "https://www.weather.gov/";

export type WeatherProvider = "nws" | "met-norway";

/** A National Weather Service forecast grid cell. */
export type NwsGrid = { office: string; gridX: number; gridY: number };

/** What a provider needs to know about a venue. */
export type WeatherStadium = {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  /** The cached grid cell for a US venue. Null means look it up. */
  nwsGrid: NwsGrid | null;
};

/**
 * One game's forecast, in the units and column names of nfl_game_weather so
 * the sync can spread it straight into a row. Any figure the provider did not
 * publish is null, never zero.
 */
export type KickoffForecast = {
  provider: WeatherProvider;
  /** Kickoff hour, Fahrenheit. */
  temp_f: number | null;
  /** Kickoff hour apparent temperature, Fahrenheit. */
  feels_like_f: number | null;
  /** Sustained wind at kickoff, miles per hour. */
  wind_mph: number | null;
  /** Highest gust across the window. */
  wind_gust_mph: number | null;
  /** Direction the wind blows FROM at kickoff, whole degrees, 0 to 359. */
  wind_dir_deg: number | null;
  /** Highest sustained wind across the window. */
  wind_mph_max_3h: number | null;
  /** Highest precipitation probability across the window, percent. */
  precip_prob_pct: number | null;
  /** Liquid precipitation summed across the window, inches. */
  precip_in: number | null;
  /** Snowfall summed across the window, inches. */
  snow_in: number | null;
  /** Kickoff hour relative humidity, percent. */
  humidity_pct: number | null;
  /** Short description of the kickoff hour. */
  conditions: string | null;
  /** The provider's own entries for the window, verbatim, for metadata. */
  hourly: unknown;
};

export type KickoffForecastResult =
  | { status: "ok"; forecast: KickoffForecast }
  /** The provider answered and has not published the kickoff hour. */
  | { status: "outside-horizon" }
  /** A request failed. Says nothing about the weather. */
  | { status: "failed" };

// ---------------------------------------------------------------------------
// Unit conversions. Pure and unrounded; rounding happens once, on the way into
// a forecast.
// ---------------------------------------------------------------------------

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh / 1.609344;
}

export function metersPerSecondToMph(ms: number): number {
  return (ms * 3600) / 1609.344;
}

export function millimetersToInches(mm: number): number {
  return mm / 25.4;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

/**
 * "NW" as degrees (315). The sixteen compass points, 22.5 degrees apart, so
 * the result can carry a half degree. Null for anything else.
 */
export function compassToDegrees(point: string | null | undefined): number | null {
  if (typeof point !== "string") return null;
  const index = COMPASS_POINTS.indexOf(point.trim().toUpperCase());
  return index === -1 ? null : index * 22.5;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whole degrees in 0 to 359. 359.6 is north, not 360. */
function wholeDegrees(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function maxOf(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
}

// ---------------------------------------------------------------------------
// The game key and the game window.
// ---------------------------------------------------------------------------

/** Our team codes that nflverse spells differently. The Rams are the only one. */
const NFLVERSE_TEAM_ALIASES: Record<string, string> = { LAR: "LA" };

/**
 * The nflverse game id: season, two-digit week, away team, home team
 * ("2026_04_GB_TB"). Teams are our own codes except the Rams, which nflverse
 * calls LA. This is what nfl_game_weather.game_key holds and what the planned
 * nfl_games table is keyed on.
 */
export function gameKeyFor(season: number, week: number, awayTeam: string, homeTeam: string): string {
  const code = (team: string) => {
    const upper = team.trim().toUpperCase();
    return NFLVERSE_TEAM_ALIASES[upper] ?? upper;
  };
  return `${season}_${String(week).padStart(2, "0")}_${code(awayTeam)}_${code(homeTeam)}`;
}

/**
 * The start of each clock hour in the game window, as epoch milliseconds:
 * the hour kickoff falls in, then the next three. Null for an unreadable time.
 */
export function gameWindowHours(kickoffIso: string): number[] | null {
  const kickoff = Date.parse(kickoffIso);
  if (!Number.isFinite(kickoff)) return null;
  const first = Math.floor(kickoff / HOUR_MS) * HOUR_MS;
  return Array.from({ length: GAME_WINDOW_HOURS }, (_, i) => first + i * HOUR_MS);
}

// ---------------------------------------------------------------------------
// National Weather Service: validTime runs.
// ---------------------------------------------------------------------------

/**
 * An ISO 8601 duration as hours: "PT6H" is 6, "P1DT12H" is 36, "P7D" is 168.
 * Weeks, days, hours and minutes are read; months and years never appear in a
 * forecast run and are refused. Null for anything unreadable.
 */
export function parseIsoDurationHours(duration: string): number | null {
  const text = duration.trim();
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text);
  // "P1DT" has a time marker and no time; it is malformed, not one day.
  if (!match || text.endsWith("T")) return null;
  const [, weeks, days, hours, minutes] = match;
  if (weeks === undefined && days === undefined && hours === undefined && minutes === undefined) {
    return null;
  }
  return (
    Number(weeks ?? 0) * 168 + Number(days ?? 0) * 24 + Number(hours ?? 0) + Number(minutes ?? 0) / 60
  );
}

export type ValidTimeRun = { validTime?: string; value?: number | null };

/** A longer run than this is a malformed duration, not a forecast. */
const MAX_RUN_HOURS = 24 * 14;

/**
 * Expand a grid layer's runs into one value per clock hour, keyed by the
 * hour's start in epoch milliseconds.
 *
 * `kind` decides what a run of several hours means. "state" (temperature,
 * gust, direction) repeats the value in every hour. "amount" (rain, snow) is a
 * total for the run and is divided evenly across its hours; see the file
 * header. A run with a null value, an unreadable start or an unreadable
 * duration is skipped rather than guessed at.
 */
export function expandValidTimeRuns(
  runs: ReadonlyArray<ValidTimeRun> | null | undefined,
  kind: "state" | "amount",
): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(runs)) return out;
  for (const run of runs) {
    const value = finite(run?.value);
    if (value === null || typeof run.validTime !== "string") continue;
    const [startText, durationText] = run.validTime.split("/");
    const start = Date.parse(startText);
    const hours = durationText ? parseIsoDurationHours(durationText) : null;
    if (!Number.isFinite(start) || hours === null) continue;
    const count = Math.max(1, Math.round(hours));
    if (count > MAX_RUN_HOURS) continue;
    const first = Math.floor(start / HOUR_MS) * HOUR_MS;
    const perHour = kind === "amount" ? value / count : value;
    for (let i = 0; i < count; i += 1) out.set(first + i * HOUR_MS, perHour);
  }
  return out;
}

// ---------------------------------------------------------------------------
// National Weather Service: parsing.
// ---------------------------------------------------------------------------

type NwsQuantity = { unitCode?: string; value?: number | null };

// Loosely typed on purpose: every field is checked where it is read.
type NwsHourlyPeriod = {
  startTime?: string;
  temperature?: number | NwsQuantity | null;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: NwsQuantity | null;
  relativeHumidity?: NwsQuantity | null;
  windSpeed?: string | NwsQuantity | null;
  windDirection?: string | null;
  shortForecast?: string | null;
};

type NwsGridLayer = { uom?: string; values?: ValidTimeRun[] };

/** The office and grid cell out of a /points document. Null when it has none. */
export function parseNwsPoints(payload: unknown): NwsGrid | null {
  const props = (payload as { properties?: Record<string, unknown> } | null)?.properties;
  if (!props || typeof props !== "object") return null;
  const office = props.gridId;
  const gridX = props.gridX;
  const gridY = props.gridY;
  if (typeof office !== "string" || !isGridOffice(office)) return null;
  if (!isGridIndex(gridX) || !isGridIndex(gridY)) return null;
  return { office, gridX, gridY };
}

function isGridOffice(office: string): boolean {
  return /^[A-Z]{3,4}$/.test(office);
}

function isGridIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 10_000;
}

/**
 * The hourly product's wind speed as miles per hour. "10 mph" is 10. A range
 * ("5 to 10 mph", which the twelve-hour product uses) reads as its upper end,
 * because the figure feeds a "how windy can it get" column. A km/h string is
 * converted. Null when there is no number in it.
 */
export function parseNwsWindSpeed(text: string | null | undefined): number | null {
  if (typeof text !== "string") return null;
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers) return null;
  const top = Math.max(...numbers.map(Number));
  return /km\/?h/i.test(text) ? kmhToMph(top) : top;
}

/** A quantity in a known unit as miles per hour; an unknown unit is null. */
function toMph(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  if (unit === "wmoUnit:km_h-1") return kmhToMph(value);
  if (unit === "wmoUnit:m_s-1") return metersPerSecondToMph(value);
  return null;
}

function toFahrenheit(value: number | null, unit: string | undefined): number | null {
  if (value === null) return null;
  if (unit === "wmoUnit:degC") return celsiusToFahrenheit(value);
  if (unit === "wmoUnit:degF") return value;
  return null;
}

function periodTemperatureF(period: NwsHourlyPeriod): number | null {
  const t = period.temperature;
  if (typeof t === "number") {
    if (!Number.isFinite(t)) return null;
    return period.temperatureUnit === "C" ? celsiusToFahrenheit(t) : t;
  }
  if (t && typeof t === "object") return toFahrenheit(finite(t.value), t.unitCode);
  return null;
}

function periodWindMph(period: NwsHourlyPeriod): number | null {
  const w = period.windSpeed;
  if (typeof w === "string") return parseNwsWindSpeed(w);
  if (w && typeof w === "object") return toMph(finite(w.value), w.unitCode);
  return null;
}

/** The runs of one layer that touch the window, verbatim, for metadata. */
function runsInWindow(layer: NwsGridLayer | undefined, window: number[]): ValidTimeRun[] {
  if (!layer || !Array.isArray(layer.values)) return [];
  const from = window[0];
  const to = window[window.length - 1] + HOUR_MS;
  return layer.values.filter((run) => {
    if (typeof run?.validTime !== "string") return false;
    const [startText, durationText] = run.validTime.split("/");
    const start = Date.parse(startText);
    const hours = durationText ? parseIsoDurationHours(durationText) : null;
    if (!Number.isFinite(start) || hours === null) return false;
    return start < to && start + hours * HOUR_MS > from;
  });
}

/** The grid layers read below, and so the ones kept in metadata. */
const NWS_GRID_LAYERS = [
  "apparentTemperature",
  "windGust",
  "windDirection",
  "quantitativePrecipitation",
  "snowfallAmount",
] as const;

/**
 * One game's forecast out of the hourly product and the grid document. Pure.
 *
 * Null when the hourly product has no period for the kickoff hour, which is a
 * game beyond the forecast horizon (about six and a half days). A window hour
 * past the end of the product is left out of the maxima; a rain or snow total
 * is null unless EVERY hour of the window is covered, because a sum over half
 * a game reads as a dry second half. The amount layers reach only about three
 * days out, so those two are null earlier in the week by design.
 */
export function parseNwsKickoffForecast(
  hourlyPayload: unknown,
  gridPayload: unknown,
  kickoffIso: string,
): KickoffForecast | null {
  const window = gameWindowHours(kickoffIso);
  if (!window) return null;

  const hourlyProps = (hourlyPayload as { properties?: Record<string, unknown> } | null)?.properties;
  const periods = Array.isArray(hourlyProps?.periods) ? (hourlyProps.periods as NwsHourlyPeriod[]) : [];
  const byHour = new Map<number, NwsHourlyPeriod>();
  for (const period of periods) {
    const start = typeof period?.startTime === "string" ? Date.parse(period.startTime) : NaN;
    if (Number.isFinite(start)) byHour.set(Math.floor(start / HOUR_MS) * HOUR_MS, period);
  }

  const kickoff = byHour.get(window[0]);
  if (!kickoff) return null;
  const windowPeriods = window
    .map((hour) => byHour.get(hour))
    .filter((p): p is NwsHourlyPeriod => p !== undefined);

  const gridProps = (gridPayload as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  const layer = (name: string): NwsGridLayer | undefined => {
    const value = gridProps[name];
    return value && typeof value === "object" ? (value as NwsGridLayer) : undefined;
  };

  const gust = layer("windGust");
  const gustByHour = expandValidTimeRuns(gust?.values, "state");
  const gustMph = maxOf(window.map((hour) => toMph(gustByHour.get(hour) ?? null, gust?.uom)));

  const apparent = layer("apparentTemperature");
  const feelsLike = toFahrenheit(
    expandValidTimeRuns(apparent?.values, "state").get(window[0]) ?? null,
    apparent?.uom,
  );

  // Degrees from the grid when it has them; the hourly product's compass point
  // (eight of them in practice, so 45 degrees coarse) otherwise.
  const direction = layer("windDirection");
  const gridDegrees =
    direction?.uom === "wmoUnit:degree_(angle)"
      ? (expandValidTimeRuns(direction.values, "state").get(window[0]) ?? null)
      : null;
  const degrees = gridDegrees ?? compassToDegrees(kickoff.windDirection);

  const amountInches = (name: string): number | null => {
    const source = layer(name);
    if (source?.uom !== "wmoUnit:mm") return null;
    const byHourMm = expandValidTimeRuns(source.values, "amount");
    let total = 0;
    for (const hour of window) {
      const mm = byHourMm.get(hour);
      if (mm === undefined) return null;
      total += mm;
    }
    return roundTo(millimetersToInches(total), 2);
  };

  const temp = periodTemperatureF(kickoff);
  const wind = periodWindMph(kickoff);
  const windMax = maxOf(windowPeriods.map(periodWindMph));
  const probability = maxOf(windowPeriods.map((p) => finite(p.probabilityOfPrecipitation?.value)));
  const humidity = finite(kickoff.relativeHumidity?.value);
  const conditions = typeof kickoff.shortForecast === "string" ? kickoff.shortForecast.trim() : "";

  const gridLayers: Record<string, { uom: string | null; values: ValidTimeRun[] }> = {};
  for (const name of NWS_GRID_LAYERS) {
    const source = layer(name);
    gridLayers[name] = { uom: source?.uom ?? null, values: runsInWindow(source, window) };
  }

  return {
    provider: "nws",
    temp_f: temp === null ? null : roundTo(temp, 1),
    feels_like_f: feelsLike === null ? null : roundTo(feelsLike, 1),
    wind_mph: wind === null ? null : roundTo(wind, 1),
    wind_gust_mph: gustMph === null ? null : roundTo(gustMph, 1),
    wind_dir_deg: degrees === null ? null : wholeDegrees(degrees),
    wind_mph_max_3h: windMax === null ? null : roundTo(windMax, 1),
    precip_prob_pct: probability === null ? null : clampPercent(probability),
    precip_in: amountInches("quantitativePrecipitation"),
    snow_in: amountInches("snowfallAmount"),
    humidity_pct: humidity === null ? null : clampPercent(humidity),
    conditions: conditions.length > 0 ? conditions : null,
    hourly: {
      hourlyUpdateTime: typeof hourlyProps?.updateTime === "string" ? hourlyProps.updateTime : null,
      periods: windowPeriods,
      gridUpdateTime: typeof gridProps.updateTime === "string" ? gridProps.updateTime : null,
      gridLayers,
    },
  };
}

// ---------------------------------------------------------------------------
// MET Norway: parsing.
// ---------------------------------------------------------------------------

type MetBlock = {
  summary?: { symbol_code?: string };
  details?: { precipitation_amount?: number };
};

type MetEntry = {
  time?: string;
  data?: {
    instant?: { details?: Record<string, unknown> };
    next_1_hours?: MetBlock;
    next_6_hours?: MetBlock;
  };
};

/** How long a step past the hourly range speaks for. */
const MET_LONG_STEP_HOURS = 6;

const MET_SIMPLE_SYMBOLS: Record<string, string> = {
  clearsky: "Clear sky",
  fair: "Fair",
  partlycloudy: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
};

/**
 * A MET Norway symbol code as words: "partlycloudy_day" is "Partly cloudy",
 * "heavyrainshowersandthunder_night" is "Heavy rain showers and thunder".
 *
 * The day, night and polar twilight suffix picks an icon and says nothing
 * about the weather, so it is dropped. Their published list spells two codes
 * "lightssleetshowersandthunder" and "lightssnowshowersandthunder", with the
 * extra s; both are read as "light". A code outside the published grammar
 * comes back capitalised as is rather than dropped, and an empty one is null.
 */
export function describeMetSymbol(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const base = code.trim().toLowerCase().replace(/_(day|night|polartwilight)$/, "");
  if (!base) return null;
  if (MET_SIMPLE_SYMBOLS[base]) return MET_SIMPLE_SYMBOLS[base];
  const match = /^(lights?|heavy)?(rain|sleet|snow)(showers)?(andthunder)?$/.exec(base);
  const words = match
    ? [
        match[1] ? (match[1] === "heavy" ? "heavy" : "light") : null,
        match[2],
        match[3] ? "showers" : null,
        match[4] ? "and thunder" : null,
      ]
        .filter((word): word is string => word !== null)
        .join(" ")
    : base;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One game's forecast out of a Locationforecast document. Pure.
 *
 * Inside the hourly range every window hour has its own entry. Past it the
 * document steps six hours at a time (00, 06, 12 and 18 UTC), and a window
 * hour is read from the step that covers it: the 12:00 entry speaks for a
 * 13:30 kickoff five days out. That is coarser than an hourly value and it is
 * what the provider publishes at that range; the entries used are kept in
 * `hourly`, so a reader can see which kind a snapshot was built from.
 *
 * Null when no entry covers the kickoff hour. Gust, precipitation probability
 * and snowfall are always null; see the file header.
 */
export function parseMetNorwayKickoffForecast(payload: unknown, kickoffIso: string): KickoffForecast | null {
  const window = gameWindowHours(kickoffIso);
  if (!window) return null;

  const props = (payload as { properties?: Record<string, unknown> } | null)?.properties;
  const series = Array.isArray(props?.timeseries) ? (props.timeseries as MetEntry[]) : [];
  const byTime = new Map<number, MetEntry>();
  for (const entry of series) {
    const time = typeof entry?.time === "string" ? Date.parse(entry.time) : NaN;
    if (Number.isFinite(time)) byTime.set(time, entry);
  }

  /** The entry that speaks for one clock hour, and whether it is that hour's own. */
  const entryFor = (hour: number): { entry: MetEntry; exact: boolean } | null => {
    const own = byTime.get(hour);
    if (own) return { entry: own, exact: true };
    for (let back = 1; back < MET_LONG_STEP_HOURS; back += 1) {
      const earlier = byTime.get(hour - back * HOUR_MS);
      if (!earlier) continue;
      // An hourly entry speaks for its own hour only. A gap after one is a gap.
      if (earlier.data?.next_1_hours || !earlier.data?.next_6_hours) return null;
      return { entry: earlier, exact: false };
    }
    return null;
  };

  const kickoff = entryFor(window[0]);
  if (!kickoff) return null;
  const covered = window.map(entryFor);

  const instant = (entry: MetEntry, key: string): number | null =>
    finite(entry.data?.instant?.details?.[key]);

  let precipMm: number | null = 0;
  for (const slot of covered) {
    if (precipMm === null) break;
    const hourly = slot?.exact ? finite(slot.entry.data?.next_1_hours?.details?.precipitation_amount) : null;
    const long = finite(slot?.entry.data?.next_6_hours?.details?.precipitation_amount);
    if (hourly !== null) precipMm += hourly;
    else if (long !== null) precipMm += long / MET_LONG_STEP_HOURS;
    else precipMm = null;
  }

  const temp = instant(kickoff.entry, "air_temperature");
  const apparent = instant(kickoff.entry, "apparent_air_temperature");
  const wind = instant(kickoff.entry, "wind_speed");
  const direction = instant(kickoff.entry, "wind_from_direction");
  const humidity = instant(kickoff.entry, "relative_humidity");
  const windMax = maxOf(covered.map((slot) => (slot ? instant(slot.entry, "wind_speed") : null)));
  const symbol =
    kickoff.entry.data?.next_1_hours?.summary?.symbol_code ??
    kickoff.entry.data?.next_6_hours?.summary?.symbol_code ??
    null;

  const used: MetEntry[] = [];
  for (const slot of covered) if (slot && !used.includes(slot.entry)) used.push(slot.entry);
  const meta = (props?.meta ?? null) as { updated_at?: unknown; units?: unknown } | null;

  return {
    provider: "met-norway",
    temp_f: temp === null ? null : roundTo(celsiusToFahrenheit(temp), 1),
    feels_like_f: apparent === null ? null : roundTo(celsiusToFahrenheit(apparent), 1),
    wind_mph: wind === null ? null : roundTo(metersPerSecondToMph(wind), 1),
    wind_gust_mph: null,
    wind_dir_deg: direction === null ? null : wholeDegrees(direction),
    wind_mph_max_3h: windMax === null ? null : roundTo(metersPerSecondToMph(windMax), 1),
    precip_prob_pct: null,
    precip_in: precipMm === null ? null : roundTo(millimetersToInches(precipMm), 2),
    snow_in: null,
    humidity_pct: humidity === null ? null : clampPercent(humidity),
    conditions: describeMetSymbol(symbol),
    hourly: {
      updatedAt: typeof meta?.updated_at === "string" ? meta.updated_at : null,
      units: meta?.units ?? null,
      timeseries: used,
    },
  };
}

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

/** What a provider is told when SITE.url is a development address. */
const PUBLIC_SITE_URL = "https://ffbeacon.com";

/**
 * The User-Agent both providers identify a caller by: the site and a contact
 * address, from lib/site.ts.
 *
 * SITE.url follows NEXT_PUBLIC_SITE_URL, which is http://localhost:3000 on a
 * development machine. A provider reading its logs cannot visit that, so
 * anything that is not a public https address is replaced with the site's own.
 */
export function weatherUserAgent(
  siteUrl: string = SITE.url,
  contact: string = SITE.legalContactEmail,
): string {
  const isPublic = /^https:\/\//i.test(siteUrl) && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(siteUrl);
  const url = isPublic ? siteUrl.replace(/\/+$/, "") : PUBLIC_SITE_URL;
  return `FFBeacon/1.0 (${url}; ${contact})`;
}

/**
 * A coordinate cut to four decimals, with no trailing zeros. MET Norway
 * refuses more than four; the National Weather Service redirects a coordinate
 * with trailing zeros to the short form, which is a wasted request.
 *
 * Rounded to six decimals before the cut, because 48.36 is stored as
 * 48.35999999 and a bare truncation would send 48.3599.
 */
export function forecastCoordinate(value: number): string {
  const millionths = Math.round(value * 1_000_000);
  return String(Math.trunc(millionths / 100) / 10_000);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Attempt = { kind: "ok"; body: unknown } | { kind: "retry" } | { kind: "failed" };

async function attemptJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // redirect: "manual" so a 3xx is never followed. Both providers answer
    // these URLs directly; following a redirect would send a server-side
    // request to whatever host the response named. A 3xx is a failed read.
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status === 429 || response.status >= 500) return { kind: "retry" };
    if (!response.ok) return { kind: "failed" };

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return { kind: "failed" };

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return { kind: "failed" };
    return { kind: "ok", body: JSON.parse(text) as unknown };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a JSON document from a weather provider. Never throws: null on a
 * timeout, a non-2xx, an oversized body or one that is not JSON. A 429 or a
 * 5xx is tried once more after RETRY_DELAY_MS, and only once: a provider that
 * is still refusing five seconds later is left alone until the next run.
 */
async function safeFetchWeather(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const first = await attemptJson(url, headers, DEFAULT_TIMEOUT_MS);
  if (first.kind === "ok") return first.body;
  if (first.kind === "failed") return null;
  await pause(RETRY_DELAY_MS);
  const second = await attemptJson(url, headers, DEFAULT_TIMEOUT_MS);
  return second.kind === "ok" ? second.body : null;
}

function nwsHeaders(): Record<string, string> {
  return { "user-agent": weatherUserAgent(), accept: "application/geo+json" };
}

/**
 * Which forecast office and grid cell a coordinate falls in. Null when the
 * request failed or the point is outside the National Weather Service's
 * coverage. The sync caches the answer on the stadium row.
 */
export async function lookupNwsGrid(latitude: number, longitude: number): Promise<NwsGrid | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const url = `${NWS_BASE_URL}/points/${forecastCoordinate(latitude)},${forecastCoordinate(longitude)}`;
  const payload = await safeFetchWeather(url, nwsHeaders());
  return payload === null ? null : parseNwsPoints(payload);
}

/**
 * The National Weather Service forecast for one game: two requests (the hourly
 * product and the grid document), or three when the stadium has no cached
 * grid. Both documents are needed; a row built from one of them would carry
 * nulls that look like "the provider does not publish this".
 *
 * The grid URLs are built here from the validated office and cell, never
 * followed from the /points response.
 */
export async function getNwsKickoffForecast(
  stadium: WeatherStadium,
  kickoffIso: string,
): Promise<KickoffForecastResult> {
  const grid = stadium.nwsGrid ?? (await lookupNwsGrid(stadium.latitude, stadium.longitude));
  if (!grid || !isGridOffice(grid.office) || !isGridIndex(grid.gridX) || !isGridIndex(grid.gridY)) {
    return { status: "failed" };
  }
  const gridUrl = `${NWS_BASE_URL}/gridpoints/${grid.office}/${grid.gridX},${grid.gridY}`;
  const hourly = await safeFetchWeather(`${gridUrl}/forecast/hourly`, nwsHeaders());
  if (hourly === null) return { status: "failed" };
  const gridData = await safeFetchWeather(gridUrl, nwsHeaders());
  if (gridData === null) return { status: "failed" };

  const forecast = parseNwsKickoffForecast(hourly, gridData, kickoffIso);
  return forecast ? { status: "ok", forecast } : { status: "outside-horizon" };
}

/**
 * The MET Norway forecast for one game: one request to the `complete`
 * endpoint, with the venue's elevation when we hold one (their model corrects
 * temperature for it).
 */
export async function getMetNorwayKickoffForecast(
  stadium: WeatherStadium,
  kickoffIso: string,
): Promise<KickoffForecastResult> {
  if (!Number.isFinite(stadium.latitude) || !Number.isFinite(stadium.longitude)) {
    return { status: "failed" };
  }
  const params = new URLSearchParams({
    lat: forecastCoordinate(stadium.latitude),
    lon: forecastCoordinate(stadium.longitude),
  });
  if (stadium.elevationM !== null && Number.isFinite(stadium.elevationM)) {
    params.set("altitude", String(Math.round(stadium.elevationM)));
  }
  const payload = await safeFetchWeather(`${MET_NORWAY_FORECAST_URL}?${params.toString()}`, {
    "user-agent": weatherUserAgent(),
  });
  if (payload === null) return { status: "failed" };

  const forecast = parseMetNorwayKickoffForecast(payload, kickoffIso);
  return forecast ? { status: "ok", forecast } : { status: "outside-horizon" };
}
