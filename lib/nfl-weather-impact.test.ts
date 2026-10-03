import { describe, it, expect } from "vitest";
import {
  forecastSentence,
  readWeather,
  weatherSeverity,
  windDirectionWord,
} from "./nfl-weather-impact";
import type { GameWeather } from "@/lib/season-pulse/types";

function forecast(overrides: Partial<GameWeather> = {}): GameWeather {
  return {
    isIndoor: false,
    roof: "outdoors",
    stadium: "Lambeau Field",
    city: "Green Bay",
    provider: "nws",
    fetchedAt: "2026-10-03T13:45:00Z",
    leadHours: 24,
    tempF: 55,
    feelsLikeF: 55,
    windMph: 5,
    windGustMph: 8,
    windDirDeg: 315,
    windMphMax3h: 6,
    precipProbPct: 10,
    precipIn: 0,
    snowIn: 0,
    humidityPct: 60,
    conditions: "Mostly Sunny",
    ...overrides,
  };
}

describe("readWeather", () => {
  it("never reads a missing forecast as calm", () => {
    const read = readWeather(null);
    expect(read.band).toBe("unknown");
    expect(read.forecast).toBeNull();
    expect(read.advice).toMatch(/not the same as fair weather/);
  });

  it("calls a dome indoors and says weather is not a factor", () => {
    const read = readWeather(forecast({ isIndoor: true, roof: "dome", tempF: null, windMph: null }));
    expect(read.band).toBe("indoors");
    expect(read.label).toBe("Indoors");
    expect(read.forecast).toBeNull();
  });

  it("says out loud that a retractable roof is ASSUMED closed", () => {
    const read = readWeather(forecast({ isIndoor: true, roof: "retractable" }));
    expect(read.band).toBe("indoors");
    expect(read.label).toBe("Retractable roof");
    expect(read.advice).toMatch(/treat it as closed/);
  });

  it("finds nothing to act on in a calm, dry forecast", () => {
    const read = readWeather(forecast());
    expect(read.band).toBe("clear");
    expect(read.advice).toBe("Nothing in this forecast should change a lineup.");
  });

  it("steps through the wind bands at 10, 15 and 20 mph sustained", () => {
    expect(readWeather(forecast({ windMph: 9.9, windMphMax3h: 9.9 })).band).toBe("clear");
    expect(readWeather(forecast({ windMph: 10, windMphMax3h: 10 })).band).toBe("watch");
    expect(readWeather(forecast({ windMph: 15, windMphMax3h: 15 })).band).toBe("downgrade");
    expect(readWeather(forecast({ windMph: 20, windMphMax3h: 20 })).band).toBe("heavy");
  });

  it("uses the strongest wind across the game, not only the kickoff hour", () => {
    expect(readWeather(forecast({ windMph: 6, windMphMax3h: 17 })).band).toBe("downgrade");
  });

  it("lets a strong gust lift a game one band", () => {
    expect(readWeather(forecast({ windMph: 6, windMphMax3h: 6, windGustMph: 26 })).band).toBe("watch");
    expect(readWeather(forecast({ windMph: 12, windMphMax3h: 12, windGustMph: 31 })).band).toBe("downgrade");
  });

  it("treats likely rain as worth watching and steady rain as a downgrade", () => {
    expect(readWeather(forecast({ precipProbPct: 70, precipIn: 0.05 })).band).toBe("watch");
    expect(readWeather(forecast({ precipProbPct: 70, precipIn: 0.4 })).band).toBe("downgrade");
    expect(readWeather(forecast({ precipProbPct: 40, precipIn: 0.4 })).band).toBe("clear");
  });

  it("reads an amount alone as rain when the provider publishes no probability", () => {
    // MET Norway outside the Nordic region: an amount and no probability.
    expect(readWeather(forecast({ precipProbPct: null, precipIn: 0.15 })).band).toBe("watch");
    expect(readWeather(forecast({ precipProbPct: null, precipIn: 0.02 })).band).toBe("clear");
  });

  it("puts snow above rain and says the running backs gain", () => {
    const read = readWeather(forecast({ snowIn: 3, precipProbPct: 90, precipIn: 0.4, tempF: 28 }));
    expect(read.band).toBe("heavy");
    expect(read.advice).toMatch(/upgrade running backs/);
    expect(read.advice).not.toMatch(/Rain trims/);
  });

  it("mentions cold and says it has not moved scoring", () => {
    const read = readWeather(forecast({ tempF: 20, feelsLikeF: 8 }));
    expect(read.band).toBe("clear");
    expect(read.advice).toMatch(/Cold on its own has not moved scoring/);
  });

  it("says an early forecast will change, but only when there is something to act on", () => {
    expect(readWeather(forecast({ windMph: 18, windMphMax3h: 18, leadHours: 120 })).advice).toMatch(
      /5 days out and will change/,
    );
    expect(readWeather(forecast({ leadHours: 120 })).advice).not.toMatch(/days out/);
  });
});

