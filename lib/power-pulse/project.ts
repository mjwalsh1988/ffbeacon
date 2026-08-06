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

import { scoreWithFallback, type ScoringSettings } from "@/lib/league-scoring";
import type { PowerPulseSettings } from "./default-settings";
import { clamp } from "./math";
import type { AccuracyRow, DefenseRow, ProjectionRow } from "./load";
import type { PulsePosition } from "./types";

/**
 * Injury designations that keep a player out for the rest of the season rather
 * than one week. A Questionable tag should not suppress a player's week 12
 * projection in September; an IR stash should.
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
 */
export function opponentMultiplier(
  defense: Map<string, DefenseRow>,
  seasons: number[],
  opponentTeam: string | null,
  position: PulsePosition,
  settings: PowerPulseSettings,
): number {
  if (!settings.opponent.enabled || !opponentTeam) return 1;

  const weights = [settings.opponent.currentSeasonWeight, settings.opponent.priorSeasonWeight];
  let weighted = 0;
  let totalWeight = 0;
  seasons.slice(0, 2).forEach((season, i) => {
    const row = defense.get(`${opponentTeam}|${season}|${position}`);
    if (!row || row.gamesSampled < settings.opponent.minGamesSampled) return;
    const w = weights[i] ?? 0;
    weighted += row.multiplier * w;
    totalWeight += w;
  });

  if (totalWeight <= 0) return 1;
  return clamp(
    weighted / totalWeight,
    settings.opponent.minMultiplier,
    settings.opponent.maxMultiplier,
  );
}

/** Reliability multiplier from the recency-weighted accuracy row. */
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
  if (!settings.availability.enabled || accuracy?.availabilityRate == null) return 1;
  const damped = 1 - settings.availability.damping * (1 - accuracy.availabilityRate);
  return clamp(damped, settings.availability.minMultiplier, 1);
}

/**
 * Injury multiplier for a specific week. Week-to-week designations only affect
 * the upcoming week; season-long designations affect every remaining week.
 */
export function injuryMultiplier(
  status: string | null,
  week: number,
  currentWeek: number,
  settings: PowerPulseSettings,
): number {
  if (!settings.injury.enabled || !status) return 1;
  const key = status.toUpperCase();
  const multiplier = settings.injury.multipliers[key];
  if (multiplier === undefined) return 1;
  if (LONG_TERM_INJURY_STATUSES.has(key)) return multiplier;
  return week === currentWeek ? multiplier : 1;
}

/** Per-week coefficient of variation for one player. */
export function coefficientOfVariation(
  position: PulsePosition,
  accuracy: AccuracyRow | null,
  settings: PowerPulseSettings,
): number {
  const fallback = settings.variance.defaultCv[position] ?? 0.6;
  if (
    accuracy?.ratioStdev == null ||
    accuracy.weeksPlayed < settings.variance.minGamesForMeasured
  ) {
    return fallback;
  }
  return clamp(accuracy.ratioStdev, settings.variance.minCv, settings.variance.maxCv);
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
  defenseSeasons: number[];
  week: number;
  currentWeek: number;
  settings: PowerPulseSettings;
}): ProjectedWeek | null {
  if (!projection) return null;

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
  const injMult = injuryMultiplier(subject.injuryStatus, week, currentWeek, settings);
  const availMult = availabilityMultiplier(accuracy, settings);

  const points = Math.max(0, scored.points * oppMult * reliability * availMult * injMult);
  const cv = coefficientOfVariation(subject.position, accuracy, settings);

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
