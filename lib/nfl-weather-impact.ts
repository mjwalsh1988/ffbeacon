/**
 * What a game's forecast means for a fantasy lineup, in one band and a
 * sentence or two. Pure: a forecast in, words out.
 *
 * THIS READS A FORECAST. IT ADJUSTS NO PROJECTION. Whether weather belongs in
 * the projection engine is docs/projection-engine/projection-engine-v2-plan.md
 * section 3.4's question, and that plan ships a signal only after an ablation
 * says it helps. Until then the forecast is shown beside the projection and
 * the reader is told what it has meant historically.
 *
 * THE BANDS ARE OURS; THE MEASUREMENTS BEHIND THEM ARE PUBLISHED. The cut
 * points below follow the studies the engine plan collected (Part 8, "Weather
 * effects"), and the weather page cites them by name:
 *   - Wind is the variable that matters. Completion rate and yards per attempt
 *     fall from about 10 mph sustained, the drop steepens near 15, and at 20
 *     and above passing efficiency, touchdown rate and field goal accuracy all
 *     fall sharply.
 *   - Rain is modest: a little less passing, a few more carries.
 *   - Snow is large and rare.
 *   - Cold on its own does not move team scoring.
 *   - A dome is the absence of a penalty, never a bonus.
 *
 * A MISSING FORECAST IS NEVER CALM. `null` in means the band "unknown" and a
 * sentence saying nothing is known yet. A reader who is told "no weather
 * concern" for a game we simply have no row for has been told something false.
 *
 * A RETRACTABLE ROOF IS TREATED AS CLOSED, the engine plan's rule: no feed says
 * whether a roof will be open on Sunday. The sentence says that assumption out
 * loud rather than calling the game indoors as a fact.
 */

import type { GameWeather } from "@/lib/season-pulse/types";

/** Worst to best is not the order; this is severity, low to high. */
export type WeatherBand = "unknown" | "indoors" | "clear" | "watch" | "downgrade" | "heavy";

export type WeatherRead = {
  band: WeatherBand;
  /** Two or three words for a chip. */
  label: string;
  /** What it means for a lineup. One or two plain sentences. */
  advice: string;
  /** The forecast as a sentence, numbers first. Null indoors and when unknown. */
  forecast: string | null;
};

/** Sustained wind, mph, where each band begins. */
export const WIND_WATCH_MPH = 10;
export const WIND_DOWNGRADE_MPH = 15;
export const WIND_HEAVY_MPH = 20;
/** A gust this strong lifts a calm game to "watch". */
export const GUST_WATCH_MPH = 25;
/** And one this strong lifts a breezy game (10 mph sustained or more) to "downgrade". */
export const GUST_DOWNGRADE_MPH = 30;
/** Rain is "likely" from this probability. */
export const RAIN_LIKELY_PCT = 60;
/** Liquid over the game window, inches. */
export const RAIN_WATCH_IN = 0.1;
export const RAIN_DOWNGRADE_IN = 0.3;
/** Snowfall over the game window, inches. */
export const SNOW_DOWNGRADE_IN = 0.5;
export const SNOW_HEAVY_IN = 2;
/** At or below this the temperature is mentioned, and only mentioned. */
export const COLD_F = 32;
/** A forecast further out than this is said to be early. */
export const EARLY_FORECAST_HOURS = 72;

const SEVERITY: Record<WeatherBand, number> = {
  unknown: 0,
  indoors: 0,
  clear: 1,
  watch: 2,
  downgrade: 3,
  heavy: 4,
};

/** How bad a band is, for sorting a week's games worst first. */
export function weatherSeverity(band: WeatherBand): number {
  return SEVERITY[band];
}

const LABELS: Record<WeatherBand, string> = {
  unknown: "No forecast yet",
  indoors: "Indoors",
  clear: "No weather concern",
  watch: "Worth watching",
  downgrade: "Weather downgrade",
  heavy: "Heavy weather",
};

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;

