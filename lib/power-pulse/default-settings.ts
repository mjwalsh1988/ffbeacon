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
import {
  DEFAULT_PROJECTION_SETTINGS,
  mergeProjectionSettings,
  type ProjectionSettings,
} from "@/lib/projections/default-settings";

// Re-exported for the same reason DEFAULT_WAR_SETTINGS is: a caller holding a
// PowerPulseSettings should never need a second import to name its parts.
export { DEFAULT_PROJECTION_SETTINGS };
export type { ProjectionSettings };

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
    /** Weight on the more recent of the two seasons actually found usable. */
    currentSeasonWeight: number;
    /** Weight on the older of the two. */
    priorSeasonWeight: number;
    /** Defenses with fewer sampled games than this fall back to neutral. */
    minGamesSampled: number;
    /** Read shrunk_multiplier rather than the raw multiplier. */
    useAdjusted: boolean;
    /** Empirical Bayes prior on the sample-size shrink, in games. */
    priorGames: number;
    /**
     * How much of a position's matchup swing survives, 0 to 1. Consumed by the
     * defense-splits calc that writes shrunk_multiplier, not by the reader
     * here: opponentMultiplier in ./project.ts reads the already-shrunk value
     * off the row and does not repeat the shrink.
     */
    positionReliability: Record<PulsePosition, number>;
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
   * Should a team's projection assume its manager will set a perfect lineup?
   *
   * IT DOES TODAY, AND THAT IS A KNOWN BIAS. Every remaining week is projected
   * from `buildOptimalLineup`, so the model assumes all twelve managers extract
   * every point their roster can produce for the rest of the season. Measured
   * against settled results, real managers in a normal league start between
   * about 76% and 90% of what was available to them, which is a gap of several
   * points a week between the best and worst operator in the same room.
   *
   * The Manager Ledger measures exactly that share, so the correction is
   * available. Turning it on multiplies each team's projected weekly mean by a
   * factor built from their own measured efficiency.
   *
   * OFF BY DEFAULT, DELIBERATELY. It is a judgement call, not a bug fix, and it
   * has two costs worth stating. It is partly self-fulfilling: telling a
   * manager they are projected lower because they set bad lineups is a claim
   * about their future behaviour, not their roster. And it is noisy early, when
   * three weeks of evidence is being asked to predict fourteen. `blend` and
   * `minWeeks` exist to bound both. Bump `modelVersion` when changing any of
   * this, so every league rescores rather than serving a mix.
   */
  lineupRealism: {
    /** Nothing changes until this is true. */
    enabled: boolean;
    /**
     * How far to move from "perfect lineup" toward the measured efficiency.
     * 0 is the current behaviour, 1 applies the measured share in full. The
     * default of 0.5 is a hedge: a manager's past is evidence about their
     * future, but not proof of it.
     */
    blend: number;
    /** Graded weeks required before a team's own measurement is used at all. */
    minWeeks: number;
    /**
     * The lowest factor any team can be given. A manager who has started 70% of
     * their points is not going to keep doing that for fourteen more weeks, and
     * a projection that assumes they will is a worse prediction than one that
     * assumes they improve. This is where that floor is set.
     */
    floor: number;
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

  /**
   * The FF Beacon projection model. See lib/projections/default-settings.ts for
   * the field-by-field reasoning.
   *
   * Lives inside this document for the same reason `war` does: it feeds the
   * very projection stack Power Pulse and Positional WAR read, so a
   * half-applied edit across two documents could produce a cached league score
   * computed under mixed settings. One document, one edit, one version.
   *
   * `enabled` defaults to FALSE. Nothing on the site changes until an admin
   * turns it on, and the thing that earns that edit is the scoreboard at
   * /admin/projections showing our error beating Sleeper's on the same graded
   * weeks.
   */
  beaconProjections: ProjectionSettings;
};

