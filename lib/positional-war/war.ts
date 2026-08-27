/**
 * The Positional WAR conversion: points above replacement into wins.
 *
 * Pure arithmetic over quantities the merged fill in ./replacement.ts already
 * produced. No optimizer runs here, no player is ever removed from a lineup,
 * and there is no RNG anywhere, so two runs on identical input are
 * byte-identical.
 *
 * THE TWO LINEUPS, STATED EXPLICITLY, because the whole correctness of this
 * module is the difference between them.
 *
 * The BASELINE team is league-average at every startable slot except one slot
 * of the evaluated player's position, which holds the replacement-level player
 * at that position. It contains no part of the evaluated player.
 *
 * The EVALUATED team is that same team with the evaluated player substituted
 * into that one slot, in place of the replacement.
 *
 *   PAR(p, w)            = max(0, projected(p, w) - replacement(pos, w))
 *   deficit(pos, w)      = max(0, avgSeated(pos, w) - replacement(pos, w))
 *   baselineMean(pos, w) = max(0, muRef(w) - deficit(pos, w))
 *   evaluatedMean(p, w)  = baselineMean(pos, w) + PAR(p, w)
 *
 * SUBTRACTING avgSeated IS THE ANTI-DOUBLE-COUNT. Without it the evaluated
 * team's mean is muRef + PAR, which describes a team holding BOTH a
 * league-average starter at the position AND the evaluated player's production
 * above replacement, in the same slot. That slot would contribute
 * avgSeated + projected - replacement, which exceeds what the evaluated player
 * projects by exactly the deficit.
 *
 * The error is small at realistic magnitudes because normalCdf is close to
 * linear near zero, and it is not always small. In a low-variance league with
 * sigmaRef 12, a position with deficit 8 and a player at PAR 20, the
 * double-counted form reads 16% low, and low in the region of the chart readers
 * care about most. More to the point, the double-counted version describes a
 * team that does not exist, so no sentence written about the baseline would be
 * true. lib/positional-war/war.test.ts carries a regression guard named "does
 * not use the centered baseline" so anyone simplifying it back sees why it
 * fails.
 *
 * SIGMA SIMPLIFICATION, deliberate. The evaluated lineup's true spread differs
 * from the baseline's, because the evaluated player's own sigma replaces the
 * replacement player's. Both sides use sigmaRef(w) instead. Near parity the
 * win-probability derivative with respect to sigma is second order against the
 * derivative with respect to the mean, and carrying the per-player sigma would
 * make WAR depend on a player's volatility in a way the chart's axis does not
 * claim to measure. It is why sigmaD is a per-week rather than a per-player
 * quantity. Same independence simplification lineupSigma() and winProbability()
 * already make and document.
 *
 * PROPERTIES, each an acceptance criterion:
 *   - PAR = 0 gives weeklyWar = 0 exactly, for every position and every week.
 *   - weeklyWar >= 0 always, since normalCdf is non-decreasing and PAR >= 0.
 *     Season WAR therefore needs no clamp and can never be negative.
 *   - Strictly increasing in PAR, so raising a projection can never lower WAR.
 *   - Season WAR is the sum of weekly win-probability differences by
 *     construction.
 *
 * The non-negativity property is stated for the default clampBelowReplacement.
 * With it set false, PAR may go negative, so WAR may go negative, and the
 * property is deliberately void. A chart in that mode must compute its y-domain
 * from the data rather than assuming it starts at zero.
 */

import { normalCdf } from "@/lib/power-pulse/math";

/**
 * Points above replacement for one player in one week.
 *
 * `clampBelowReplacement` is the admin-editable switch. True (the default)
 * floors it at zero, which is what makes season WAR non-negative by
 * construction. False lets a below-replacement player carry a real deficit.
 */
export function pointsAboveReplacement(
  projected: number,
  replacement: number,
  clampBelowReplacement: boolean,
): number {
  const raw = projected - replacement;
  return clampBelowReplacement ? Math.max(0, raw) : raw;
}

/** max(0, avgSeated - replacement). Never negative, by the fill's ordering. */
export function positionDeficit(avgSeated: number, replacement: number): number {
  return Math.max(0, avgSeated - replacement);
}

/** The team the evaluated player is being compared against. */
export function baselineMean(muRef: number, deficit: number): number {
  return Math.max(0, muRef - deficit);
}

/** That same team with the evaluated player in the one slot. */
export function evaluatedMean(muRef: number, deficit: number, par: number): number {
  return baselineMean(muRef, deficit) + par;
}

/**
 * Spread of the difference between two teams, both carrying sigmaRef.
 *
 * sqrt(sigmaRef^2 + sigmaRef^2) = sigmaRef * sqrt(2). Written out rather than
 * simplified in place so the two-team origin stays visible.
 */
export function differenceSigma(sigmaRef: number): number {
  return sigmaRef * Math.SQRT2;
}

/**
 * Win probability against a league-average opponent, for a team scoring `teamMean`.
 *
 * The degenerate zero-spread branch mirrors winProbability() in
 * lib/power-pulse/math.ts: with no variance the outcome is a step function, and
 * an exact tie is half a win.
 */
function winProbabilityAgainstAverage(teamMean: number, muRef: number, sigmaDiff: number): number {
  if (sigmaDiff <= 0) {
    if (teamMean === muRef) return 0.5;
    return teamMean > muRef ? 1 : 0;
  }
  return normalCdf((teamMean - muRef) / sigmaDiff);
}

/** Everything one week of one position contributes to the conversion. */
export type WeeklyWarInput = {
  /** League-average optimal lineup total that week, from the merged fill. */
  muRef: number;
  /** League-average optimal lineup spread that week, from the same fill. */
  sigmaRef: number;
  /** max(0, avgSeated - replacement) for this position that week. */
  deficit: number;
  /** This player's points above replacement that week. */
  par: number;
};

/**
 * One week of Positional WAR: the win probability the evaluated team gains over
 * the baseline team, both playing a league-average opponent.
 */
export function weeklyWar({ muRef, sigmaRef, deficit, par }: WeeklyWarInput): number {
  if (!Number.isFinite(muRef) || !Number.isFinite(sigmaRef) || !Number.isFinite(deficit)) return 0;
  if (!Number.isFinite(par)) return 0;
  const sigmaDiff = differenceSigma(sigmaRef);
  const base = baselineMean(muRef, deficit);
  const evaluated = base + par;
  return (
    winProbabilityAgainstAverage(evaluated, muRef, sigmaDiff) -
    winProbabilityAgainstAverage(base, muRef, sigmaDiff)
  );
}

/**
 * Season WAR: the sum of the weekly win-probability differences.
 *
 * A week with no projection is absent from `weeks` and contributes nothing. It
 * is never a zero-point week: a bye is the absence of an opinion, and summing a
 * fabricated zero into a total somebody reads would be a claim we cannot make.
 */
export function seasonWar(weeks: WeeklyWarInput[]): number {
  let total = 0;
  for (const week of weeks) total += weeklyWar(week);
  return total;
}
