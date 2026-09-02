/**
 * FF Beacon projection model defaults.
 *
 * Every weight, cap and toggle the engine reads lives here and is overridable
 * from `league_power_pulse_settings` without a deploy, under the
 * `beaconProjections` key. A missing settings row degrades to exactly this
 * object, so the feature works on a fresh database.
 *
 * WHY THIS LIVES IN THE POWER PULSE SETTINGS DOCUMENT
 *
 * Same reason Positional WAR's settings live there rather than in a table of
 * their own: this model feeds the same projection stack Power Pulse and
 * Positional WAR read, and a half-applied edit across two documents could
 * produce a cached league score computed under mixed settings. One document,
 * one edit, one version.
 *
 * IT SHIPS DISABLED
 *
 * `enabled` defaults to false. Nothing on the site changes until an admin turns
 * it on, and the thing that earns that edit is the scoreboard at
 * /admin/projections showing our mean absolute error beating Sleeper's on the
 * same graded weeks. Building a projection model and switching it on because it
 * exists is how a product ships a worse number under its own name.
 */

import type { ProjectionPosition } from "./types";

export type ProjectionSettings = {
  /**
   * Bump whenever a change alters what a projected number MEANS, so stored
   * ffbeacon rows and every cache derived from them are identifiable as stale.
   */
  modelVersion: string;

  /** Off until the scoreboard earns it. */
  enabled: boolean;

  /**
   * How a player's role is measured from player_stats.
   *
   * The half life is the load-bearing number. Published stabilisation work puts
   * a target share at four to six games before it is signal rather than noise,
   * and three to four games before a usage shift reads as structural. A four
   * week half life puts that finding directly into the model: the last four
   * games carry about as much weight as everything before them combined.
   */
  usage: {
    /** Weeks for a game's weight to halve, within a season. */
    halfLifeWeeks: number;
    /**
     * Season distance ladder.
     *
     * The DEFAULTS are the same four numbers as the Power Pulse `recency`
     * block, chosen for the same reason, but this is a SEPARATE, independently
     * editable setting and not a shared one. Editing Power Pulse's recency
     * ladder on /admin/power-pulse does not change these, and editing these
     * does not change that. Two models that happen to agree today are allowed
     * to diverge, because they answer different questions: Power Pulse's ladder
     * weights a player's reliability against his own projection, and this one
     * weights how recently he held a role.
     *
     * Said out loud because a comment claiming these were shared would send
     * someone to the wrong admin field to change a number.
     */
    seasonWeights: {
      currentSeason: number;
      oneSeasonBack: number;
      twoSeasonsBack: number;
      olderSeasons: number;
    };
    /** Weighted games a player needs before his shares are published at all. */
    minWeightedGames: number;
    /** A team-week below this many targets is too thin to be a denominator. */
    minTeamTargets: number;
    /** Same, for carries. */
    minTeamCarries: number;
    /**
     * Empirical Bayes prior on the SHARES, in weighted games. Small on purpose.
     * A role is the part of a player's line that persists, so we believe it
     * quickly. Contrast efficiency.priorGames below.
     */
    priorGames: number;
  };

  /**
   * How opportunity becomes points.
   *
   * `priorGames` is deliberately six times the usage prior. Touchdown rate,
   * yards per carry and yards per target revert hard toward the positional
   * mean, and expected touchdowns are both more stable and more predictive than
   * actual touchdowns. A player who scored on 12% of his carries last season is
   * mostly telling us he got lucky, so his own rate is worth about a fifth of
   * the league's until he has two full seasons of it.
   */
  efficiency: {
    priorGames: number;
  };

  /**
   * Game environment, from nfl_game_odds.
   *
   * Sleeper's projection contains none of this: measured on the live 2026
   * board, one receiver's projection spans 3% across seven different opponents
   * with identical projected targets in five of them. A game total and a spread
   * are the two numbers that move fantasy scoring most and that no season
   * average can carry.
   *
   * Both adjustments are small on purpose. A 7 point favourite shifts about 3%
   * of its plays from passing to rushing, which is the right order of magnitude
   * and deliberately not more. When no odds row exists BOTH multipliers are
   * exactly 1: a missing line is an adjustment we did not make, never a neutral
   * game script we asserted.
   */
  environment: {
    enabled: boolean;
    /** The league-average implied team total the ratio is taken against. */
    leagueAverageImpliedTotal: number;
    /** Exponent on the implied-total ratio. 0.5 means a 10% richer game adds 5%. */
    totalWeight: number;
    totalMin: number;
    totalMax: number;
    /** Share shifted from passing to rushing per point of spread. */
    spreadWeight: number;
    /** Hard cap on the total share shift, either direction. */
    scriptMax: number;
  };

  /**
   * Per-position spread calibration.
   *
   * Every projection source over-spreads: twelve seasons analysed by Fantasy
   * Football Analytics give calibration slopes below 1.0 at EVERY position (QB
   * 0.67, TE 0.72, RB 0.79, WR 0.85). The top players are projected too high
   * and the late-round starters too low. Applied to the BLENDED projection, so
   * it corrects Sleeper's spread as well as ours.
   *
   * These defaults are the published figures. The scoreboard at
   * /admin/projections is how they get replaced by our own measurement.
   */
  calibration: {
    enabled: boolean;
    slope: Record<ProjectionPosition, number>;
  };

  /**
   * How much of the stored row is ours.
   *
   * Blend, never replace. An equal-weighted average of sources beat individual
   * sources in 69% of comparisons across twelve seasons, and equal weighting
   * beat clever historical weighting. In week 1 our weight is 0 and the stored
   * row is Sleeper's, rescored. By `gamesForMax` it reaches `max`, which is
   * capped at half deliberately: half of a source with no track record is
   * already an aggressive claim.
   */
  blend: {
    min: number;
    max: number;
    gamesForMax: number;
  };
};

