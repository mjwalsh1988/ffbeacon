/**
 * The Positional WAR calculation.
 *
 * Pure. Takes plain data, returns plain data, does no I/O and reads no clock.
 * Every quantity comes off the W + 1 merged fills in ./replacement.ts and the
 * win conversion in ./war.ts, and the rest is ranking and bookkeeping.
 *
 * Deterministic. No RNG anywhere, so two runs on identical input are
 * byte-identical, which is why the cache can compare a fingerprint rather than
 * a checksum of the output.
 *
 * WHAT DRIVES WHAT, and this is a specification rather than an implementation
 * detail. Demand is two different quantities doing two different jobs:
 *
 *   - STRUCTURAL demand is one integer per position, from the bye-free fill. It
 *     drives the x-axis, the depth cap, `war_at_demand`, and every sentence of
 *     copy. A wobbling axis is unreadable and unshareable, and "in this league,
 *     28 running backs start" is a sentence a reader can check.
 *   - WEEKLY seated counts drive replacement level, and only that. A bye week
 *     genuinely lowers replacement, and that is exactly the week a starter is
 *     worth most.
 *
 * THE CONSEQUENCE, which must be stated in the UI and must not be "fixed"
 * later: because replacement is weekly and the axis is structural, the curve
 * does not cross zero at x = 1.0. The player at positionRank === structural
 * demand has a small POSITIVE WAR, because he beats the weekly replacement in
 * most weeks. That is correct, and it is why `warAtDemand` is stored and the
 * marker is labeled with its real value rather than with an asserted zero.
 */

import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import {
  buildMergedFill,
  positionWeekStats,
  startablePositions,
  structuralCandidates,
  type MergedFill,
  type PositionWeekStats,
} from "./replacement";
import type {
  PositionCurve,
  WarCurvePoint,
  WarInput,
  WarPlayerInput,
  WarResult,
  WeeklyDiagnostic,
} from "./types";
import { pointsAboveReplacement, seasonWar, type WeeklyWarInput } from "./war";

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** One week's candidate list: every player who has a projection that week. */
function weekCandidates(players: WarPlayerInput[], week: number): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const player of players) {
    const projection = player.byWeek.get(week);
    if (!projection) continue;
    out.push({
      playerId: player.playerId,
      position: player.position,
      points: projection.points,
      sigma: projection.sigma,
    });
  }
  return out;
}

/**
 * How deep to plot each series.
 *
 * Past roughly two and a half times demand every series is flat and adds pixels
 * without adding information. The floor keeps a position a league starts only
 * twelve of from becoming a twelve-point stub.
 */
function displayDepth(
  structuralDemand: number,
  settings: WarInput["settings"],
): number {
  return Math.max(
    settings.minDisplayDepth,
    Math.ceil(structuralDemand * settings.displayDepthMultiple),
  );
}

/**
 * The first rank whose WAR falls below `cliffThreshold` of the best player's.
 *
 * Null when rank 1 carries no WAR at all (nothing to fall from) or when no rank
 * inside the plotted depth falls that far. A null is the absence of a cliff,
 * never a printed zero.
 */
function findCliffRank(curve: WarCurvePoint[], threshold: number): number | null {
  const top = curve[0]?.war ?? 0;
  if (top <= 0) return null;
  const bar = top * threshold;
  for (const point of curve) {
    if (point.war < bar) return point.positionRank;
  }
  return null;
}

/** Everything one position's players contribute, before ranking. */
type ScoredPlayer = {
  player: WarPlayerInput;
  war: number;
  par: number;
  projectedPointsPerWeek: number;
  replacementPointsPerWeek: number;
  weeksProjected: number;
};

/**
 * Compute every position's curve for one league.
 *
 * `input.players` is the whole projectable universe at the positions this
 * league can start, NOT one league's rosters. Ownership never enters the model,
 * which is what makes the result a pure function of the league's settings and
 * what lets two leagues with identical settings share one computation.
 */
