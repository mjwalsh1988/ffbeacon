/**
 * Grading one settled week of one roster's lineup.
 *
 * Pure. No database, no clock, no network. Everything arrives as plain data.
 *
 * THE OPTIMISER IS THE ONE IN lib/power-pulse/lineup.ts, UNCHANGED.
 *   `buildOptimalLineup` solves a maximum weight independent set in a
 *   transversal matroid, which is exact for the overlapping non-nested slots
 *   real leagues run (WR_TE alongside WRRB_FLEX). Power Pulse feeds it
 *   PROJECTED points to predict a week; this feeds it ACTUAL points to grade
 *   one that already happened. Same algorithm, different input, and no second
 *   copy of it, so a fix to the fill can never make the prediction and the
 *   retrospective disagree about the same league.
 *
 * WHY THE COMPARISON IS ONE-SIDED
 *   The best-lineup result is compared against the opponent's score EXACTLY AS
 *   IT HAPPENED. The opponent's bench is left alone. "What if we had both been
 *   perfect" is a different question and a much less useful one, because a
 *   reader cannot set their opponent's lineup, and the point of this figure is
 *   what was within their own control.
 *
 * WHY A SLOT THIS MODEL CANNOT GRADE IS NOT SCORED AS ZERO
 *   `startingSlots` drops the tokens it has no position eligibility for, which
 *   in practice means IDP. If the set lineup were measured over every slot and
 *   the optimum over only some of them, the difference would include the
 *   linebackers and read as a deficit the manager never had. So both sides are
 *   measured over the SAME gradable subset, the ungraded slots are counted and
 *   reported, and the head-to-head result adds the deficit back onto the
 *   official score rather than rebuilding the total from parts.
 */

