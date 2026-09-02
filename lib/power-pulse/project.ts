/**
 * How one player's one week gets projected.
 *
 * This was inline in engine.ts until the FAAB calculator needed the same math.
 * FAAB asks "what would this free agent add to your lineup", which is only a
 * meaningful question if the free agent is projected on exactly the same terms
 * as the players already on the roster. Two copies of this model would drift,
 * and the first symptom would be a FAAB recommendation that disagrees with the
 * Power Pulse page it sits next to.
 *
 * Everything here is pure. The engine and the FAAB marginal-value calculation
 * both import it; neither owns it.
 */

import {
  closestScoringBase,
  scoreWithFallback,
  type ScoringSettings,
} from "@/lib/league-scoring";
import type { PowerPulseSettings } from "./default-settings";
import { clamp } from "./math";
import type { AccuracyRow, DefenseRow, ProjectionRow } from "./load";
import type { PulsePosition } from "./types";
import { curveFor, cvForPoints } from "./variance-curve";

/**
 * Injury designations that keep a player out for the rest of the season rather
 * than one week, and are therefore worth applying to a week the SOURCE has said
 * nothing about. A Questionable tag in September tells you nothing about week
 * 12; an IR tag does. Neither overrides a week the source has answered for
 * itself: see injuryMultiplier below.
 */
export const LONG_TERM_INJURY_STATUSES = new Set([
  "IR",
  "PUP",
  "NA",
  "SUS",
  "COV",
  "DNR",
]);

/**
 * Blend the opponent-strength multiplier across the seasons we have splits for,
 * weighting the more recent season more heavily. Falls back to neutral when the
 * sample is too thin to trust.
 *
 * `seasons` is a list of CANDIDATES, most recent first (see
 * lib/projections/defense-seasons.ts), not a fixed [current, prior] pair. This
 * function, not the caller, decides which two of them are usable: it walks the
 * list in order and keeps the first two rows that exist and clear
 * settings.opponent.minGamesSampled. `currentSeasonWeight` applies to whichever
 * row is found FIRST and `priorSeasonWeight` to whichever is found SECOND, so
 * in the preseason (no row yet for the season in progress) the two prior
 * seasons fill both slots and the answer is unchanged from before this
 * function knew how to look at the current season at all. From roughly week 8
 * on, the current season has enough sampled games to be usable and takes the
 * first slot on its own, with no date check anywhere in this function.
 */
export function opponentMultiplier(
  defense: Map<string, DefenseRow>,
  seasons: number[],
  opponentTeam: string | null,
  position: PulsePosition,
  settings: PowerPulseSettings,
): number {
  if (!settings.opponent.enabled || !opponentTeam) return 1;

  const weights = [
    settings.opponent.currentSeasonWeight,
    settings.opponent.priorSeasonWeight,
  ];
  const usable: DefenseRow[] = [];
  for (const season of seasons) {
    const row = defense.get(`${opponentTeam}|${season}|${position}`);
    if (!row || row.gamesSampled < settings.opponent.minGamesSampled) continue;
    usable.push(row);
    if (usable.length === 2) break;
  }

  let weighted = 0;
  let totalWeight = 0;
  usable.forEach((row, i) => {
    const w = weights[i] ?? 0;
    const rowMultiplier = settings.opponent.useAdjusted
      ? row.shrunkMultiplier ?? row.multiplier
      : row.multiplier;
    weighted += rowMultiplier * w;
    totalWeight += w;
  });

  if (totalWeight <= 0) return 1;
  return clamp(
    weighted / totalWeight,
    settings.opponent.minMultiplier,
    settings.opponent.maxMultiplier,
  );
}

/**
 * Reliability multiplier from the recency-weighted accuracy row.
 *
 * `shrunkMultiplier` is already CENTERED on the player's own position by
 * lib/calculate-projection-accuracy.ts, so it reads as "against his positional
 * peers" and 1.0 is exactly average for his position. Uncentered it carried the
 * position's own bias against the source, which marked every quarterback down
 * about 5% and every tight end up about 3% and quietly tilted every
 * cross-position comparison in Positional WAR.
 *
 * Deliberately kept to a small range (0.95 to 1.05 by default). "Does this
 * player beat his projection" has no measured year over year persistence, so
 * most of what this carries is noise; see the reliability block in
 * ./default-settings.ts for the measurement.
 */
export function reliabilityMultiplier(
  accuracy: AccuracyRow | null,
  settings: PowerPulseSettings,
): number {
  if (!settings.reliability.enabled || !accuracy?.shrunkMultiplier) return 1;
  return clamp(
    accuracy.shrunkMultiplier,
    settings.reliability.minMultiplier,
    settings.reliability.maxMultiplier,
  );
}