describe("forecastSentence", () => {
  it("puts the conditions first, then the numbers", () => {
    expect(forecastSentence(forecast({ tempF: 48, feelsLikeF: 47, windMph: 18, windGustMph: 27, precipProbPct: 60 }))).toBe(
      "Mostly Sunny. 48 degrees, wind 18 mph from the northwest gusting to 27, 60 percent chance of precipitation.",
    );
  });

  it("adds the feels-like figure only when it differs by five degrees or more", () => {
    expect(forecastSentence(forecast({ tempF: 30, feelsLikeF: 18 }))).toMatch(/30 degrees, feels like 18/);
    expect(forecastSentence(forecast({ tempF: 30, feelsLikeF: 27 }))).not.toMatch(/feels like/);
  });

  it("leaves out a gust that is barely above the sustained wind", () => {
    expect(forecastSentence(forecast({ windMph: 10, windGustMph: 12 }))).not.toMatch(/gusting/);
  });

  it("says nothing for an indoor game", () => {
    expect(forecastSentence(forecast({ isIndoor: true }))).toBeNull();
  });

  it("names snow in inches when snow is expected", () => {
    expect(forecastSentence(forecast({ snowIn: 2 }))).toMatch(/2 inches of snow expected/);
    expect(forecastSentence(forecast({ snowIn: 1 }))).toMatch(/1 inch of snow expected/);
  });
});

describe("windDirectionWord", () => {
  it("names the direction the wind blows from", () => {
    expect(windDirectionWord(0)).toBe("north");
    expect(windDirectionWord(90)).toBe("east");
    expect(windDirectionWord(315)).toBe("northwest");
    expect(windDirectionWord(360)).toBe("north");
    expect(windDirectionWord(null)).toBeNull();
  });
});

describe("weatherSeverity", () => {
  it("orders the bands so a week can be sorted worst first", () => {
    expect(weatherSeverity("heavy")).toBeGreaterThan(weatherSeverity("downgrade"));
    expect(weatherSeverity("downgrade")).toBeGreaterThan(weatherSeverity("watch"));
    expect(weatherSeverity("watch")).toBeGreaterThan(weatherSeverity("clear"));
    expect(weatherSeverity("indoors")).toBe(weatherSeverity("unknown"));
  });
});

describe("a forecast with figures missing", () => {
  it("never reads an outdoor row with no wind figure as calm", () => {
    const read = readWeather(forecast({ windMph: null, windMphMax3h: null, windGustMph: null }));
    expect(read.band).toBe("unknown");
    expect(read.advice).toMatch(/no wind figure yet/);
  });

  it("reads snow from the conditions when no amount is published yet", () => {
    // The National Weather Service publishes amounts about three days out.
    const read = readWeather(
      forecast({ conditions: "Heavy Snow", precipProbPct: 90, precipIn: null, snowIn: null, tempF: 27 }),
    );
    expect(read.band).toBe("downgrade");
    expect(read.advice).toMatch(/Snow cuts passing/);
    expect(read.advice).toMatch(/No snowfall amount has been published yet/);
    expect(read.advice).not.toMatch(/Rain trims/);
  });

  it("does not call snow on the word alone when it is unlikely", () => {
    const read = readWeather(forecast({ conditions: "Slight Chance Snow Showers", precipProbPct: 20, snowIn: null }));
    expect(read.band).toBe("clear");
  });

  it("lifts a calm game one band on a strong gust, never two", () => {
    expect(readWeather(forecast({ windMph: 5, windMphMax3h: 5, windGustMph: 32 })).band).toBe("watch");
  });
});
