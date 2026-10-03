/**
 * The weather adapter, against real responses.
 *
 * The four files in lib/__fixtures__/nfl-weather were fetched on 2026-10-03
 * and cut down by hand: MetLife Stadium from the National Weather Service (the
 * /points lookup, the hourly product and the grid document) and Tottenham
 * Hotspur Stadium from MET Norway. Values are untouched; only the number of
 * periods, runs and layers was reduced. Every expected figure below can be
 * checked against those files with a calculator.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GAME_WINDOW_HOURS,
  MET_NORWAY_ATTRIBUTION,
  celsiusToFahrenheit,
  compassToDegrees,
  describeMetSymbol,
  expandValidTimeRuns,
  forecastCoordinate,
  gameKeyFor,
  gameWindowHours,
  getMetNorwayKickoffForecast,
  getNwsKickoffForecast,
  kmhToMph,
  lookupNwsGrid,
  metersPerSecondToMph,
  millimetersToInches,
  parseIsoDurationHours,
  parseMetNorwayKickoffForecast,
  parseNwsKickoffForecast,
  parseNwsPoints,
  parseNwsWindSpeed,
  weatherUserAgent,
} from "./nfl-weather";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", "nfl-weather", name), "utf8"));
}

const nwsPoints = fixture("nws-points.json");
const nwsHourly = fixture("nws-hourly.json");
const nwsGrid = fixture("nws-gridpoints.json");
const metNorway = fixture("met-norway-complete.json");

const at = (iso: string) => Date.parse(iso);

describe("unit conversions", () => {
  it("turns Celsius into Fahrenheit", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(celsiusToFahrenheit(19.3)).toBeCloseTo(66.74, 2);
  });

  it("turns kilometres an hour into miles an hour", () => {
    expect(kmhToMph(1.609344)).toBeCloseTo(1, 10);
    expect(kmhToMph(24.076)).toBeCloseTo(14.96, 2);
    expect(kmhToMph(0)).toBe(0);
  });

  it("turns metres a second into miles an hour", () => {
    expect(metersPerSecondToMph(1)).toBeCloseTo(2.23694, 4);
    expect(metersPerSecondToMph(10)).toBeCloseTo(22.3694, 3);
  });

  it("turns millimetres into inches", () => {
    expect(millimetersToInches(25.4)).toBe(1);
    expect(millimetersToInches(2.54)).toBeCloseTo(0.1, 10);
  });

  it("turns a compass point into degrees", () => {
    expect(compassToDegrees("N")).toBe(0);
    expect(compassToDegrees("NE")).toBe(45);
    expect(compassToDegrees("E")).toBe(90);
    expect(compassToDegrees("S")).toBe(180);
    expect(compassToDegrees("NW")).toBe(315);
    expect(compassToDegrees("NNW")).toBe(337.5);
    expect(compassToDegrees(" sw ")).toBe(225);
  });

  it("returns null for something that is not a compass point", () => {
    expect(compassToDegrees("X")).toBeNull();
    expect(compassToDegrees("")).toBeNull();
    expect(compassToDegrees(null)).toBeNull();
    expect(compassToDegrees(undefined)).toBeNull();
  });
});

describe("gameKeyFor", () => {
  it("builds season, two-digit week, away, home", () => {
    expect(gameKeyFor(2026, 4, "GB", "TB")).toBe("2026_04_GB_TB");
    expect(gameKeyFor(2026, 18, "NE", "BUF")).toBe("2026_18_NE_BUF");
  });

  it("writes the Rams as LA on either side, and leaves the Chargers alone", () => {
    expect(gameKeyFor(2026, 4, "LAR", "PHI")).toBe("2026_04_LA_PHI");
    expect(gameKeyFor(2026, 12, "LAC", "LAR")).toBe("2026_12_LAC_LA");
  });

  it("keeps our own codes for everyone else", () => {
    expect(gameKeyFor(2026, 4, "IND", "WAS")).toBe("2026_04_IND_WAS");
    expect(gameKeyFor(2026, 4, "KC", "LV")).toBe("2026_04_KC_LV");
  });

  it("always satisfies the table's game_key check", () => {
    const pattern = /^[0-9]{4}_[0-9]{2}_[A-Z]{2,3}_[A-Z]{2,3}$/;
    expect(gameKeyFor(2026, 1, "sf", " sea ")).toMatch(pattern);
    expect(gameKeyFor(2026, 4, "LAR", "PHI")).toMatch(pattern);
  });
});

describe("gameWindowHours", () => {
  it("is the kickoff hour and the three after it", () => {
    expect(GAME_WINDOW_HOURS).toBe(4);
    expect(gameWindowHours("2026-10-04T17:00:00Z")).toEqual([
      at("2026-10-04T17:00:00Z"),
      at("2026-10-04T18:00:00Z"),
      at("2026-10-04T19:00:00Z"),
      at("2026-10-04T20:00:00Z"),
    ]);
  });

  it("starts at the clock hour a mid-hour kickoff falls in", () => {
    expect(gameWindowHours("2026-10-04T20:25:00Z")?.[0]).toBe(at("2026-10-04T20:00:00Z"));
    expect(gameWindowHours("2026-10-04T13:30:00+00:00")?.[0]).toBe(at("2026-10-04T13:00:00Z"));
  });

  it("crosses midnight", () => {
    expect(gameWindowHours("2026-10-05T00:20:00Z")).toEqual([
      at("2026-10-05T00:00:00Z"),
      at("2026-10-05T01:00:00Z"),
      at("2026-10-05T02:00:00Z"),
      at("2026-10-05T03:00:00Z"),
    ]);
  });

  it("returns null for an unreadable time", () => {
    expect(gameWindowHours("not a time")).toBeNull();
  });
});

describe("parseIsoDurationHours", () => {
  it("reads the durations the grid document uses", () => {
    expect(parseIsoDurationHours("PT1H")).toBe(1);
    expect(parseIsoDurationHours("PT6H")).toBe(6);
    expect(parseIsoDurationHours("P1DT12H")).toBe(36);
    expect(parseIsoDurationHours("P7D")).toBe(168);
    expect(parseIsoDurationHours("P7DT13H")).toBe(181);
    expect(parseIsoDurationHours("PT30M")).toBe(0.5);
    expect(parseIsoDurationHours("P1W")).toBe(168);
  });

  it("returns null for anything else", () => {
    expect(parseIsoDurationHours("P")).toBeNull();
    expect(parseIsoDurationHours("PT")).toBeNull();
    expect(parseIsoDurationHours("P1DT")).toBeNull();
    expect(parseIsoDurationHours("6H")).toBeNull();
    expect(parseIsoDurationHours("P1M")).toBeNull();
    expect(parseIsoDurationHours("")).toBeNull();
  });
});

describe("expandValidTimeRuns", () => {
  it("repeats a state in every hour of its run", () => {
    const hours = expandValidTimeRuns(
      [{ validTime: "2026-10-04T17:00:00+00:00/PT3H", value: 18.9 }],
      "state",
    );
    expect([...hours.entries()]).toEqual([
      [at("2026-10-04T17:00:00Z"), 18.9],
      [at("2026-10-04T18:00:00Z"), 18.9],
      [at("2026-10-04T19:00:00Z"), 18.9],
    ]);
  });

  it("spreads an amount evenly across its run", () => {
    const hours = expandValidTimeRuns(
      [{ validTime: "2026-10-04T18:00:00+00:00/PT6H", value: 2.54 }],
      "amount",
    );
    expect(hours.size).toBe(6);
    for (const value of hours.values()) expect(value).toBeCloseTo(2.54 / 6, 10);
    expect(hours.has(at("2026-10-04T17:00:00Z"))).toBe(false);
    expect(hours.has(at("2026-10-05T00:00:00Z"))).toBe(false);
  });

  it("joins consecutive runs of different lengths", () => {
    const hours = expandValidTimeRuns(
      [
        { validTime: "2026-10-04T15:00:00+00:00/PT3H", value: 24.076 },
        { validTime: "2026-10-04T18:00:00+00:00/PT1H", value: 22.224 },
        { validTime: "2026-10-04T19:00:00+00:00/P1DT2H", value: 20 },
      ],
      "state",
    );
    expect(hours.size).toBe(3 + 1 + 26);
    expect(hours.get(at("2026-10-04T17:00:00Z"))).toBe(24.076);
    expect(hours.get(at("2026-10-04T18:00:00Z"))).toBe(22.224);
    expect(hours.get(at("2026-10-05T20:00:00Z"))).toBe(20);
  });

  it("skips a run it cannot read rather than guessing", () => {
    const hours = expandValidTimeRuns(
      [
        { validTime: "2026-10-04T17:00:00+00:00/PT1H", value: null },
        { validTime: "2026-10-04T18:00:00+00:00", value: 5 },
        { validTime: "garbage/PT1H", value: 5 },
        { validTime: "2026-10-04T19:00:00+00:00/P99Y", value: 5 },
        { value: 5 },
      ],
      "state",
    );
    expect(hours.size).toBe(0);
    expect(expandValidTimeRuns(null, "state").size).toBe(0);
    expect(expandValidTimeRuns(undefined, "amount").size).toBe(0);
  });

  it("expands every run of a real layer", () => {
    const layer = (nwsGrid as { properties: { windGust: { values: unknown[] } } }).properties.windGust;
    const hours = expandValidTimeRuns(layer.values as never, "state");
    // 12:00Z on the 4th through 06:00Z on the 5th, with no hole.
    for (let t = at("2026-10-04T12:00:00Z"); t <= at("2026-10-05T06:00:00Z"); t += 3_600_000) {
      expect(hours.has(t), new Date(t).toISOString()).toBe(true);
    }
  });
});

describe("parseNwsPoints", () => {
  it("reads the office and grid cell", () => {
    expect(parseNwsPoints(nwsPoints)).toEqual({ office: "OKX", gridX: 30, gridY: 46 });
  });

  it("returns null when the document has no grid", () => {
    expect(parseNwsPoints(null)).toBeNull();
    expect(parseNwsPoints({})).toBeNull();
    expect(parseNwsPoints({ properties: { gridId: "OKX", gridX: "30", gridY: 46 } })).toBeNull();
    expect(parseNwsPoints({ properties: { gridId: "../x", gridX: 30, gridY: 46 } })).toBeNull();
  });
});

describe("parseNwsWindSpeed", () => {
  it("reads the hourly product's form", () => {
    expect(parseNwsWindSpeed("10 mph")).toBe(10);
    expect(parseNwsWindSpeed("7 mph")).toBe(7);
  });

  it("reads a range as its upper end", () => {
    expect(parseNwsWindSpeed("5 to 10 mph")).toBe(10);
  });

  it("converts a metric string", () => {
    expect(parseNwsWindSpeed("16 km/h")).toBeCloseTo(9.94, 2);
  });

  it("returns null when there is no number", () => {
    expect(parseNwsWindSpeed("")).toBeNull();
    expect(parseNwsWindSpeed("Calm")).toBeNull();
    expect(parseNwsWindSpeed(null)).toBeNull();
  });
});

describe("parseNwsKickoffForecast (MetLife Stadium, fetched 2026-10-03)", () => {
  // ARI at NYG, 1:00 PM Eastern on October 4.
  const KICKOFF = "2026-10-04T17:00:00Z";

  it("reads the kickoff hour from the hourly product", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    expect(forecast).not.toBeNull();
    expect(forecast?.provider).toBe("nws");
    expect(forecast?.temp_f).toBe(66);
    expect(forecast?.wind_mph).toBe(9);
    expect(forecast?.humidity_pct).toBe(63);
    expect(forecast?.conditions).toBe("Mostly Cloudy");
  });

  it("reads the worst of the window for wind and precipitation probability", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    // 9, 8, 8 and 8 mph across 1 PM to 4 PM.
    expect(forecast?.wind_mph_max_3h).toBe(9);
    // 6 percent at kickoff, 43 for the three hours after it.
    expect(forecast?.precip_prob_pct).toBe(43);
  });

  it("reads gust, apparent temperature and direction from the grid, converted", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    // 24.076 km/h at 17:00Z, 22.224 for the three hours after: 14.96 mph.
    expect(forecast?.wind_gust_mph).toBe(15);
    // 18.89 C.
    expect(forecast?.feels_like_f).toBe(66);
    // 110 degrees in the grid; the hourly product only says "E".
    expect(forecast?.wind_dir_deg).toBe(110);
  });

  it("sums rain and snow across the window from six-hour runs", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    // 17:00Z is the last hour of a dry run. 18:00Z to 20:00Z are three hours
    // of a 2.54 mm six-hour run: 1.27 mm, 0.05 inches.
    expect(forecast?.precip_in).toBe(0.05);
    expect(forecast?.snow_in).toBe(0);
  });

  it("keeps the four periods and the grid runs it read, verbatim", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    const raw = forecast?.hourly as {
      periods: Array<{ startTime: string }>;
      gridLayers: Record<string, { uom: string; values: Array<{ validTime: string; value: number }> }>;
    };
    expect(raw.periods.map((p) => p.startTime)).toEqual([
      "2026-10-04T13:00:00-04:00",
      "2026-10-04T14:00:00-04:00",
      "2026-10-04T15:00:00-04:00",
      "2026-10-04T16:00:00-04:00",
    ]);
    expect(raw.gridLayers.windGust).toEqual({
      uom: "wmoUnit:km_h-1",
      values: [
        { validTime: "2026-10-04T15:00:00+00:00/PT3H", value: 24.076 },
        { validTime: "2026-10-04T18:00:00+00:00/PT3H", value: 22.224 },
      ],
    });
    expect(Object.keys(raw.gridLayers).sort()).toEqual([
      "apparentTemperature",
      "quantitativePrecipitation",
      "snowfallAmount",
      "windDirection",
      "windGust",
    ]);
  });

  it("selects the same window for a kickoff later in the hour", () => {
    const onTheHour = parseNwsKickoffForecast(nwsHourly, nwsGrid, KICKOFF);
    const midHour = parseNwsKickoffForecast(nwsHourly, nwsGrid, "2026-10-04T17:25:00Z");
    expect(midHour).toEqual(onTheHour);
  });

  it("moves the window with the kickoff", () => {
    // 4:25 PM Eastern: 4 PM to 7 PM.
    const late = parseNwsKickoffForecast(nwsHourly, nwsGrid, "2026-10-04T20:25:00Z");
    expect(late?.temp_f).toBe(65);
    expect(late?.wind_mph).toBe(8);
    expect(late?.wind_mph_max_3h).toBe(8);
    expect(late?.humidity_pct).toBe(68);
    expect(late?.conditions).toBe("Chance Rain Showers");
    // Four hours of the same 2.54 mm run: 1.69 mm.
    expect(late?.precip_in).toBe(0.07);
  });

  it("uses the hours it has when the product ends inside the window", () => {
    // The fixture stops at 10 PM Eastern, so an 8:20 PM game has three hours.
    const night = parseNwsKickoffForecast(nwsHourly, nwsGrid, "2026-10-05T00:20:00Z");
    expect(night?.temp_f).toBe(62);
    expect(night?.wind_mph_max_3h).toBe(3);
    expect(night?.precip_prob_pct).toBe(32);
    expect((night?.hourly as { periods: unknown[] }).periods).toHaveLength(3);
  });

  it("returns null when the kickoff hour is past what was published", () => {
    expect(parseNwsKickoffForecast(nwsHourly, nwsGrid, "2026-10-10T17:00:00Z")).toBeNull();
    expect(parseNwsKickoffForecast(nwsHourly, nwsGrid, "2026-10-02T17:00:00Z")).toBeNull();
  });

  it("leaves a grid figure null when its layer is missing, never zero", () => {
    const forecast = parseNwsKickoffForecast(nwsHourly, { properties: {} }, KICKOFF);
    expect(forecast?.temp_f).toBe(66);
    expect(forecast?.wind_gust_mph).toBeNull();
    expect(forecast?.feels_like_f).toBeNull();
    expect(forecast?.precip_in).toBeNull();
    expect(forecast?.snow_in).toBeNull();
    // Falls back to the hourly product's compass point, "E".
    expect(forecast?.wind_dir_deg).toBe(90);
  });

  it("leaves a rain total null unless every hour of the window is covered", () => {
    const grid = {
      properties: {
        quantitativePrecipitation: {
          uom: "wmoUnit:mm",
          values: [{ validTime: "2026-10-04T12:00:00+00:00/PT6H", value: 3 }],
        },
      },
    };
    // 17:00Z is covered; 18:00Z to 20:00Z are not.
    expect(parseNwsKickoffForecast(nwsHourly, grid, KICKOFF)?.precip_in).toBeNull();
  });

  it("refuses a layer in a unit it does not know rather than misconverting it", () => {
    const grid = {
      properties: {
        windGust: {
          uom: "wmoUnit:furlong_fortnight-1",
          values: [{ validTime: "2026-10-04T12:00:00+00:00/P1D", value: 40 }],
        },
      },
    };
    expect(parseNwsKickoffForecast(nwsHourly, grid, KICKOFF)?.wind_gust_mph).toBeNull();
  });

  it("returns null for an empty or malformed document", () => {
    expect(parseNwsKickoffForecast(null, null, KICKOFF)).toBeNull();
    expect(parseNwsKickoffForecast({ properties: { periods: "no" } }, nwsGrid, KICKOFF)).toBeNull();
    expect(parseNwsKickoffForecast(nwsHourly, nwsGrid, "not a time")).toBeNull();
  });
});

describe("describeMetSymbol", () => {
  it("drops the day or night suffix", () => {
    expect(describeMetSymbol("partlycloudy_day")).toBe("Partly cloudy");
    expect(describeMetSymbol("partlycloudy_night")).toBe("Partly cloudy");
    expect(describeMetSymbol("clearsky_polartwilight")).toBe("Clear sky");
    expect(describeMetSymbol("fair_day")).toBe("Fair");
  });

  it("reads the codes with no suffix", () => {
    expect(describeMetSymbol("cloudy")).toBe("Cloudy");
    expect(describeMetSymbol("fog")).toBe("Fog");
    expect(describeMetSymbol("rain")).toBe("Rain");
    expect(describeMetSymbol("lightrain")).toBe("Light rain");
    expect(describeMetSymbol("heavysnow")).toBe("Heavy snow");
    expect(describeMetSymbol("sleet")).toBe("Sleet");
  });

  it("separates showers and thunder", () => {
    expect(describeMetSymbol("rainshowers_day")).toBe("Rain showers");
    expect(describeMetSymbol("heavyrainshowersandthunder_night")).toBe("Heavy rain showers and thunder");
    expect(describeMetSymbol("lightsnowandthunder")).toBe("Light snow and thunder");
  });

  it("reads the two codes MET Norway spells with an extra s", () => {
    expect(describeMetSymbol("lightssleetshowersandthunder_day")).toBe("Light sleet showers and thunder");
    expect(describeMetSymbol("lightssnowshowersandthunder_night")).toBe("Light snow showers and thunder");
  });

  it("keeps a code it does not know, and returns null for none", () => {
    expect(describeMetSymbol("volcanicash_day")).toBe("Volcanicash");
    expect(describeMetSymbol("")).toBeNull();
    expect(describeMetSymbol(null)).toBeNull();
    expect(describeMetSymbol(undefined)).toBeNull();
  });
});

describe("parseMetNorwayKickoffForecast (Tottenham Hotspur Stadium, fetched 2026-10-03)", () => {
  // IND at WAS in London, 2:30 PM local on October 4.
  const KICKOFF = "2026-10-04T13:30:00Z";

  it("reads the kickoff hour, converted", () => {
    const forecast = parseMetNorwayKickoffForecast(metNorway, KICKOFF);
    expect(forecast).not.toBeNull();
    expect(forecast?.provider).toBe("met-norway");
    // 19.3 C at 13:00Z.
    expect(forecast?.temp_f).toBe(66.7);
    expect(forecast?.feels_like_f).toBe(66.7);
    // 1.5 m/s from 215.9 degrees.
    expect(forecast?.wind_mph).toBe(3.4);
    expect(forecast?.wind_dir_deg).toBe(216);
    // 51.8 percent.
    expect(forecast?.humidity_pct).toBe(52);
    expect(forecast?.conditions).toBe("Fair");
  });

  it("reads the window for the highest wind and the rain total", () => {
    const forecast = parseMetNorwayKickoffForecast(metNorway, KICKOFF);
    // 1.5, 1.7, 2.0 and 2.2 m/s across 13:00Z to 16:00Z.
    expect(forecast?.wind_mph_max_3h).toBe(4.9);
    expect(forecast?.precip_in).toBe(0);
  });

  it("leaves gust, precipitation probability and snowfall null", () => {
    const forecast = parseMetNorwayKickoffForecast(metNorway, KICKOFF);
    expect(forecast?.wind_gust_mph).toBeNull();
    expect(forecast?.precip_prob_pct).toBeNull();
    expect(forecast?.snow_in).toBeNull();
  });

  it("keeps the four entries it read, verbatim, with the units", () => {
    const forecast = parseMetNorwayKickoffForecast(metNorway, KICKOFF);
    const raw = forecast?.hourly as {
      updatedAt: string;
      units: Record<string, string>;
      timeseries: Array<{ time: string; data: { instant: { details: { air_temperature: number } } } }>;
    };
    expect(raw.timeseries.map((entry) => entry.time)).toEqual([
      "2026-10-04T13:00:00Z",
      "2026-10-04T14:00:00Z",
      "2026-10-04T15:00:00Z",
      "2026-10-04T16:00:00Z",
    ]);
    expect(raw.timeseries[0].data.instant.details.air_temperature).toBe(19.3);
    expect(raw.units.wind_speed).toBe("m/s");
    expect(raw.updatedAt).toBe("2026-10-03T05:23:55Z");
  });

  it("reads a kickoff past the hourly range from the six-hour step that covers it", () => {
    // 19:30Z on the 6th sits inside the 18:00Z step: 18.5 C, 1.0 m/s, cloudy,
    // 0.3 mm over six hours.
    const forecast = parseMetNorwayKickoffForecast(metNorway, "2026-10-06T19:30:00Z");
    expect(forecast?.temp_f).toBe(65.3);
    expect(forecast?.wind_mph).toBe(2.2);
    expect(forecast?.conditions).toBe("Cloudy");
    // Four of the six hours: 0.2 mm.
    expect(forecast?.precip_in).toBe(0.01);
    expect((forecast?.hourly as { timeseries: unknown[] }).timeseries).toHaveLength(1);
  });

  it("spans two six-hour steps when the window crosses one", () => {
    // 22:00Z and 23:00Z from the 18:00Z step (0.3 mm), 00:00Z and 01:00Z from
    // the next (1.9 mm): 0.1 + 0.633 mm.
    const forecast = parseMetNorwayKickoffForecast(metNorway, "2026-10-06T22:30:00Z");
    expect(forecast?.precip_in).toBe(0.03);
    // 1.0 m/s then 2.5 m/s.
    expect(forecast?.wind_mph).toBe(2.2);
    expect(forecast?.wind_mph_max_3h).toBe(5.6);
    expect((forecast?.hourly as { timeseries: unknown[] }).timeseries).toHaveLength(2);
  });

  it("never lets an hourly entry speak for a later hour", () => {
    // The fixture's hourly entries stop at 20:00Z on the 4th. 21:00Z is a
    // hole, not a continuation of 20:00Z.
    expect(parseMetNorwayKickoffForecast(metNorway, "2026-10-04T21:00:00Z")).toBeNull();
  });

  it("returns null when nothing covers the kickoff hour", () => {
    expect(parseMetNorwayKickoffForecast(metNorway, "2026-10-08T13:00:00Z")).toBeNull();
    expect(parseMetNorwayKickoffForecast(metNorway, "2026-10-01T13:00:00Z")).toBeNull();
    expect(parseMetNorwayKickoffForecast(metNorway, "2026-11-01T13:00:00Z")).toBeNull();
  });

  it("leaves the rain total null on the last entry, which has no period block", () => {
    const forecast = parseMetNorwayKickoffForecast(metNorway, "2026-10-12T12:00:00Z");
    expect(forecast?.temp_f).toBe(57);
    expect(forecast?.precip_in).toBeNull();
    expect(forecast?.conditions).toBeNull();
  });

  it("returns null for an empty or malformed document", () => {
    expect(parseMetNorwayKickoffForecast(null, KICKOFF)).toBeNull();
    expect(parseMetNorwayKickoffForecast({ properties: {} }, KICKOFF)).toBeNull();
    expect(parseMetNorwayKickoffForecast(metNorway, "not a time")).toBeNull();
  });
});

describe("weatherUserAgent", () => {
  it("names the site and a contact address", () => {
    expect(weatherUserAgent("https://ffbeacon.com", "michael@ffbeacon.com")).toBe(
      "FFBeacon/1.0 (https://ffbeacon.com; michael@ffbeacon.com)",
    );
    expect(weatherUserAgent("https://ffbeacon.com/", "michael@ffbeacon.com")).toBe(
      "FFBeacon/1.0 (https://ffbeacon.com; michael@ffbeacon.com)",
    );
  });

  it("never tells a provider to visit a development address", () => {
    for (const local of ["http://localhost:3000", "https://localhost:3000", "http://127.0.0.1:3000", ""]) {
      expect(weatherUserAgent(local, "michael@ffbeacon.com")).toBe(
        "FFBeacon/1.0 (https://ffbeacon.com; michael@ffbeacon.com)",
      );
    }
  });

  it("carries a contact address by default", () => {
    expect(weatherUserAgent()).toMatch(/^FFBeacon\/1\.0 \(https:\/\/[^;]+; [^@\s]+@[^@\s]+\)$/);
  });
});

describe("forecastCoordinate", () => {
  it("cuts to four decimals without rounding up", () => {
    expect(forecastCoordinate(40.8135075)).toBe("40.8135");
    expect(forecastCoordinate(-74.0743424)).toBe("-74.0743");
    expect(forecastCoordinate(51.6042151)).toBe("51.6042");
    expect(forecastCoordinate(-0.0662246)).toBe("-0.0662");
    expect(forecastCoordinate(42.77375999)).toBe("42.7737");
  });

  it("drops trailing zeros", () => {
    expect(forecastCoordinate(48.36)).toBe("48.36");
    expect(forecastCoordinate(2)).toBe("2");
  });
});

describe("the attribution", () => {
  it("is the wording MET Norway's licence asks for", () => {
    expect(MET_NORWAY_ATTRIBUTION).toBe("Weather data from MET Norway");
  });
});

describe("requests", () => {
  const fetchMock = vi.fn();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const stadium = { latitude: 40.8135075, longitude: -74.0743424, elevationM: 2, nwsGrid: null };
  const london = { latitude: 51.6042151, longitude: -0.0662246, elevationM: 13, nwsGrid: null };

  it("looks up a grid with a four-decimal coordinate and both headers", async () => {
    fetchMock.mockResolvedValueOnce(json(nwsPoints));
    expect(await lookupNwsGrid(stadium.latitude, stadium.longitude)).toEqual({
      office: "OKX",
      gridX: 30,
      gridY: 46,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.weather.gov/points/40.8135,-74.0743");
    expect(init.headers["user-agent"]).toMatch(/^FFBeacon\/1\.0 \(https:\/\/.+; .+@.+\)$/);
    expect(init.headers.accept).toBe("application/geo+json");
  });

  it("returns null on a 404 without trying again", async () => {
    fetchMock.mockResolvedValueOnce(json({ title: "Not Found" }, 404));
    expect(await lookupNwsGrid(51.6, -0.07)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the request itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await lookupNwsGrid(stadium.latitude, stadium.longitude)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("<html>not json</html>", { status: 200 }));
    expect(await lookupNwsGrid(stadium.latitude, stadium.longitude)).toBeNull();
  });

  it.each([429, 500, 503])("retries a %i once, five seconds later", async (status) => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(json({}, status)).mockResolvedValueOnce(json(nwsPoints));
    const pending = lookupNwsGrid(stadium.latitude, stadium.longitude);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ office: "OKX", gridX: 30, gridY: 46 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the one retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => json({}, 503));
    const pending = lookupNwsGrid(stadium.latitude, stadium.longitude);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches the hourly product and the grid for a cached cell, and no lookup", async () => {
    fetchMock.mockResolvedValueOnce(json(nwsHourly)).mockResolvedValueOnce(json(nwsGrid));
    const result = await getNwsKickoffForecast(
      { ...stadium, nwsGrid: { office: "OKX", gridX: 30, gridY: 46 } },
      "2026-10-04T17:00:00Z",
    );
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.forecast.temp_f).toBe(66);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.weather.gov/gridpoints/OKX/30,46/forecast/hourly",
      "https://api.weather.gov/gridpoints/OKX/30,46",
    ]);
  });

  it("looks the cell up first when the stadium has none cached", async () => {
    fetchMock
      .mockResolvedValueOnce(json(nwsPoints))
      .mockResolvedValueOnce(json(nwsHourly))
      .mockResolvedValueOnce(json(nwsGrid));
    const result = await getNwsKickoffForecast(stadium, "2026-10-04T17:00:00Z");
    expect(result.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("says failed, not outside the horizon, when a request fails", async () => {
    fetchMock.mockResolvedValueOnce(json(nwsHourly)).mockResolvedValueOnce(json({}, 404));
    expect(
      await getNwsKickoffForecast(
        { ...stadium, nwsGrid: { office: "OKX", gridX: 30, gridY: 46 } },
        "2026-10-04T17:00:00Z",
      ),
    ).toEqual({ status: "failed" });

    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await getNwsKickoffForecast(stadium, "2026-10-04T17:00:00Z")).toEqual({ status: "failed" });
  });

  it("says outside the horizon when the provider answered without the kickoff hour", async () => {
    fetchMock.mockResolvedValueOnce(json(nwsHourly)).mockResolvedValueOnce(json(nwsGrid));
    expect(
      await getNwsKickoffForecast(
        { ...stadium, nwsGrid: { office: "OKX", gridX: 30, gridY: 46 } },
        "2026-10-20T17:00:00Z",
      ),
    ).toEqual({ status: "outside-horizon" });
  });

  it("refuses to build a URL from a malformed cached cell", async () => {
    const result = await getNwsKickoffForecast(
      { ...stadium, nwsGrid: { office: "OKX/../..", gridX: 30, gridY: 46 } },
      "2026-10-04T17:00:00Z",
    );
    expect(result).toEqual({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks MET Norway for the complete forecast with coordinates, altitude and a User-Agent", async () => {
    fetchMock.mockResolvedValueOnce(json(metNorway));
    const result = await getMetNorwayKickoffForecast(london, "2026-10-04T13:30:00Z");
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.forecast.conditions).toBe("Fair");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=51.6042&lon=-0.0662&altitude=13",
    );
    expect(init.headers["user-agent"]).toMatch(/^FFBeacon\/1\.0 \(/);
  });

  it("leaves the altitude out when the stadium has none", async () => {
    fetchMock.mockResolvedValueOnce(json(metNorway));
    await getMetNorwayKickoffForecast({ ...london, elevationM: null }, "2026-10-04T13:30:00Z");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=51.6042&lon=-0.0662",
    );
  });

  it("tells a failed MET Norway request from a game it has not published", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "forbidden" }, 403));
    expect(await getMetNorwayKickoffForecast(london, "2026-10-04T13:30:00Z")).toEqual({ status: "failed" });
    fetchMock.mockResolvedValueOnce(json(metNorway));
    expect(await getMetNorwayKickoffForecast(london, "2026-11-01T13:30:00Z")).toEqual({
      status: "outside-horizon",
    });
  });
});
