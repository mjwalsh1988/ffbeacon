/**
 * How close the start/sit call is: the probability that the K-th starter
 * outscores the first benched player.
 *
 * PURE. Introduces no new model. It is winProbability(meanA, sigmaA, meanB,
 * sigmaB) from lib/power-pulse/math.ts, the same function the Schedules
 * board and the Lineups what-if use for the same kind of question, applied
 * to the two players sitting on the K/K+1 line of a rankForWeek result.
 *
 * A null confidence means the two players cannot be compared this way, not
 * that they are evenly matched: either side missing, either points null, or
 * either sigma null (an absence, never a zero, the rule every reader of a
 * StartSitProjection follows). callLabelFor turns that null into the word
 * "unmeasured" rather than folding it into "toss-up", which would claim a
 * closeness the numbers do not support.
 */

import { winProbability } from "@/lib/power-pulse/math";
import type { StartSitCallLabel, StartSitProjection } from "./types";

/** The two fields computeConfidence needs from each side of the comparison. */
export type ConfidenceInput = Pick<StartSitProjection, "points" | "sigma">;

/** 0.65 and up is labelled "clear". */
export const CONFIDENCE_CLEAR_THRESHOLD = 0.65;

/** 0.55 up to (not including) CONFIDENCE_CLEAR_THRESHOLD is labelled "lean". */
export const CONFIDENCE_LEAN_THRESHOLD = 0.55;

/**
 * The probability the starter outscores the benched player, or null when
 * either side is missing, either points is null, or either sigma is null.
 *
 * Takes the two projections (or anything with the same points and sigma
 * shape, such as the plain means and sigmas load.ts already has in hand)
 * rather than full StartSitProjection rows, so a caller never has to build
 * a whole projection just to ask this question.
 */
export function computeConfidence(
  starter: ConfidenceInput | null | undefined,
  benched: ConfidenceInput | null | undefined,
): number | null {
  if (!starter || !benched) return null;
  if (starter.points === null || benched.points === null) return null;
  if (starter.sigma === null || benched.sigma === null) return null;

  return winProbability(starter.points, starter.sigma, benched.points, benched.sigma);
}

/**
 * The word for a confidence figure. Thresholds are CONFIDENCE_CLEAR_THRESHOLD
 * and CONFIDENCE_LEAN_THRESHOLD; a null confidence is always "unmeasured".
 */
export function callLabelFor(confidence: number | null): StartSitCallLabel {
  if (confidence === null) return "unmeasured";
  if (confidence >= CONFIDENCE_CLEAR_THRESHOLD) return "clear";
  if (confidence >= CONFIDENCE_LEAN_THRESHOLD) return "lean";
  return "toss-up";
}
