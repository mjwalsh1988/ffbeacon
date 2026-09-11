/**
 * The unconstrained top-K ranking behind the start/sit verdict: of N
 * candidates, which K should a reader start this week.
 *
 * PURE. No database, no React, no "server-only". It reads only the shapes in
 * ./types, which lib/start-sit/load.ts builds from the shared projection
 * read path.
 *
 * NOT A SLOT MODEL. The reader has already decided which lineup slot they
 * are filling (a flex decision between an RB and a WR is the ordinary
 * case), so this is a plain descending sort of adjusted points, not a fill
 * of lib/power-pulse/lineup.ts under PULSE_SLOT_ELIGIBILITY. Mixed
 * positions are allowed and expected; nothing here reads position.
 *
 * A candidate with points null (bye, unpublished projection, an
 * unprojectable position) is always benched and never counted toward K: a
 * null is an absence, never a zero, the same rule loadAdjustedProjections
 * callers follow everywhere else in the product. Starters can therefore
 * number fewer than K when too few candidates have a points figure at all.
 * The same rule covers a candidate with no matching projection row.
 */

import type { StartSitCandidate, StartSitProjection } from "./types";

/** The result of ranking N candidates: who starts, who sits. */
export type StartSitRankResult = {
  /** playerIds of the K best candidates with points, descending. */
  starters: string[];
  /**
   * playerIds of everyone else: the remaining points candidates first
   * (descending, same ordering as starters), then the null-points
   * candidates, stable by slug.
   */
  bench: string[];
  /** The effective K after clamping to 1..N-1. May exceed starters.length. */
  startCount: number;
};

/**
 * Clamp a requested start count to 1..N-1, the only range that always
 * leaves at least one candidate benched to compare against. N-1 is itself
 * floored at 1 so a two-candidate board never produces an empty range.
 */
export function clampStartCount(startCount: number, candidateCount: number): number {
  const upper = Math.max(1, candidateCount - 1);
  const requested = Number.isFinite(startCount) ? Math.trunc(startCount) : 1;
  return Math.min(upper, Math.max(1, requested));
}

type RankEntry = {
  candidate: StartSitCandidate;
  projection: StartSitProjection | undefined;
};

/** Descending by value; null sorts after every real number. */
function compareNullableDescending(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Descending adjusted points; ties by higher floor, then higher beat rate, then slug ascending. */
function comparePointed(a: RankEntry, b: RankEntry): number {
  const pointsA = a.projection!.points as number;
  const pointsB = b.projection!.points as number;
  if (pointsA !== pointsB) return pointsB - pointsA;

  const byFloor = compareNullableDescending(a.projection!.floor, b.projection!.floor);
  if (byFloor !== 0) return byFloor;

  const byBeatRate = compareNullableDescending(a.projection!.beatRate, b.projection!.beatRate);
  if (byBeatRate !== 0) return byBeatRate;

  return a.candidate.slug.localeCompare(b.candidate.slug);
}

/** Stable order for candidates nobody projected a score for: by slug, ascending. */
function compareUnpointed(a: RankEntry, b: RankEntry): number {
  return a.candidate.slug.localeCompare(b.candidate.slug);
}

/**
 * The K best of N. `projections` need not cover every candidate: a
 * candidate with no matching row, or a matching row whose points is null,
 * is treated identically, always benched and never counted toward K.
 */
export function rankForWeek(
  candidates: StartSitCandidate[],
  projections: StartSitProjection[],
  startCount: number,
): StartSitRankResult {
  const byPlayerId = new Map(projections.map((p) => [p.playerId, p]));
  const entries: RankEntry[] = candidates.map((candidate) => ({
    candidate,
    projection: byPlayerId.get(candidate.playerId),
  }));

  const pointed = entries.filter((e) => e.projection !== undefined && e.projection.points !== null);
  const unpointed = entries.filter((e) => e.projection === undefined || e.projection.points === null);

  pointed.sort(comparePointed);
  unpointed.sort(compareUnpointed);

  const effectiveK = clampStartCount(startCount, candidates.length);
  const starterEntries = pointed.slice(0, effectiveK);
  const benchPointedEntries = pointed.slice(starterEntries.length);

  return {
    starters: starterEntries.map((e) => e.candidate.playerId),
    bench: [...benchPointedEntries, ...unpointed].map((e) => e.candidate.playerId),
    startCount: effectiveK,
  };
}
