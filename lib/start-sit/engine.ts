/**
 * lib/start-sit/engine.ts
 *
 * computeStartSit: the whole start/sit verdict for one board, from plain
 * data. PURE. No database, no React, no "server-only". It calls rankForWeek
 * (./rank), computeConfidence and callLabelFor (./confidence), and
 * buildStartSitReasons plus buildStartSitVerdictLine (./reasons), and nothing
 * else: it introduces no arithmetic of its own beyond the margin subtraction
 * itself.
 *
 * AVAILABILITY "out". A player Sleeper has ruled out is never started and
 * never counted toward K, exactly like a candidate with no points at all
 * (a bye, an unpublished week). The ranker only sees that rule if it is
 * handed a points value of null, so this module builds a RANK-ONLY copy of
 * the projections with an out player's points nulled, and hands that copy to
 * rankForWeek. Everything downstream of ranking (the verdict line, the
 * reasons, the cards) reads the ORIGINAL, unmodified projections, so a SIT
 * card can still show the number that made the player out in the first
 * place and say why he is sitting.
 *
 * THE BORDERLINE PAIR. marginPoints and confidence are both measured on the
 * same two candidates the confidence meter shows on the board: the last
 * starter (starters[starters.length - 1]) and the first benched candidate
 * who genuinely has points to compare, in RANK order. "Genuinely has points"
 * means points survive the same out-as-null substitution ranking used, so a
 * bye or an out player can never be the pair's benched half: comparing a
 * starter against a player who could not have played would not be a
 * competitive margin. Both figures are null together when no such pair
 * exists (an empty starters list, or every benched candidate lacking
 * points).
 *
 * NO PROJECTIONS AT ALL. When every candidate is on bye, out or unpublished
 * for the week, rankForWeek returns no starters. computeStartSit does not
 * throw: starters and bench are both handled as usual (bench holds
 * everyone), and the verdict line says plainly there is nothing to compare
 * for that week rather than printing the empty sentence
 * buildStartSitVerdictLine returns for zero starters.
 */

import { computeConfidence, callLabelFor } from "./confidence";
import { rankForWeek } from "./rank";
import { buildStartSitReasons, buildStartSitVerdictLine, type StartSitReasonInput } from "./reasons";
import type { StartSitCandidate, StartSitProjection, StartSitVerdict } from "./types";

/** Plain data for one board. Everything computeStartSit needs and nothing it reads elsewhere. */
export type StartSitEngineInput = {
  candidates: StartSitCandidate[];
  /** Keyed by playerId. The ORIGINAL projections: reasons and cards read these, unmodified. */
  projections: Record<string, StartSitProjection>;
  /** ?start=K, already validated by the caller; rankForWeek clamps it to 1..N-1 again regardless. */
  startCount: number;
  week: number;
  season: number;
  /** The reader's format label, for example "PPR" or "Half PPR", for the margin sentence. */
  formatDisplay: string;
  /** The resolved projection source slug, carried through to the verdict for the page's label. */
  projectionSource: string;
};

/** "There are no projections to compare for Week {week}." when nobody has points at all. */
function noProjectionsVerdictLine(week: number): string {
  return `There are no projections to compare for Week ${week}.`;
}

/**
 * The rank-only view of a projection: an "out" player's points replaced with
 * null so rankForWeek benches him and never counts him toward K, exactly as
 * it already does for a bye or an unpublished week. Every other field is
 * untouched; rankForWeek reads only points, floor and beatRate off a pointed
 * entry, and none of those matter once points is null.
 */
function forRanking(projection: StartSitProjection): StartSitProjection {
  if (projection.availability === "out") {
    return { ...projection, points: null };
  }
  return projection;
}

export function computeStartSit(input: StartSitEngineInput): StartSitVerdict {
  const { candidates, projections, startCount, week, season, formatDisplay, projectionSource } = input;

  const rankProjections: StartSitProjection[] = Object.values(projections).map(forRanking);
  const rankProjectionByPlayerId = new Map(rankProjections.map((p) => [p.playerId, p]));

  const rankResult = rankForWeek(candidates, rankProjections, startCount);

  const lastStarterId = rankResult.starters[rankResult.starters.length - 1] ?? null;
  const firstBenchWithPoints =
    rankResult.bench.find((id) => (rankProjectionByPlayerId.get(id)?.points ?? null) !== null) ?? null;

  let marginPoints: number | null = null;
  let confidence: number | null = null;

  if (lastStarterId && firstBenchWithPoints) {
    const starterProjection = projections[lastStarterId] ?? null;
    const benchProjection = projections[firstBenchWithPoints] ?? null;
    if (starterProjection?.points != null && benchProjection?.points != null) {
      marginPoints = starterProjection.points - benchProjection.points;
    }
    confidence = computeConfidence(starterProjection, benchProjection);
  }

  const callLabel = callLabelFor(confidence);

  const reasonInput: StartSitReasonInput = {
    candidates,
    projections,
    starters: rankResult.starters,
    bench: rankResult.bench,
    confidence,
    formatDisplay,
  };

  const reasons = buildStartSitReasons(reasonInput);
  const verdictLine =
    rankResult.starters.length === 0 ? noProjectionsVerdictLine(week) : buildStartSitVerdictLine(reasonInput);

  return {
    week,
    season,
    startCount: rankResult.startCount,
    starters: rankResult.starters,
    bench: rankResult.bench,
    marginPoints,
    confidence,
    callLabel,
    reasons,
    verdictLine,
    projectionSource,
  };
}
