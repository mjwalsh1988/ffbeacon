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
  /** Floor on the cap, so a 12-team league's QB series is not six points long. */
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
   * start at zero.
   */
  clampBelowReplacement: boolean;
};

export const DEFAULT_WAR_SETTINGS: WarSettings = {
  modelVersion: "war-1",
  displayDepthMultiple: 2.5,
  minDisplayDepth: 24,
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
