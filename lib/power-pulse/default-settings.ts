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
import {
  DEFAULT_WAR_SETTINGS,
  type WarSettings,
} from "@/lib/positional-war/default-settings";

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
   * Projection reliability: does this player beat his projection by more than
   * his positional peers do? `priorGames` is the empirical Bayes prior strength.
   * A player with `priorGames` graded games gets half his own centered ratio and
   * half the neutral 1.0.
   *
   * READ THE MEASUREMENT BEFORE WIDENING THESE. See the DEFAULT block below.
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
  // pp-5 (2026-09-01): the reliability multiplier is centered on the player's
  // own position before it is applied, and its range is cut from plus or minus
  // 15% to plus or minus 5%.
  //
  // Uncentered, it was marking the whole quarterback pool down about 5% and the
  // whole tight end pool up about 3%, because a ratio has a floor at zero and
  // receivers post a genuine goose egg far more often than quarterbacks do.
  // That is a property of the position, not of the player, and applying it as
  // if it were the player is what tilted every cross-position comparison. See
  // positionBaselineRatio in lib/calculate-projection-accuracy.ts.
  //
  // The multiplier's VALUES change for every player in the table, and nothing
  // in a cached Power Pulse row or Positional WAR curve records which version
  // of the accuracy table produced it, so this bump is the only thing that can
  // say the cached rows are stale.
  //
  // pp-4 (2026-08-31): the volatility fallback is now a measured curve rather
  // than one number per position. It varies with the player's own projected
  // points and with the league's scoring base, because both change the answer
  // and neither could be carried by a single figure. Receivers are more volatile
  // than running backs across the whole startable range, which the previous
  // sample had backwards. See lib/power-pulse/variance-curve.ts.
  //
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
  modelVersion: "pp-5",

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

  // A NUDGE, NOT A REORDER. These numbers are set from a measurement rather
  // than from taste, and the measurement is worth keeping because the instinct
  // to widen them back out is strong.
  //
  // The question this block asks is "does this player beat his projection".
  // Measured on 2026-09-01 against 2024 and 2025 player_stats, the year over
  // year correlation of that answer, for every player with at least eight
  // graded games in BOTH seasons, is:
  //
  //     QB 0.02   RB -0.06   WR -0.03   TE 0.02   K -0.01   DEF 0.16
  //
  // It does not persist. Last year's beat rate says nothing about this year's,
  // so almost all of what this multiplier carries is noise, and the correct
  // Bayesian weight on a signal with no measured persistence is close to zero.
  //
  // The old settings (priorGames 10, range 0.85 to 1.15) let that noise run at
  // plus or minus 15%. Among the top 34 quarterbacks in the 2026 pool the
  // multiplier's own spread was 67% as large as the spread of the projections
  // it was multiplying
  // (log SD 0.073 against 0.109), which is why the quarterback board came out
  // scrambled while the running back board, whose projections are spread far
  // wider, looked fine. Concretely: Jalen Hurts was carrying 0.855 and Trevor
  // Lawrence 1.127, a 27% swing, against real gaps between the top ten
  // quarterbacks of 2% to 4%.
  //
  // priorGames 60 means a fully-sampled veteran (effective weight around 12 in
  // the blended row) keeps about a sixth of his own figure. The 0.95 to 1.05
  // clamp is the backstop: whatever the ratio says, this can move a projection
  // by at most a twentieth, which is smaller than the gaps it must not
  // reorder. Turning `enabled` off entirely is defensible on the same evidence;
  // it is left on because the small persistent part is real and because
  // availability, which is a genuinely persistent signal, is a separate block.
  reliability: {
    enabled: true,
    priorGames: 60,
    minMultiplier: 0.95,
    maxMultiplier: 1.05,
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
    // LAST RESORT ONLY, and no longer the usual answer.
    //
    // The fallback for a player with no measured history is now read off a
    // curve keyed on his own projected points and on the league's scoring base
    // (lib/power-pulse/variance-curve.ts). These single numbers are what remains
    // for a position with no curve, or a player carrying no projected points to
    // place on one.
    //
    // They are the median week-to-week coefficient of variation across the
    // STARTABLE range at each position, 2023 through 2025, from player_stats:
    // the top 36 running backs and receivers, 24 quarterbacks, 18 tight ends,
    // 14 kickers and defenses. The startable range is the correction that
    // matters. Measuring the top 36 at every position weighted RB25-48, a pool
    // of committee backs whose usage genuinely swings week to week, equally with
    // the bell cows, and that alone made running backs read as more volatile
    // than receivers. Inside the range where starters live, receivers are the
    // more volatile position at every band, because volume is stability.
    defaultCv: {
      QB: 0.414,
      RB: 0.527,
      WR: 0.548,
      TE: 0.573,
      K: 0.507,
      DEF: 0.718,
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
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    return base;
  const s = stored as Record<string, unknown>;

  const obj = <T extends object>(key: string, fallback: T): T => {
    const v = s[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as object) } as T;
  };

  return {
    modelVersion:
      typeof s.modelVersion === "string" ? s.modelVersion : base.modelVersion,
    weights: obj("weights", base.weights),
    recency: obj("recency", base.recency),
    reliability: obj("reliability", base.reliability),
    availability: obj("availability", base.availability),
    injury: {
      ...base.injury,
      ...obj("injury", base.injury),
      multipliers: {
        ...base.injury.multipliers,
        ...(((s.injury as Record<string, unknown>)?.multipliers as Record<
          string,
          number
        >) ?? {}),
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