export const DEFAULT_PROJECTION_SETTINGS: ProjectionSettings = {
  // pe-1 (2026-09-01): first version. Usage shares from our own player_stats,
  // team volume modulated by the published game total and spread, league-average
  // conversion rates shrunk toward the player's own, per-position spread
  // calibration, and a blend that starts at zero and caps at half.
  modelVersion: "pe-1",

  enabled: false,

  usage: {
    halfLifeWeeks: 4,
    seasonWeights: {
      currentSeason: 1,
      oneSeasonBack: 0.45,
      twoSeasonsBack: 0.2,
      olderSeasons: 0.08,
    },
    minWeightedGames: 3,
    minTeamTargets: 10,
    minTeamCarries: 10,
    priorGames: 4,
  },

  efficiency: {
    priorGames: 24,
  },

  environment: {
    enabled: true,
    // The mean implied team total across a modern NFL season sits near 22.5,
    // which is half of a 45 point game with no spread. Stored rather than
    // computed from the table so a week with three published lines cannot move
    // the baseline the other twenty nine teams are measured against.
    leagueAverageImpliedTotal: 22.5,
    totalWeight: 0.5,
    totalMin: 0.85,
    totalMax: 1.15,
    spreadWeight: 0.004,
    scriptMax: 0.08,
  },

  calibration: {
    enabled: true,
    slope: { QB: 0.67, RB: 0.79, WR: 0.85, TE: 0.72 },
  },

  // MEASURED, AND THE MEASUREMENT SAYS ZERO.
  //
  // A walk-forward backtest of the whole 2025 season ran on 2026-09-01
  // (npm run backtest:projections). For each week it rebuilt the model from
  // the two prior seasons plus that season's earlier weeks ONLY, then graded
  // against what actually happened. Pooled, PPR, 6,097 graded player-weeks:
  //
  //                 MAE     bias    corr
  //     sleeper    4.116   -0.391   0.699
  //     blended    4.372   -0.589   0.686     6.2% WORSE
  //     ours alone 5.266   -0.961   0.637     clearly worse
  //
  // And it degrades in proportion to how much of our model is used. In week 1,
  // where the blend weight is 0, blended and sleeper are identical to three
  // decimals (3.907 against 3.908). From week 7, where the weight reaches its
  // cap, blended runs about 0.35 points worse every week. That is not noise,
  // it is a dose-response curve, and it points one way.
  //
  // So `max` is 0. Our source still exists, still builds nightly, still gets
  // graded, and at weight 0 it is a CALIBRATED Sleeper, which the week 1 rows
  // show is a hair better than raw Sleeper rather than worse. What it does not
  // do is claim a model that has not earned it.
  //
  // The one place our model already wins is quarterbacks: blended MAE 6.320
  // against Sleeper's 6.540, with the bias cut from -2.834 to -1.232. A
  // per-position blend weight is the obvious next move and is deliberately NOT
  // taken here, because one position beating the incumbent on one season is a
  // lead to follow rather than a result to ship.
  //
  // RAISE THIS WHEN, AND ONLY WHEN, A RERUN OF THE BACKTEST SAYS SO.
  blend: {
    min: 0,
    max: 0,
    gamesForMax: 6,
  },
};

/**
 * Merge a stored settings document over the code defaults.
 *
 * Only recognized keys survive and nested objects merge one level deep, so a
 * partial admin save cannot drop a whole section. Matches
 * mergePowerPulseSettings exactly, including the two-level handling for the
 * records (`calibration.slope`, `usage.seasonWeights`) that a shallow merge
 * would replace wholesale and thereby drop a position.
 */
export function mergeProjectionSettings(stored: unknown): ProjectionSettings {
  const base = DEFAULT_PROJECTION_SETTINGS;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return base;
  const s = stored as Record<string, unknown>;

  const obj = <T extends object>(key: string, fallback: T): T => {
    const v = s[key];
    if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
    return { ...fallback, ...(v as object) } as T;
  };

  const nested = (parent: string, child: string): Record<string, unknown> => {
    const p = s[parent];
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const c = (p as Record<string, unknown>)[child];
    if (!c || typeof c !== "object" || Array.isArray(c)) return {};
    return c as Record<string, unknown>;
  };

  return {
    modelVersion:
      typeof s.modelVersion === "string" ? s.modelVersion : base.modelVersion,
    enabled: typeof s.enabled === "boolean" ? s.enabled : base.enabled,
    usage: {
      ...obj("usage", base.usage),
      seasonWeights: {
        ...base.usage.seasonWeights,
        ...(nested("usage", "seasonWeights") as Partial<
          ProjectionSettings["usage"]["seasonWeights"]
        >),
      },
    },
    efficiency: obj("efficiency", base.efficiency),
    environment: obj("environment", base.environment),
    calibration: {
      ...obj("calibration", base.calibration),
      slope: {
        ...base.calibration.slope,
        ...(nested("calibration", "slope") as Partial<
          Record<ProjectionPosition, number>
        >),
      },
    },
    blend: obj("blend", base.blend),
  };
}