/** Availability multiplier, damped so a missed month never zeroes a player. */
export function availabilityMultiplier(
  accuracy: AccuracyRow | null,
  settings: PowerPulseSettings,
): number {
  if (!settings.availability.enabled || accuracy?.availabilityRate == null)
    return 1;
  const damped =
    1 - settings.availability.damping * (1 - accuracy.availabilityRate);
  return clamp(damped, settings.availability.minMultiplier, 1);
}

/**
 * Injury multiplier for a specific week.
 *
 * ONE RULE DOES THE WORK: a per-week opinion beats a season-long tag.
 *
 * `injuryStatus` on a player row is a single flag with no timeline. It says a
 * player is on IR; it cannot say when he is back. Sleeper's `availability` is
 * per week and it CAN, so when Sleeper has published an opinion about this
 * particular week, that opinion wins, whichever designation the player carries.
 *
 * That was not always true here, and the old behaviour was doing real damage. A
 * season-long designation used to zero every remaining week REGARDLESS of the
 * projection. Measured against the live board on 2026-08-31:
 *
 *   Jordyn Tyson   IR    Sleeper: out weeks 1-4, then 10.7 a week from week 5.
 *                        We scored him 0.0 for all fourteen weeks.
 *   Josh Jacobs    DNR   Sleeper: out week 1, then about 14 a week after.
 *                        We scored him 0.0, which by itself moved his team
 *                        from seventh in its league to last.
 *
 * Sleeper was publishing a return timeline in both cases and we were deleting
 * it, using the less informative source to overrule the more informative one.
 *
 * THE SAFETY NET IS NOT LOST, IT MOVED
 * The net existed for Ricky Pearsall: on season-ending IR while a stale row
 * still showed 8.9 points a week. That case is now caught upstream and better.
 * `classifyRow` in lib/sync-weekly-projections.ts writes `availability: "out"`
 * for exactly that shape (a scheduled game, no points, and a designation), and
 * `projectPlayerWeek` short circuits an "out" week to a real zero before this
 * function is ever called. Pearsall reads zero in every week of 2026 through
 * that path, not this one.
 *
 * So the designation still fires wherever the source has NO per-week opinion:
 * an `unprojected` week, a projection we derived ourselves, or any future source
 * that publishes a number without saying whether the player suits up. What it no
 * longer does is contradict a source that has already answered the question.
 *
 * A week-to-week designation (Questionable, Doubtful) obeys the same rule for
 * the same reason. Tank Dell is listed Questionable and projected 6.42, not his
 * healthy figure, so applying our own 0.9 on top would discount one injury
 * twice. Absent a source opinion it applies to the current week only, because a
 * Questionable tag in September says nothing about week 12.
 */
export function injuryMultiplier(
  status: string | null,
  week: number,
  currentWeek: number,
  settings: PowerPulseSettings,
  opts: { sourcePricedIn?: boolean } = {},
): number {
  if (!settings.injury.enabled || !status) return 1;
  const key = status.toUpperCase();
  const multiplier = settings.injury.multipliers[key];
  if (multiplier === undefined) return 1;
  // The source answered for this week. Nothing here knows better.
  if (opts.sourcePricedIn) return 1;
  if (LONG_TERM_INJURY_STATUSES.has(key)) return multiplier;
  return week === currentWeek ? multiplier : 1;
}

/**
 * Per-week coefficient of variation for one player.
 *
 * A player with enough graded weeks uses his OWN measured spread, and always
 * has. Everything below is about the other third of the pool, the ones with no
 * history: rookies, role changes, anyone Sleeper has only just started
 * projecting.
 *
 * The fallback used to be one number per position. It is now read off a curve
 * keyed on the player's own projected points and on the league's scoring base,
 * because both change the answer materially and a single number could not carry
 * either. See lib/power-pulse/variance-curve.ts for the measurements and for why
 * points rather than rank.
 *
 * `defaultCv` survives as the last resort, for a position with no curve or a
 * player with no projected points to place on one. It is never the first answer.
 */
export function coefficientOfVariation(
  position: PulsePosition,
  accuracy: AccuracyRow | null,
  settings: PowerPulseSettings,
  opts: { projectedPoints?: number | null; scoringBase?: string } = {},
): number {
  const measured =
    accuracy?.ratioStdev != null &&
    accuracy.weeksPlayed >= settings.variance.minGamesForMeasured;
  if (measured) {
    return clamp(
      accuracy!.ratioStdev!,
      settings.variance.minCv,
      settings.variance.maxCv,
    );
  }

  const { projectedPoints, scoringBase } = opts;
  if (typeof projectedPoints === "number" && Number.isFinite(projectedPoints)) {
    const anchors = curveFor(scoringBase ?? "pts_ppr", position);
    const fromCurve = cvForPoints(anchors, projectedPoints);
    if (fromCurve !== null) {
      return clamp(fromCurve, settings.variance.minCv, settings.variance.maxCv);
    }
  }

  return clamp(
    settings.variance.defaultCv[position] ?? 0.6,
    settings.variance.minCv,
    settings.variance.maxCv,
  );
}

