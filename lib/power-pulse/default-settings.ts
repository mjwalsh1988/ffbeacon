/**
 * Power Pulse model defaults.
 *
 * Every weight, cap, and toggle the engine reads lives here and is overridable
 * from league_power_pulse_settings without a deploy. A missing settings row
 * degrades to exactly this object, so the feature works on a fresh database.
 *
 * Bump `modelVersion` whenever a change alters what a score means, so stale
 * cached rows are identifiable.
 */

import type { PulsePosition } from "./types";
import { DEFAULT_WAR_SETTINGS, type WarSettings } from "@/lib/positional-war/default-settings";

// Re-exported so one document has one type: callers reading PowerPulseSettings
// never need to also import from lib/positional-war/default-settings.
export { DEFAULT_WAR_SETTINGS };
export type { WarSettings };

export type PowerPulseSettings = {
  modelVersion: string;

  /**
   * How the four components combine into the headline number. They should sum
   * to 1. When a component has no data (form before any games are played), its
   * weight is redistributed across the others proportionally.
   */
  weights: {
    /** Expected points per week. How much you score. */
    points: number;
    /** Schedule-adjusted win rate. Who you have to play. */
    schedule: number;
    /** Depth and bye coverage. What happens when someone gets hurt. */
    depth: number;
    /** Recent results against expectation. In-season only. */
    form: number;
  };

  /**
   * Recency weighting for reliability signals. The current season is the
   * strongest signal available, because teams, roles, and coaching change
   * between years. Prior seasons still contribute, at a steep discount.
   *
   * These multiply a single game's contribution to a player's blended
   * reliability. A game from the current season counts fully; the same game two
   * years ago counts a fifth as much.
   */
  recency: {
    currentSeason: number;
    oneSeasonBack: number;
    twoSeasonsBack: number;
    olderSeasons: number;
    /**
     * Within the current season, how many weeks it takes for a game's weight to
     * halve. Keeps a week 1 dud from anchoring a player in week 12.
     */
    currentSeasonHalfLifeWeeks: number;
  };

  /**
   * Projection reliability: does this player usually beat their projection?
   * `priorGames` is the empirical Bayes prior strength. With the default of 10,
   * a player with 10 graded games gets half their own ratio and half the
   * neutral 1.0, so a three-game hot streak nudges rather than rewrites.
   */
  reliability: {
    enabled: boolean;
    priorGames: number;
    minMultiplier: number;
    maxMultiplier: number;
  };

  /**
   * Availability: weeks played over weeks projected. A player who misses time
   * has a lower expected contribution even when healthy today.
   */
  availability: {
    enabled: boolean;
    /** Availability is blended toward 1.0 by this much, so it never zeroes out. */
    damping: number;
    minMultiplier: number;
  };

  /**
   * Injury designations, as multipliers on a week's projection. A player at 0
   * frees their slot for the next player up.
   */
  injury: {
    enabled: boolean;
    multipliers: Record<string, number>;
  };

  /**
   * Opponent strength, from nfl_defense_vs_position. Sleeper's own weekly
   * projections vary by only 2.6% to 5.4% across a season, so this is where
   * real schedule signal comes from.
   */
  opponent: {
    enabled: boolean;
    minMultiplier: number;
    maxMultiplier: number;
    /** Weight on the most recent completed season's splits. */
    currentSeasonWeight: number;
    /** Weight on the season before that. */
    priorSeasonWeight: number;
    /** Defenses with fewer sampled games than this fall back to neutral. */
    minGamesSampled: number;
  };

  /**
   * Per-week outcome variance. Expressed as a coefficient of variation (sigma
   * over mean). Used when a player has no measured ratio spread of their own.
   */
  variance: {
    defaultCv: Record<PulsePosition, number>;
    /** Graded games needed before a player's own measured spread is trusted. */
    minGamesForMeasured: number;
    /** Floor and ceiling on any single player's coefficient of variation. */
    minCv: number;
    maxCv: number;
  };

  /** Monte Carlo season simulation. */
  simulation: {
    runs: number;
    /** Fixed seed keeps a given roster state reproducible between runs. */
    seed: number;
  };

  /**
   * Mapping a within-league z-score onto the display scale, via the normal
   * percentile. An average team lands at 50. `sharpness` above 1 pushes the
   * extremes further apart; below 1 pulls the league together.
   */
  display: {
    min: number;
    max: number;
    sharpness: number;
  };

  /**
   * Positional WAR display and model settings. See
   * lib/positional-war/default-settings.ts for the field-by-field reasoning.
   * Lives inside this document rather than a table of its own, because the
   * Positional WAR model reuses the entire Power Pulse projection stack and a
   * half-applied edit across two documents could produce a curve computed
   * under mixed settings.
   */
  war: WarSettings;
};