/** 0 to 360 degrees as the direction the wind blows FROM, in a word. */
export function windDirectionWord(degrees: number | null): string | null {
  if (degrees === null || !Number.isFinite(degrees)) return null;
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

const whole = (n: number) => String(Math.round(n));

function inches(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} ${rounded === 1 ? "inch" : "inches"}`;
}

/**
 * The forecast as one sentence: "48 degrees, wind 18 mph from the northwest
 * gusting to 27, 60 percent chance of rain."
 */
export function forecastSentence(weather: GameWeather): string | null {
  if (weather.isIndoor) return null;
  const parts: string[] = [];
  if (weather.tempF !== null) {
    const feels =
      weather.feelsLikeF !== null && Math.abs(weather.feelsLikeF - weather.tempF) >= 5
        ? `, feels like ${whole(weather.feelsLikeF)}`
        : "";
    parts.push(`${whole(weather.tempF)} degrees${feels}`);
  }
  if (weather.windMph !== null) {
    const from = windDirectionWord(weather.windDirDeg);
    const gust =
      weather.windGustMph !== null && weather.windGustMph >= weather.windMph + 5
        ? ` gusting to ${whole(weather.windGustMph)}`
        : "";
    parts.push(`wind ${whole(weather.windMph)} mph${from ? ` from the ${from}` : ""}${gust}`);
  }
  if (weather.snowIn !== null && weather.snowIn >= 0.1) {
    parts.push(`${inches(weather.snowIn)} of snow expected`);
  } else if (weather.precipProbPct !== null) {
    parts.push(`${whole(weather.precipProbPct)} percent chance of precipitation`);
  } else if (weather.precipIn !== null && weather.precipIn >= 0.01) {
    parts.push(`${inches(weather.precipIn)} of rain expected`);
  }
  if (parts.length === 0) return weather.conditions;
  const sentence = parts.join(", ");
  const lead = weather.conditions ? `${weather.conditions}. ` : "";
  return `${lead}${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function windBand(weather: GameWeather): WeatherBand {
  // The strongest sustained wind across the game, not only at kickoff: a front
  // that arrives in the third quarter still played half the game.
  const sustained = Math.max(weather.windMph ?? 0, weather.windMphMax3h ?? 0);
  const gust = weather.windGustMph ?? 0;
  if (sustained >= WIND_HEAVY_MPH) return "heavy";
  if (sustained >= WIND_DOWNGRADE_MPH) return "downgrade";
  // A strong gust lifts a game ONE band: a breezy game to a downgrade, a calm
  // one to worth watching. Never two.
  if (sustained >= WIND_WATCH_MPH) return gust >= GUST_DOWNGRADE_MPH ? "downgrade" : "watch";
  if (gust >= GUST_WATCH_MPH) return "watch";
  return "clear";
}

function rainBand(weather: GameWeather): WeatherBand {
  const amount = weather.precipIn;
  const chance = weather.precipProbPct;
  // MET Norway publishes an amount and no probability, so an amount alone has
  // to be able to say "rain". A probability alone, with no amount, is only
  // ever worth watching.
  const likely = chance === null ? amount !== null && amount >= RAIN_WATCH_IN : chance >= RAIN_LIKELY_PCT;
  if (!likely) return "clear";
  if (amount !== null && amount >= RAIN_DOWNGRADE_IN) return "downgrade";
  return "watch";
}

/** True when the forecast's own words say snow and it is likely to fall. */
function snowLikelyByConditions(weather: GameWeather): boolean {
  if (!weather.conditions || !/snow|blizzard|flurr/i.test(weather.conditions)) return false;
  return weather.precipProbPct === null || weather.precipProbPct >= RAIN_LIKELY_PCT;
}

function snowBand(weather: GameWeather): WeatherBand {
  if (weather.snowIn === null) {
    // The National Weather Service publishes amounts about three days out and
    // the conditions about seven. A Sunday game that says "Heavy Snow" on a
    // Wednesday has no amount yet, and must not be read as a little rain.
    return snowLikelyByConditions(weather) ? "downgrade" : "clear";
  }
  if (weather.snowIn >= SNOW_HEAVY_IN) return "heavy";
  if (weather.snowIn >= SNOW_DOWNGRADE_IN) return "downgrade";
  return "clear";
}

const WIND_ADVICE: Partial<Record<WeatherBand, string>> = {
  watch:
    "Wind at this speed makes deep passes and long field goals a little harder. It is a tiebreaker, not a reason to bench anyone.",
  downgrade:
    "This is the range where passing efficiency and long field goals drop measurably. In a close call, lean toward running backs and short-area receivers, and think twice about the kicker.",
  heavy:
    "Passing and kicking both suffer badly at this speed. Downgrade quarterbacks, deep threats and kickers on both sides.",
};

const RAIN_ADVICE: Partial<Record<WeatherBand, string>> = {
  watch: "Rain trims passing a little and adds a few carries. A small edge to running backs and nothing more.",
  downgrade: "Steady rain means fewer passing yards and more rushing volume. A real edge to running backs.",
};

const SNOW_ADVICE: Partial<Record<WeatherBand, string>> = {
  downgrade: "Snow cuts passing and lifts rushing. Downgrade quarterbacks and receivers, upgrade running backs.",
  heavy:
    "Heavy snow games cut passing sharply and lift rushing. Downgrade quarterbacks, receivers and kickers, and upgrade running backs.",
};

/** The fantasy read for one game's newest forecast. */
export function readWeather(weather: GameWeather | null): WeatherRead {
  if (!weather) {
    return {
      band: "unknown",
      label: LABELS.unknown,
      advice: "No forecast has been published for this game yet. That is not the same as fair weather.",
      forecast: null,
    };
  }
  if (weather.isIndoor) {
    return {
      band: "indoors",
      label: weather.roof === "retractable" ? "Retractable roof" : LABELS.indoors,
      advice:
        weather.roof === "retractable"
          ? "The stadium has a retractable roof. We treat it as closed, so no weather effect is assumed."
          : "Played indoors, so weather is not a factor.",
      forecast: null,
    };
  }

  // An outdoor row with no wind figure is not a calm game. Wind is the one
  // variable the bands are built on, so without it nothing is claimed.
  if (weather.windMph === null && weather.windMphMax3h === null) {
    return {
      band: "unknown",
      label: LABELS.unknown,
      advice: "The forecast for this game has no wind figure yet, so there is nothing to read from it.",
      forecast: forecastSentence(weather),
    };
  }

  const wind = windBand(weather);
  const rain = rainBand(weather);
  const snow = snowBand(weather);
  const band = [wind, rain, snow].reduce<WeatherBand>((worst, b) => (SEVERITY[b] > SEVERITY[worst] ? b : worst), "clear");

  const advice: string[] = [];
  // Snow outranks rain when both are forecast: it is the bigger effect and the
  // rain sentence would only repeat a weaker version of it.
  if (snow !== "clear") {
    advice.push(SNOW_ADVICE[snow] ?? "");
    if (weather.snowIn === null) advice.push("No snowfall amount has been published yet.");
  }
  else if (rain !== "clear") advice.push(RAIN_ADVICE[rain] ?? "");
  if (wind !== "clear") advice.push(WIND_ADVICE[wind] ?? "");
  if (advice.length === 0) advice.push("Nothing in this forecast should change a lineup.");
  if (weather.tempF !== null && weather.tempF <= COLD_F && band !== "heavy") {
    advice.push("Cold on its own has not moved scoring.");
  }
  if (weather.leadHours !== null && weather.leadHours > EARLY_FORECAST_HOURS && band !== "clear") {
    advice.push(`This forecast is ${Math.round(weather.leadHours / 24)} days out and will change.`);
  }

  return {
    band,
    label: LABELS[band],
    advice: advice.filter(Boolean).join(" "),
    forecast: forecastSentence(weather),
  };
}