export const DEFAULT_POWER_PULSE_SETTINGS: PowerPulseSettings = {
  // pp-6 (2026-09-01): opponent strength now sees the current season. The
  // lookup used to be a hardcoded [season - 1, season - 2], which meant a
  // defense's rating during the 2026 season was frozen on 2025 and 2024
  // forever and could never learn anything about 2026 itself. It now walks
  // candidate seasons most recent first (lib/projections/defense-seasons.ts)
  // and takes the first two that actually have a usable row, so the current
  // season fills the currentSeasonWeight slot for itself as soon as it has
  // enough sampled games, with no date check anywhere in the code.
  //
  // The multiplier being read also changed, from the raw multiplier to the
  // opponent-adjusted, sample-size-shrunk one (shrunkMultiplier, gated by
  // opponent.useAdjusted below), which strips the schedule bias the raw
  // figure carried and pulls it back toward neutral by how much a matchup
  // effect actually persists.
  //
  // Both changes alter what a score means for every league that has ever
  // faced an opponent, so every cached Power Pulse row and Positional WAR
  // curve is stale by definition on this bump.
  //
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
  modelVersion: "pp-6",

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
    useAdjusted: true,

    // priorGames and positionReliability feed the empirical Bayes shrink that
    // produces shrunk_multiplier (lib/projections/adjust.ts shrinkMultiplier,
    // run by the defense-splits calc, not by this reader). priorGames 6 means
    // a defense with 6 sampled games in the current season is already
    // contributing at half strength rather than waiting to clear a hard
    // threshold, which is the whole point: a defense with 3 games this season
    // should count at 3/9 strength, not be ignored until game 8.
    priorGames: 6,

    // The question this asks is "does a matchup number this season say
    // anything about the same matchup number next season".
    //
    // MEASURED, PE-T016, 2026-09-01, on our own table after the opponent
    // adjustment landed. Two season pairs, all 32 teams, PPR, both the raw
    // multiplier and the opponent-adjusted one:
    //
    //          raw 25/24   adj 25/24   raw 24/23   adj 24/23    mean
    //   DEF      0.319       0.276       0.297       0.238      0.283
    //   RB       0.243       0.269       0.285       0.356      0.288
    //   TE       0.152       0.223       0.247       0.032      0.164
    //   K        0.147       0.113       0.026       0.079      0.091
    //   QB       0.107       0.043      -0.117      -0.075     -0.011
    //   WR      -0.097      -0.056      -0.027      -0.081     -0.065
    //
    // The values below are that mean of four, floored at zero and rounded to
    // two places. Pooling all four rather than taking the adjusted pair alone
    // is deliberate: with 32 teams the standard error on any single one of
    // these correlations is about 0.19, so no two cells in a row here are
    // distinguishable from each other, and picking the flattering one would be
    // fitting noise.
    //
    // WHAT THE ADJUSTMENT DID, HONESTLY. It clearly helped running backs
    // (0.264 to 0.313 across the two pairs) and did nothing measurable
    // anywhere else; team defense actually reads slightly worse adjusted. The
    // adjustment is kept regardless, because it removes a bias we can
    // demonstrate exists (a defense that drew the six best offenses is not
    // generous) and a correctness fix does not need a correlation to justify
    // it. But it did not rescue the positions the plan hoped it would, and
    // saying otherwise would be inventing a result.
    //
    // TWO POSITIONS ARE NOW ZERO, AND BOTH ARE DELIBERATE.
    //
    // WR is negative in ALL FOUR measurements. No receiver matchup adjustment
    // applies at all. That is the honest reading, not an oversight, and it is
    // the position where a spurious 15% swing would do the most damage because
    // rosters carry more receivers than anything else.
    //
    // QB is the interesting one, and it is where our own data DISAGREES with
    // published work. 4for4 measures fantasy points allowed to quarterbacks at
    // 0.26 to 0.27, the strongest of any position. We measure -0.011. The
    // likely reason is that we are not measuring the same thing: our figure is
    // the top ONE startable quarterback performance per game, clamped, which
    // is a far noisier quantity than a full-season points-allowed rank. We use
    // our own number because it is our own metric, computed our way, and it is
    // the one being applied. An admin who trusts the published figure more can
    // raise this in one edit, and the disagreement is recorded here so that
    // edit is an informed choice rather than a guess.
    positionReliability: {
      DEF: 0.28,
      RB: 0.29,
      TE: 0.16,
      K: 0.09,
      QB: 0.0,
      WR: 0.0,
    },
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

  lineupRealism: {
    enabled: false,
    blend: 0.5,
    minWeeks: 4,
    floor: 0.85,
  },

  display: {
    min: 1,
    max: 99,
    sharpness: 1,
  },

  war: DEFAULT_WAR_SETTINGS,

  beaconProjections: DEFAULT_PROJECTION_SETTINGS,
};