import {
  buildOptimalLineup,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import { PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import type {
  GradedWeek,
  LedgerMiss,
  LedgerOutcome,
  LedgerPosition,
  LedgerRecord,
  LineupLedger,
} from "./types";

/** A player as this model needs them: an id, a name, and a gradable position. */
export type LedgerPlayer = {
  sleeperId: string;
  name: string;
  position: LedgerPosition;
};

/** One roster's settled week, exactly as `league_matchups` stores it. */
export type WeekInput = {
  week: number;
  /** Sleeper's official total for the week. */
  officialPoints: number;
  /** Positional, placeholders included. starterIds[i] fills alignedSlots[i]. */
  starterIds: string[];
  /** Actual points keyed by Sleeper player id, for every rostered player. */
  playerPoints: Map<string, number>;
  /** The opponent's official total, or null when the roster was unpaired. */
  opponentPoints: number | null;
  /**
   * Sleeper ids this roster could not legally have started: injured reserve and
   * the taxi squad.
   *
   * WHY THIS EXISTS. `player_points` carries a score for every player ON the
   * roster, IR and taxi included, and 13,608 stored roster-weeks currently have
   * one. Without the filter, the best legal lineup could seat a taxi-squad
   * rookie who put up 22 points, and the page would tell a manager they left a
   * win on the bench by not starting someone Sleeper would not have let them
   * start. That figure is the headline of the whole feature, so it may only
   * ever name a lineup that was genuinely available.
   *
   * THE LIMITATION, STATED. These are the roster's CURRENT lists; Sleeper
   * publishes no per-week history of them. A player on IR now but healthy in
   * week 3 would be wrongly excluded from week 3. Two things bound that: anyone
   * who ACTUALLY STARTED a week is treated as eligible that week regardless
   * (see gradeWeek), which is proof rather than inference, and an IR player is
   * usually not playing, so he scores nothing and could not have improved the
   * lineup anyway. `components/manager-ledger/how-it-works.tsx` says so on the
   * page rather than leaving a reader to discover it.
   */
  ineligibleIds: ReadonlySet<string>;
};

/** The startable slots split into the ones this model can grade and the rest. */
export type SlotPlan = {
  /** Index into Sleeper's `starters` array, paired with the slot token. */
  aligned: { index: number; token: string; gradable: boolean }[];
  gradableTokens: string[];
  ungradableTokens: string[];
};

/**
 * Expand `roster_positions` once per league rather than once per week.
 *
 * The alignment comes from `alignedStartingSlots`, which keeps every non-bench
 * token including the ones we cannot grade, because dropping one would shift
 * every player below it into the wrong slot. See its header; that bug is the
 * reason the function exists.
 */
export function planSlots(rosterPositions: string[]): SlotPlan {
  const aligned = alignedStartingSlots(rosterPositions).map((slot) => ({
    index: slot.order,
    token: slot.token,
    gradable: slot.projectable,
  }));
  return {
    aligned,
    gradableTokens: aligned.filter((s) => s.gradable).map((s) => s.token),
    ungradableTokens: aligned.filter((s) => !s.gradable).map((s) => s.token),
  };
}

/**
 * Snap a points figure to the precision the domain actually has.
 *
 * Fantasy points arrive from Sleeper at two decimal places, so a sum of ten of
 * them is a two-decimal number and anything past that is IEEE-754 residue. It
 * matters here rather than being cosmetic: without this, a week whose set
 * lineup WAS the best legal lineup came out with a deficit of 1.4e-14 rather
 * than zero, which is greater than zero, so the week reported points left on
 * the bench and the season efficiency landed at 0.9999999999 instead of 1.
 * Rounding where the figure is produced keeps the weekly values and their
 * season total consistent, because both are two-decimal quantities already.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sleeper's placeholder for an empty slot. Never a player id. */
function isRealId(id: string | undefined): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

/** Can a player of this position legally occupy this slot? */
function eligible(token: string, position: LedgerPosition): boolean {
  const list = PULSE_SLOT_ELIGIBILITY[token];
  return Array.isArray(list) && (list as string[]).includes(position);
}

/**
 * The single most valuable swap that was available, or null when the lineup
 * could not have been improved by any one change.
 *
 * Legality is checked against the specific slot being vacated, so a swap this
 * reports is one the manager could actually have made. A kicker is never
 * offered for a flex.
 *
 * Reported on its own terms: the biggest single swap, not a step in a plan.
 * Take it and the second-biggest is worth something different, which is why
 * only one is reported per week and why the swaps are never summed.
 */
export function biggestMiss(
  plan: SlotPlan,
  starterIds: string[],
  playerPoints: Map<string, number>,
  players: Map<string, LedgerPlayer>,
  /** IR and taxi ids, which may not be offered as a swap. See WeekInput. */
  ineligibleIds: ReadonlySet<string> = new Set(),
): LedgerMiss | null {
  const started = new Set<string>();
  for (const slot of plan.aligned) {
    const id = starterIds[slot.index];
    if (isRealId(id)) started.add(id);
  }

  // Everyone on the roster who did not start and whom we can place.
  const bench: { id: string; player: LedgerPlayer; points: number }[] = [];
  for (const [id, points] of playerPoints) {
    if (started.has(id)) continue;
    if (ineligibleIds.has(id)) continue;
    const player = players.get(id);
    if (!player) continue;
    bench.push({ id, player, points });
  }
  if (bench.length === 0) return null;

  let best: LedgerMiss | null = null;
  for (const slot of plan.aligned) {
    if (!slot.gradable) continue;
    const outId = starterIds[slot.index];
    const outReal = isRealId(outId);
    const outPlayer = outReal ? players.get(outId) : undefined;
    // An empty slot scores nothing and can be filled by anyone eligible for it.
    const outPoints = outReal ? (playerPoints.get(outId) ?? 0) : 0;

    for (const candidate of bench) {
      if (!eligible(slot.token, candidate.player.position)) continue;
      const gain = candidate.points - outPoints;
      if (gain <= 0) continue;
      if (best && gain <= best.gain) continue;
      best = {
        inName: candidate.player.name,
        inPoints: candidate.points,
        outPlayerId: outReal ? outId : null,
        outName:
          outPlayer?.name ?? (outReal ? "an unknown player" : "an empty slot"),
        outPoints,
        gain,
      };
    }
  }
  return best;
}

/**
 * Grade one settled week.
 *
 * `sigma` is zero on every candidate on purpose. The optimiser takes it because
 * Power Pulse needs a spread to carry forward into a simulation; a week that
 * has already been played has no uncertainty left in it, and a fabricated
 * spread here would be a number with no meaning that some later reader would
 * be entitled to believe.
 */
export function gradeWeek(
  plan: SlotPlan,
  input: WeekInput,
  players: Map<string, LedgerPlayer>,
): GradedWeek {
  // Anyone who ACTUALLY STARTED this week was startable this week, whatever the
  // roster's current IR and taxi lists say. That is proof rather than
  // inference, and it is what keeps a stale IR entry from erasing a player who
  // demonstrably played. See WeekInput.ineligibleIds.
  const started = new Set<string>();
  for (const slot of plan.aligned) {
    const id = input.starterIds[slot.index];
    if (isRealId(id)) started.add(id);
  }
  const ineligible = new Set<string>();
  for (const id of input.ineligibleIds) {
    if (!started.has(id)) ineligible.add(id);
  }

  // THE CANDIDATE SET IS BUILT FIRST, AND THE SET LINEUP IS THEN SCORED FROM
  // IT. Both sides of the comparison have to be measured over the same pool or
  // the difference between them is not a lineup decision. Scoring the set
  // lineup straight off `playerPoints` instead let a starter our players table
  // has not caught up with land in the numerator and not the denominator, which
  // reported a manager as perfect on a week we could not actually measure.
  const candidates: LineupCandidate[] = [];
  const byId = new Map<string, LineupCandidate>();
  for (const [id, points] of input.playerPoints) {
    if (ineligible.has(id)) continue;
    const player = players.get(id);
    if (!player) continue;
    const candidate = {
      playerId: id,
      position: player.position,
      points,
      sigma: 0,
    };
    candidates.push(candidate);
    byId.set(id, candidate);
  }

  let setPoints = 0;
  for (const slot of plan.aligned) {
    if (!slot.gradable) continue;
    const id = input.starterIds[slot.index];
    if (!isRealId(id)) continue;
    const candidate = byId.get(id);
    if (!candidate) continue;
    setPoints += candidate.points;
  }

  const optimal = buildOptimalLineup(plan.gradableTokens, candidates);
  const gradedSet = round2(setPoints);
  const gradedOptimal = round2(optimal.total);
  const pointsLeft = Math.max(0, round2(gradedOptimal - gradedSet));

  const opponentPoints = input.opponentPoints;
  // The best lineup improves only the slots this model grades, so the deficit
  // is added onto the official score rather than the total being rebuilt from
  // parts. Identical arithmetic, and immune to the rounding difference between
  // Sleeper's own total and our sum of its per-player points.
  const outcome = resultOf(input.officialPoints, opponentPoints);
  const bestLineupOutcome = resultOf(
    round2(input.officialPoints + pointsLeft),
    opponentPoints,
  );

  return {
    week: input.week,
    officialPoints: round2(input.officialPoints),
    setPoints: gradedSet,
    optimalPoints: gradedOptimal,
    pointsLeft,
    ungradedSlots: plan.ungradableTokens.length,
    opponentPoints,
    outcome,
    bestLineupOutcome,
    biggestMiss:
      pointsLeft > 0
        ? biggestMiss(
            plan,
            input.starterIds,
            input.playerPoints,
            players,
            ineligible,
          )
        : null,
  };
}

/**
 * Win, loss or draw. A draw is its own outcome rather than a loss, because a
 * league that awards half a game for one would otherwise have its records
 * silently rewritten by this page.
 */
function resultOf(
  points: number,
  opponentPoints: number | null,
): LedgerOutcome | null {
  if (opponentPoints === null) return null;
  if (points > opponentPoints) return "win";
  if (points < opponentPoints) return "loss";
  return "tie";
}

function emptyRecord(): LedgerRecord {
  return { wins: 0, losses: 0, ties: 0 };
}

function tally(record: LedgerRecord, outcome: LedgerOutcome): void {
  if (outcome === "win") record.wins += 1;
  else if (outcome === "loss") record.losses += 1;
  else record.ties += 1;
}

/** Roll a season's graded weeks into one roster's lineup ledger. */
export function summariseLineup(weeks: GradedWeek[]): LineupLedger {
  const actualRecord = emptyRecord();
  const bestLineupRecord = emptyRecord();
  let setPoints = 0;
  let optimalPoints = 0;
  let pointsLeft = 0;
  let winsLeftOnBench = 0;
  let weeksWithUngradedSlots = 0;

  for (const week of weeks) {
    setPoints += week.setPoints;
    optimalPoints += week.optimalPoints;
    pointsLeft += week.pointsLeft;
    if (week.ungradedSlots > 0) weeksWithUngradedSlots += 1;

    if (week.outcome === null) continue;
    tally(actualRecord, week.outcome);
    if (week.bestLineupOutcome !== null)
      tally(bestLineupRecord, week.bestLineupOutcome);

    // A game that was LOST and that the best legal lineup out of the same
    // players would have WON. Ties are deliberately excluded at both ends:
    // turning a draw into a win is half a game, and this figure is a count of
    // whole games so it stays checkable against the schedule one row at a time.
    if (week.outcome === "loss" && week.bestLineupOutcome === "win")
      winsLeftOnBench += 1;
  }

  return {
    weeksGraded: weeks.length,
    setPoints: round2(setPoints),
    optimalPoints: round2(optimalPoints),
    pointsLeft: round2(pointsLeft),
    efficiency:
      optimalPoints > 0 ? Math.min(1, setPoints / optimalPoints) : null,
    actualRecord,
    bestLineupRecord,
    winsLeftOnBench,
    weeksWithUngradedSlots,
    // Stored whole since ledger-4. The three fields this used to drop are what
    // the Lineups page's per-week efficiency chart is built from; see the note
    // on `setPoints` in ./types.ts for why they cannot be derived instead.
    weeks,
  };
}