/** What the caller needs to know about a player to project them. */
export type ProjectableSubject = {
  position: PulsePosition;
  /** Sleeper injury_status, verbatim. Null when healthy. */
  injuryStatus: string | null;
};

/** One projected week, fully adjusted. */
export type ProjectedWeek = {
  week: number;
  /** Projected points in the league's own scoring, after every adjustment. */
  points: number;
  /** Before opponent, reliability, availability, and injury adjustments. */
  rawPoints: number;
  sigma: number;
  opponentMultiplier: number;
  /** NFL opponent for that week. Null when the projection carries none. */
  opponent: string | null;
  /** True when the league's own scoring_settings drove the number. */
  usedLeagueScoring: boolean;
};

/**
 * Project one player for one week, in the league's own scoring.
 *
 * Returns null when there is nothing to project: a bye week, a player Sleeper
 * does not publish, or a stat line we cannot score. A null is "no opinion", and
 * callers must treat it as an absent week rather than a zero, because a zero
 * would quietly drag a player's average down every bye.
 *
 * A projection row marked `availability: "out"` is the opposite case and is NOT
 * a null. Sleeper scheduled that player a game and declined to project him, so
 * zero is the answer rather than the absence of one, and it arrives here as a
 * stored zero that flows through the math untouched.
 */
export function projectPlayerWeek({
  projection,
  subject,
  accuracy,
  reliability,
  scoringSettings,
  defense,
  defenseSeasons,
  week,
  currentWeek,
  settings,
}: {
  projection: ProjectionRow | undefined;
  subject: ProjectableSubject;
  accuracy: AccuracyRow | null;
  /** Precomputed so a caller projecting 18 weeks does not recompute it 18 times. */
  reliability: number;
  scoringSettings: ScoringSettings | null;
  defense: Map<string, DefenseRow>;
  /** Candidate seasons, most recent first. See lib/projections/defense-seasons.ts. */
  defenseSeasons: number[];
  week: number;
  currentWeek: number;
  settings: PowerPulseSettings;
}): ProjectedWeek | null {
  if (!projection) return null;

  // Sleeper scheduled this player a game and declined to project him while he
  // carried an injury designation. That is an answer, not a gap, so it short
  // circuits ahead of every multiplier: there is no opponent adjustment, no
  // reliability and no variance to apply to a player who is not playing. Said
  // here rather than left to fall out of the scoring math, so it cannot quietly
  // stop being zero if that math changes.
  if (projection.availability === "out") {
    return {
      week,
      points: 0,
      rawPoints: 0,
      sigma: 0,
      opponentMultiplier: 1,
      opponent: projection.opponent,
      usedLeagueScoring: false,
    };
  }

  const scored = scoreWithFallback(
    projection.statLine,
    { ppr: projection.ppr, half_ppr: projection.halfPpr, std: projection.std },
    scoringSettings,
    subject.position,
  );
  if (scored.points === null) return null;

  const oppMult = opponentMultiplier(
    defense,
    defenseSeasons,
    projection.opponent,
    subject.position,
    settings,
  );
  // Sleeper prices a week-to-week designation into the number it publishes, so
  // our own week-to-week discount must not fire on top of it. A season-long
  // designation still overrides everything: see injuryMultiplier.
  const sourcePricedIn = projection.availability === "projected";
  const injMult = injuryMultiplier(
    subject.injuryStatus,
    week,
    currentWeek,
    settings,
    {
      sourcePricedIn,
    },
  );
  const availMult = availabilityMultiplier(accuracy, settings);

  const points = Math.max(
    0,
    scored.points * oppMult * reliability * availMult * injMult,
  );
  // The curve is read off the player's RAW projected points, before our own
  // multipliers. A receiver discounted to 6 because he is Questionable this week
  // is still a WR1 in every other respect, and pricing his volatility as a WR60
  // would compound one adjustment into two.
  // Derived here rather than passed in. Every caller already holds the scoring
  // map and closestScoringBase is two comparisons, so a parameter would only
  // create a way for a caller to hand this function a base that disagrees with
  // the scoring it is simultaneously being asked to score under.
  const cv = coefficientOfVariation(subject.position, accuracy, settings, {
    projectedPoints: scored.points,
    scoringBase: closestScoringBase(scoringSettings),
  });

  return {
    week,
    points,
    rawPoints: scored.points,
    sigma: points * cv,
    opponentMultiplier: oppMult,
    opponent: projection.opponent,
    usedLeagueScoring: scored.usedLeagueScoring,
  };
}