/**
 * The version string every cache is keyed on.
 *
 * A STORED DOCUMENT CAN NEVER PIN THIS, AND THAT IS THE WHOLE POINT.
 *
 * modelVersion has exactly one job: to say "the model changed, so every cached
 * Power Pulse row and every Positional WAR curve computed under the old one is
 * stale". A stored settings row is by definition older than the code it is
 * being merged into, so letting it supply the version means the newest code
 * announces itself with the oldest name and nothing invalidates.
 *
 * That was not hypothetical. Found in production on 2026-09-01: the global row
 * read `modelVersion: "pp-2"` while the code had moved to pp-6 through four
 * model changes, so the bump that was supposed to force every league to
 * rescore would have done nothing at all. The row also still carried the
 * pre-pp-5 reliability clamps, which is a separate problem and an admin edit to
 * fix, but the version pin is a mechanism bug and it is fixed here.
 *
 * An admin edit still has to invalidate caches, so the stored document's own
 * shape is folded in as a short fingerprint. Both guarantees now hold at once:
 * a code change gives a new base version, an admin save gives a new
 * fingerprint, and a stale stored string can pin neither.
 */
export function effectiveModelVersion(
  codeVersion: string,
  stored: Record<string, unknown> | null | undefined,
): string {
  if (!stored) return codeVersion;
  const fingerprint = stableFingerprint(stored);
  return fingerprint === null ? codeVersion : `${codeVersion}+${fingerprint}`;
}

/**
 * A short, order-independent fingerprint of a settings document.
 *
 * Keys are sorted before hashing so two documents that differ only in key order
 * fingerprint identically, which matters because Postgres does not preserve
 * jsonb key order and an admin round-trip would otherwise look like an edit.
 *
 * `modelVersion` is excluded from the hash. It is an output of this function,
 * not an input, and including it would make the fingerprint change every time
 * the code version did, which is already accounted for separately.
 */
function stableFingerprint(stored: Record<string, unknown>): string | null {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "modelVersion")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return entries.map(([key, v]) => [key, canonical(v)]);
    }
    return value;
  };

  let json: string;
  try {
    json = JSON.stringify(canonical(stored));
  } catch {
    // A settings document that cannot be serialized cannot be fingerprinted.
    // Falling back to the bare code version is safe: it under-invalidates
    // rather than producing a version string that changes every render.
    return null;
  }
  if (!json || json === "[]") return null;

  // FNV-1a, 32 bit. Not cryptographic and does not need to be: this
  // distinguishes one admin's saved document from another's, and a collision
  // costs one league one stale cache row until the next real change.
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Merge a stored settings document over the code defaults. Only recognized keys
 * survive, and nested objects merge one level deep, so a partial admin save
 * cannot drop a whole section.
 *
 * THE STORED DOCUMENT CANNOT PIN modelVersion. See effectiveModelVersion above.
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
    modelVersion: effectiveModelVersion(base.modelVersion, s),
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
    opponent: {
      ...base.opponent,
      ...obj("opponent", base.opponent),
      positionReliability: {
        ...base.opponent.positionReliability,
        ...(((s.opponent as Record<string, unknown>)?.positionReliability as Record<
          PulsePosition,
          number
        >) ?? {}),
      },
    },
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
    lineupRealism: obj("lineupRealism", base.lineupRealism),
    display: obj("display", base.display),
    war: obj("war", base.war),
    // Delegated rather than merged with `obj`, because the projection document
    // has its own two-level records (calibration.slope, usage.seasonWeights)
    // that a one-level merge would replace wholesale and thereby drop a
    // position from.
    beaconProjections: mergeProjectionSettings(s.beaconProjections),
  };
}