export function computeCurves(input: WarInput): WarResult {
  const { league, players, settings } = input;

  const weeks: number[] = [];
  for (let week = league.fromWeek; week <= league.toWeek; week += 1) weeks.push(week);

  const positions = startablePositions(league.slots);

  // Slot tokens this league runs that no projection covers. Rendered as a
  // footnote from the league's raw roster_positions by the caller; recorded
  // here so a caller that only has the engine's output can still say it.
  const excludedSlots: string[] = [];

  if (weeks.length === 0 || positions.length === 0 || players.length === 0) {
    return { curves: [], excludedSlots };
  }

  // The structural fill: bye-free, every player represented by his mean across
  // the window. This is the ONLY source of structural demand.
  const structuralFill = buildMergedFill({
    slots: league.slots,
    teamCount: league.teamCount,
    candidates: structuralCandidates(players, weeks),
    week: null,
  });

  // One fill per week. W + 1 total, with the structural fill above.
  const weeklyFills = new Map<number, MergedFill>();
  for (const week of weeks) {
    weeklyFills.set(
      week,
      buildMergedFill({
        slots: league.slots,
        teamCount: league.teamCount,
        candidates: weekCandidates(players, week),
        week,
      }),
    );
  }

  const curves: PositionCurve[] = [];

  for (const position of positions) {
    const structural = positionWeekStats(structuralFill, position);
    // A position that seats nobody even in the bye-free fill is not a position
    // this league starts in practice. Drop it rather than plot an empty series.
    if (structural.seatedCount === 0) continue;

    const structuralDemand = structural.seatedCount;

    // Weekly stats, computed once per week and reused by every player at this
    // position. This is what keeps the cost O(W * V * E) rather than
    // O(P * W * V * E): the fills are already built, and the per-position
    // quantities are read off them once.
    const weekStats = new Map<number, PositionWeekStats>();
    const diagnostics: WeeklyDiagnostic[] = [];
    for (const week of weeks) {
      const fill = weeklyFills.get(week);
      if (!fill) continue;
      const stats = positionWeekStats(fill, position);
      weekStats.set(week, stats);
      diagnostics.push({
        week,
        seatedCount: stats.seatedCount,
        replacement: round(stats.replacement, 2),
        avgSeated: round(stats.avgSeated, 2),
        deficit: round(stats.deficit, 2),
        muRef: round(fill.muRef, 2),
        sigmaRef: round(fill.sigmaRef, 2),
      });
    }

    // A position is shallow when the pool ran thin in ANY week of the window.
    // Reported at the position level because the footnote is one sentence, and
    // "the pool was thinner than this league starts" is true of the position as
    // soon as it is true of one week.
    const shallowPool =
      structural.shallowPool || [...weekStats.values()].some((s) => s.shallowPool);

    const scored: ScoredPlayer[] = [];
    for (const player of players) {
      if (player.position !== position) continue;

      const weeklyInputs: WeeklyWarInput[] = [];
      const projectedPoints: number[] = [];
      const replacementPoints: number[] = [];
      let seasonPar = 0;

      for (const week of weeks) {
        const stats = weekStats.get(week);
        const fill = weeklyFills.get(week);
        if (!stats || !fill || stats.seatedCount === 0) continue;
        replacementPoints.push(stats.replacement);

        const projection = player.byWeek.get(week);
        // A bye or an unpublished week. Absent, never a zero. It contributes
        // nothing to the season sum and nothing to his per-week mean.
        if (!projection) continue;

        projectedPoints.push(projection.points);
        const par = pointsAboveReplacement(
          projection.points,
          stats.replacement,
          settings.clampBelowReplacement,
        );
        seasonPar += par;
        weeklyInputs.push({
          muRef: fill.muRef,
          sigmaRef: fill.sigmaRef,
          deficit: stats.deficit,
          par,
        });
      }

      if (projectedPoints.length === 0) continue;

      scored.push({
        player,
        war: seasonWar(weeklyInputs),
        par: seasonPar,
        projectedPointsPerWeek: mean(projectedPoints),
        replacementPointsPerWeek: mean(replacementPoints),
        weeksProjected: projectedPoints.length,
      });
    }

    if (scored.length === 0) continue;

    // Rank by WAR, ties broken by PAR, then by projected points a week, then by
    // player id ascending so the order is total and a recompute cannot
    // reshuffle two identical players.
    //
    // THE PROJECTED-POINTS TIEBREAK IS NOT COSMETIC. With
    // clampBelowReplacement on (the default), every player who never beats
    // weekly replacement scores exactly 0.000 WAR and exactly 0.0 PAR, and in
    // a real 12-team league that is most of the tail: measured against
    // production, ranks 51 through 78 of one league's wide receiver curve were
    // all 0.000. Falling straight to player id there ordered them by a uuid,
    // so the curve asserted that one replacement-level receiver ranked ahead
    // of another for no reason at all, and the player table sorted by WAR
    // inherited that ordering as if it meant something.
    //
    // Projected points a week is a real, non-zero, honestly-ordered number for
    // exactly those players. It never affects anyone with positive WAR (WAR is
    // strictly increasing in PAR, so a WAR tie among above-replacement players
    // is already a PAR tie and then a near-exact points tie), so this changes
    // the ordering only where the previous ordering was arbitrary.
    scored.sort((a, b) => {
      if (b.war !== a.war) return b.war - a.war;
      if (b.par !== a.par) return b.par - a.par;
      if (b.projectedPointsPerWeek !== a.projectedPointsPerWeek) {
        return b.projectedPointsPerWeek - a.projectedPointsPerWeek;
      }
      return a.player.playerId < b.player.playerId ? -1 : 1;
    });

    const depth = displayDepth(structuralDemand, settings);
    const curve: WarCurvePoint[] = scored.slice(0, depth).map((entry, index) => ({
      playerId: entry.player.playerId,
      sleeperId: entry.player.sleeperId,
      slug: entry.player.slug,
      name: entry.player.name,
      team: entry.player.team,
      injuryStatus: entry.player.injuryStatus,
      positionRank: index + 1,
      war: round(entry.war, 3),
      pointsAboveReplacement: round(entry.par, 1),
      projectedPointsPerWeek: round(entry.projectedPointsPerWeek, 1),
      replacementPointsPerWeek: round(entry.replacementPointsPerWeek, 1),
      weeksProjected: entry.weeksProjected,
    }));

    // The player sitting exactly at structural demand. Absent when the pool is
    // shorter than the league starts, in which case the figure is null and the
    // marker's label drops it rather than printing a fabricated zero.
    const atDemand = curve.find((point) => point.positionRank === structuralDemand) ?? null;

    curves.push({
      position,
      structuralDemand,
      replacementPoints: round(
        mean([...weekStats.values()].filter((s) => s.seatedCount > 0).map((s) => s.replacement)),
        2,
      ),
      avgSeatedPoints: round(
        mean([...weekStats.values()].filter((s) => s.seatedCount > 0).map((s) => s.avgSeated)),
        2,
      ),
      deficit: round(
        mean([...weekStats.values()].filter((s) => s.seatedCount > 0).map((s) => s.deficit)),
        2,
      ),
      shallowPool,
      warRank1: curve[0]?.war ?? null,
      warAtDemand: atDemand ? atDemand.war : null,
      cliffRank: findCliffRank(curve, settings.cliffThreshold),
      curve,
      weeklyDiagnostics: diagnostics,
    });
  }

  return { curves, excludedSlots };
}

/**
 * Slot tokens a league runs that this model cannot project, for the footnote.
 *
 * Sleeper publishes projections for DEF, K, QB, RB, TE and WR only, so an IDP
 * league's defensive slots have no projection and are excluded. Reported by
 * name so the footnote can say WHICH positions were left out, which is the
 * difference between an honest omission and a silently short answer.
 *
 * Derived from the league's RAW roster_positions rather than from the
 * fingerprint, so two leagues that share a curve still get their own footnote.
 */
export function unprojectableSlots(
  rosterPositions: string[],
  nonStarting: ReadonlySet<string>,
  eligibility: Record<string, PulsePosition[]>,
): string[] {
  const out = new Set<string>();
  for (const token of rosterPositions) {
    if (nonStarting.has(token)) continue;
    const eligible = eligibility[token];
    if (!eligible || eligible.length === 0) out.add(token);
  }
  return [...out];
}
