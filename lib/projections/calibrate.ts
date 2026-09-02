/**
 * Spread calibration.
 *
 * Every projection source over-spreads: twelve seasons analysed by Fantasy
 * Football Analytics give calibration slopes below 1.0 at every position (QB
 * 0.67, TE 0.72, RB 0.79, WR 0.85). Top players are projected too high and
 * late round starters too low. The correction shrinks a projection toward its
 * positional mean by that measured slope.
 *
 * WHY THIS SCALES THE WHOLE STAT LINE INSTEAD OF THE POINT TOTAL
 *
 * The stored artifact is a stat line, not a point total, and correcting the
 * total alone would leave a line whose parts no longer add up: receptions
 * times yards per reception would stop equalling receiving yards the moment
 * only the total moved. Applying the correction as a single uniform scale on
 * every value in the line keeps it internally consistent while still moving
 * the priced total by exactly the calibrated amount.
 *
 * This runs on the BLENDED projection (see blend.ts), after the blend and
 * before storage, so it corrects Sleeper's spread as well as ours and what
 * gets stored is what we believe, with no reader needing to know the
 * correction exists.
 */

import type { ProjectionPosition, StatLine } from "./types";
import type { ProjectionSettings } from "./default-settings";

/**
 * Below this many projected PPR points a row is left alone. See the guard in
 * calibrateStatLine for why the ratio cannot be trusted down there.
 */
export const MIN_POINTS_FOR_CALIBRATION = 2;

/**
 * The most a single calibration is allowed to scale a row. A gentle
 * compression is what the published slopes describe; anything larger means the
 * inputs were degenerate.
 */
export const MAX_CALIBRATION_FACTOR = 2;

export function calibrateStatLine(
  statLine: StatLine,
  position: ProjectionPosition,
  positionMeanPoints: number,
  projectedPoints: number,
  settings: ProjectionSettings,
): StatLine {
  if (!settings.calibration.enabled) return statLine;

  if (
    !Number.isFinite(positionMeanPoints) ||
    !Number.isFinite(projectedPoints) ||
    projectedPoints <= 0
  ) {
    return statLine;
  }

  // A NEAR-ZERO PROJECTION IS NOT CALIBRATED, BECAUSE THE FACTOR RUNS AWAY.
  //
  // The correction is a ratio with the projection in the DENOMINATOR, so as the
  // projection approaches zero the multiplier grows without bound. Concretely,
  // at the quarterback slope of 0.67 against a positional mean near 20, a
  // player projected 0.2 points calibrates by a factor of about 33 and lands on
  // a startable-looking number.
  //
  // The caller already restricts calibration to the startable range, which
  // handles this in the normal case. It does not handle a THIN pool: when a
  // position and week hold fewer players than the startable depth, the cut
  // degrades to the pool's own minimum, and a third-string quarterback with one
  // mop-up snap in a bye-heavy week clears it. That reintroduces exactly the
  // "plausible-looking streamer" failure the startable-range rule exists to
  // prevent, one level further in.
  //
  // An absolute floor closes it. Below this many projected points there is no
  // spread worth correcting anyway: the difference between 0.4 and 0.9 expected
  // points is not a claim any calibration is going to improve.
  if (projectedPoints < MIN_POINTS_FOR_CALIBRATION) return statLine;

  const slope = settings.calibration.slope[position];
  if (!Number.isFinite(slope)) return statLine;

  const calibratedRaw = positionMeanPoints + slope * (projectedPoints - positionMeanPoints);
  const calibrated = calibratedRaw < 0 ? 0 : calibratedRaw;

  const factor = calibrated / projectedPoints;
  if (!Number.isFinite(factor) || factor < 0) return statLine;

  // Even above the floor, cap how far a single correction can move a row. The
  // published slopes describe a gentle compression, so a factor outside this
  // band means the inputs were degenerate rather than that the player deserves
  // a threefold adjustment.
  if (factor > MAX_CALIBRATION_FACTOR) return statLine;

  const result: StatLine = {};
  for (const [key, value] of Object.entries(statLine)) {
    // gp is a count of games, not a quantity of production. Scaling it to
    // 0.83 games would be meaningless, so it passes through untouched.
    if (key === "gp") {
      result[key] = value;
      continue;
    }
    const scaled = value * factor;
    result[key] = Number.isFinite(scaled) ? scaled : value;
  }
  return result;
}