export const DEFAULT_POWER_PULSE_SETTINGS: PowerPulseSettings = {
  // pp-3 (2026-08-31): two corrections, both measured rather than tuned.
  //
  // A season-long injury designation no longer overrides a per-week projection.
  // Sleeper publishes a return timeline (out through week 4, projected from week
  // 5) and we were deleting it, scoring Jordyn Tyson at 0.0 for fourteen weeks
  // against Sleeper's own 10.7 a week from week 5, and Josh Jacobs at 0.0
  // against about 14. See injuryMultiplier in ./project.ts.
  //
  // The fallback variance figures are now the ones measured from our own 2025
  // player_stats rather than estimates. See variance.defaultCv below.
  //
  // Both change what a score means, so cached pp-2 rows are stale by definition
  // and every league rescores on next view.
  modelVersion: "pp-3",

  weights: {
    points: 0.55,
    schedule: 0.25,
    depth: 0.1,
    form: 0.1,
  },

  recency: {
    currentSeason: 1,
    oneSeasonBack: 0.45,
    twoSeasonsBack: 0.2,
    olderSeasons: 0.08,
    currentSeasonHalfLifeWeeks: 8,
  },

  reliability: {
    enabled: true,
    priorGames: 10,
    minMultiplier: 0.85,
    maxMultiplier: 1.15,
  },

  availability: {
    enabled: true,
    damping: 0.5,
    minMultiplier: 0.7,
  },

  injury: {
    enabled: true,
    multipliers: {
      OUT: 0,
      IR: 0,
      PUP: 0,
      NA: 0,
      SUS: 0,
      COV: 0,
      DNR: 0,
      DOUBTFUL: 0.25,
      QUESTIONABLE: 0.9,
      PROBABLE: 1,
    },
  },

  opponent: {
    enabled: true,
    minMultiplier: 0.85,
    maxMultiplier: 1.15,
    currentSeasonWeight: 0.7,
    priorSeasonWeight: 0.3,
    minGamesSampled: 8,
  },

  variance: {
    // MEASURED, not estimated. Each figure is the median week-to-week
    // coefficient of variation (a player's own standard deviation over his own
    // mean) across the top 36 scorers at that position in the 2025 regular
    // season, from player_stats, requiring 12 games and more than 5 points a
    // game so a fringe player's noise does not set the number.
    //
    // The originals were plausible guesses and four of the six were wrong in a
    // way that mattered. Wide receiver was the worst at 0.65 against a measured
    // 0.57, and a league starts three or more of them, so the overstatement
    // inflated every team's weekly spread and pushed every matchup closer to a
    // coin flip. Quarterback ran the other way, 0.35 against a measured 0.42.
    //
    // Ordering still reads the way the old comment described it: quarterbacks
    // are the steadiest and defenses the most volatile. Only the magnitudes
    // moved. These are the fallbacks for players with no measured history of
    // their own; a player with eight or more graded weeks uses his own.
    defaultCv: {
      QB: 0.42,
      RB: 0.59,
      WR: 0.57,
      TE: 0.65,
      K: 0.51,
      DEF: 0.8,
    },
    minGamesForMeasured: 8,
    minCv: 0.15,
    maxCv: 1.2,
  },

  simulation: {
    runs: 4000,
    seed: 20260801,
  },

  display: {
    min: 1,
    max: 99,
    sharpness: 1,
  },

  war: DEFAULT_WAR_SETTINGS,
};

/**
 * Merge a stored settings document over the code defaults. Only recognized keys
 * survive, and nested objects merge one level deep, so a partial admin save
 * cannot drop a whole section.
 */
export function mergePowerPulseSettings(stored: unknown): PowerPulseSettings {
  const base = DEFAULT_POWER_PULSE_SETTINGS;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const s = stored as Record<string, unknown>;

  const obj = <T extends object>(key: string, fallback: T): T => {
    const v = s[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as object) } as T;
  };

  return {
    modelVersion: typeof s.modelVersion === "string" ? s.modelVersion : base.modelVersion,
    weights: obj("weights", base.weights),
    recency: obj("recency", base.recency),
    reliability: obj("reliability", base.reliability),
    availability: obj("availability", base.availability),
    injury: {
      ...base.injury,
      ...obj("injury", base.injury),
      multipliers: {
        ...base.injury.multipliers,
        ...(((s.injury as Record<string, unknown>)?.multipliers as Record<string, number>) ?? {}),
      },
    },
    opponent: obj("opponent", base.opponent),
    variance: {
      ...base.variance,
      ...obj("variance", base.variance),
      defaultCv: {
        ...base.variance.defaultCv,
        ...(((s.variance as Record<string, unknown>)?.defaultCv as Record<
          PulsePosition,
          number
        >) ?? {}),
      },
    },
    simulation: obj("simulation", base.simulation),
    display: obj("display", base.display),
    war: obj("war", base.war),
  };
}
