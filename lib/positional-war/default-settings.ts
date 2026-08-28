/**
 * Positional WAR display and model defaults.
 *
 * These live inside the Power Pulse settings document
 * (league_power_pulse_settings.settings.war) rather than in a table of their
 * own, because the WAR model reuses the entire Power Pulse projection stack.
 * Splitting the two across documents would let a half-applied edit produce a
 * curve computed under mixed settings.
 *
 * Every field here is in the cache fingerprint, so an admin save invalidates
 * every league on its next view with no fan-out, no cron, and no modelVersion
 * bump. That is different from the Power Pulse block directly above it in the
 * admin form, which is why the fieldset says so out loud.
 */

export type WarSettings = {
  /** Bumped by hand for any change the fingerprint does not otherwise capture. */
  modelVersion: string;
  /**
   * Curve cap, as a multiple of structural demand. Past about two and a half
   * times demand every series is flat and adds pixels without adding
   * information. Below 1.0 the cap would cut the curve before the replacement
   * line, which is why the validator floors it there.
   */
  displayDepthMultiple: number;
  /**
   * Floor on the STORED curve depth.
   *
   * Must stay at or above WAR_CHART_MAX_RANK (36, in
   * lib/positional-war/chart-geometry.ts), because the dashboard's chart,
   * scatterplot and player table all read the top 36 at every position off
   * the stored curve. It was 24, which left a 12-team league's kickers,
   * defenses and tight ends 30 rows deep and the table three rows short of
   * what it says it shows.
   */
  minDisplayDepth: number;
  /** Fraction of rank-1 WAR that defines the cliff. */
  cliffThreshold: number;
  /**
   * When true (the default), points above replacement are floored at zero, so
   * season WAR can never be negative and the property holds by construction.
   *
   * Set false and a below-replacement player receives negative WAR. The
   * non-negativity acceptance criterion is deliberately void in that mode, and
   * the chart's y-domain must be computed from the data rather than assumed to
   * start at zero (lib/positional-war/chart-geometry.ts computeYDomain already
   * does).
   *
   * THE DEFAULT STAYS TRUE, and the reasoning is worth keeping because the
   * question comes back every time somebody sees a flat tail at zero.
   *
   * A negative range would order that tail, which is genuinely tempting. It
   * would also make the number mean something else. Season WAR is a SUM over
   * the weeks a player is projected for, so in the negative half the model
   * would rank a deep backup projected all thirteen weeks below a rookie
   * projected twice, purely because one had more weeks in which to lose. In
   * the positive half that asymmetry is the point (more weeks is more chances
   * to help). In the negative half it stops being a claim about football.
   *
   * There is also a fantasy-specific reason the floor is honest rather than
   * merely convenient: nobody starts a below-replacement player when the
   * replacement is on waivers, so the wins he costs you are not wins you would
   * actually give up.
   *
   * The tail is ordered instead by the projected-points tiebreak in
   * lib/positional-war/engine.ts, which is a real number rather than an
   * invented deficit, and the two bottom tiers in lib/positional-war/tiers.ts
   * name a below-replacement player from his own projected and replacement
   * points, which are both stored on the curve.
   */
  clampBelowReplacement: boolean;
};

export const DEFAULT_WAR_SETTINGS: WarSettings = {
  // war-2: the tail tiebreak in lib/positional-war/engine.ts moved from player
  // id to projected points a week, and minDisplayDepth rose to 36. The first
  // reorders players whose WAR ties at exactly zero; the second stores more of
  // them. Both are already fingerprinted, so this bump is belt and braces for
  // a deployment whose settings row overrides minDisplayDepth: without it,
  // such a league would keep serving a curve ordered the old way.
  modelVersion: "war-2",
  displayDepthMultiple: 2.5,
  minDisplayDepth: 36,
  cliffThreshold: 0.5,
  clampBelowReplacement: true,
};

/**
 * The numeric and length bounds for every war setting, in one place. The zod
 * schema at lib/power-pulse/validate.ts and the admin form at
 * app/admin/power-pulse/power-pulse-settings-manager.tsx both read this
 * object rather than restating the numbers, so server validation and the
 * client input's min/max/step attributes cannot drift apart.
 */
export const WAR_SETTING_BOUNDS = {
  modelVersion: { minLength: 1, maxLength: 32 },
  displayDepthMultiple: { min: 1, max: 6, step: 0.1 },
  minDisplayDepth: { min: 6, max: 200, step: 1 },
  cliffThreshold: { min: 0.05, max: 0.95, step: 0.05 },
} as const;

/** How long a computed curve stays fresh. Matches POWER_PULSE_TTL_MS. */
export const POSITIONAL_WAR_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How long to wait after a non-'ok' verdict before trying again.
 *
 * One backoff constant with explicit bypasses, rather than a second longer
 * constant for settled leagues, because the thing that makes a retry worthwhile
 * is a change in the inputs and not the passage of time. See the bypass table
 * in lib/league-positional-war.ts.
 */
export const POSITIONAL_WAR_RETRY_MS = 15 * 60 * 1000;
