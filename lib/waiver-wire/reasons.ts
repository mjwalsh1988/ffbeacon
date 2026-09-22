/**
 * The one sentence under every name on the waiver board.
 *
 * Deterministic templates, never a language model, for the same reason
 * `lib/faab/reasons.ts` is: every clause cites a figure printed in the same
 * row, so a reader can check the sentence against the numbers beside it. A
 * generated sentence is the kind that reads well and cannot be checked, and on
 * a page whose whole claim is "measured, not asserted" that would be the one
 * thing undermining it.
 *
 * A figure we do not have means its clause does not fire. Nothing is hedged
 * into meaninglessness and nothing is invented to fill a gap: a row with only
 * an availability figure gets a sentence about availability, which is short and
 * true, rather than a long one that is neither.
 *
 * Ordered by what actually drives the recommendation. Opportunity first,
 * because a role change is the reason a waiver claim exists at all; then what
 * he projects for against the alternative; then how widely he is gone.
 *
 * Pure.
 */

import type { BoardPosition, Opportunity, RosterRate } from "./types";

/**
 * The positions that touch the ball, and therefore the only ones a usage
 * sentence can be written about.
 *
 * A kicker has no targets and a team defense has no carries, so the touch
 * clause fired on them with a zero and produced "0 touches in week 2, in line
 * with his 0.0 average" under the Detroit Lions. That is three separate
 * wrongnesses in one clause: a statistic that cannot exist, a comparison
 * against it, and a pronoun for a football team.
 */
const TOUCH_POSITIONS: readonly BoardPosition[] = ["QB", "RB", "WR", "TE"];

/** The long form, for a sentence. "the last startable DEF" reads as an acronym. */
const POSITION_WORD: Record<BoardPosition, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

/**
 * How much of a position's edge over replacement actually survives the week.
 *
 * Points above replacement is the right currency for a claim you KEEP. It
 * overstates a kicker and a team defense badly, because nobody keeps either:
 * they are streamed, re-picked against next week's matchup, and dropped. An
 * upgrade you hold for the rest of the season and an upgrade you hold for one
 * Sunday are not worth the same money, and before this weight the board's top
 * two entries in week 3 were both defenses, which is not a waiver wire page.
 *
 * 0.35 is a judgement rather than a measurement, and it is a deliberately
 * blunt one: it is enough to put the skill positions back on top without
 * removing streamers from the board, which readers do genuinely search for.
 * It affects the ORDER only. Every figure printed on a row is untouched, so a
 * defense still shows its real projection and its real edge over replacement.
 */
const POSITION_PERSISTENCE: Record<BoardPosition, number> = {
  QB: 1,
  RB: 1,
  WR: 1,
  TE: 1,
  K: 0.35,
  DEF: 0.35,
};

export type ReasonInput = {
  position: BoardPosition;
  opportunity: Opportunity;
  rosterRate: RosterRate | null;
  /** Adjusted points for the board's week. */
  projectedPoints: number | null;
  /** Over the last startable player at his position. */
  pointsAboveReplacement: number | null;
  /** The NFL team he faces this week. */
  opponent: string | null;
  /** True when the board's week has already been played. */
  isPast: boolean;
};

/** One decimal, with a sign, for a difference. */
function signed(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

/** "targets and carries" reads long; the row calls them touches and so does this. */
function touchClause(o: Opportunity, position: BoardPosition): string | null {
  if (!TOUCH_POSITIONS.includes(position)) return null;
  if (o.lastTouches == null || o.lastWeek == null) return null;
  if (o.touchDelta == null || o.priorTouches == null) {
    return `${whole(o.lastTouches)} touches in week ${o.lastWeek}`;
  }
  if (o.touchDelta >= 2) {
    return `${whole(o.lastTouches)} touches in week ${o.lastWeek}, ${signed(
      o.touchDelta,
    )} on his ${one(o.priorTouches)} average before it`;
  }
  if (o.touchDelta <= -2) {
    return `${whole(o.lastTouches)} touches in week ${o.lastWeek}, down from ${one(
      o.priorTouches,
    )}`;
  }
  return `${whole(o.lastTouches)} touches in week ${o.lastWeek}, in line with his ${one(
    o.priorTouches,
  )} average`;
}

/**
 * What a kicker or a defense did last week, which is all the usage there is.
 *
 * Used in place of the touch clause for the two positions that have none, so
 * the row still opens with something that happened rather than jumping
 * straight to a projection.
 */
function lastPointsClause(o: Opportunity, position: BoardPosition): string | null {
  if (TOUCH_POSITIONS.includes(position)) return null;
  if (o.lastPoints == null || o.lastWeek == null) return null;
  return `scored ${one(o.lastPoints)} in week ${o.lastWeek}`;
}

function snapClause(o: Opportunity): string | null {
  if (o.snapPct == null || o.snapWeek == null) return null;
  return `on ${one(o.snapPct)} percent of his team's snaps in week ${o.snapWeek}`;
}

function projectionClause(input: ReasonInput): string | null {
  const { projectedPoints, pointsAboveReplacement, opponent, isPast } = input;
  if (projectedPoints == null) return null;
  const verb = isPast ? "projected" : "projects";
  const opp = opponent ? ` against ${opponent}` : "";
  if (pointsAboveReplacement == null) {
    return `${verb} for ${one(projectedPoints)} points${opp}`;
  }
  const word = POSITION_WORD[input.position];
  if (pointsAboveReplacement > 0) {
    return `${verb} for ${one(projectedPoints)} points${opp}, ${one(
      pointsAboveReplacement,
    )} more than the last startable ${word} in a standard league`;
  }
  // A NEGATIVE FIGURE GETS NO CLAUSE AT ALL, AND THAT IS NOT HIDING IT.
  // Replacement level for a skill position in a twelve-team league sits above
  // nearly everything on the wire by construction (the last startable wide
  // receiver is about the 47th best), so a "below replacement" clause fires on
  // essentially every skill row. Printed twenty-four times down a page it stops
  // being information and starts being wallpaper, and it crowds out the
  // availability clause, which differs from card to card and is the one a
  // reader is actually comparing.
  //
  // The fact itself is still said, once per section rather than once per
  // player, in the position helper text on the board's panel headers. That is
  // the right altitude for a truth that is structural rather than about any
  // individual on the list.
  return `${verb} for ${one(projectedPoints)} points${opp}`;
}

function availabilityClause(rate: RosterRate | null): string | null {
  if (!rate || rate.pct == null) return null;
  if (rate.pct < 5) {
    return `free in ${whole(100 - rate.pct)} percent of the leagues we track`;
  }
  return `rostered in ${whole(rate.pct)} percent of the leagues we track`;
}

/**
 * Build the row's sentence.
 *
 * At most three clauses. A fourth was tried and read as a paragraph in a table
 * cell, which is where a reader stops reading it.
 */
export function buildReason(input: ReasonInput): string {
  const clauses: string[] = [];

  const touch =
    touchClause(input.opportunity, input.position) ??
    lastPointsClause(input.opportunity, input.position);
  if (touch) clauses.push(touch);

  // Snap share earns its place only when touches did not already make the
  // point, or when it disagrees with them. Saying both every time turns every
  // row into the same sentence.
  const snap = TOUCH_POSITIONS.includes(input.position)
    ? snapClause(input.opportunity)
    : null;
  if (snap && (!touch || (input.opportunity.snapPct ?? 0) >= 55)) {
    clauses.push(snap);
  }

  const projection = projectionClause(input);
  if (projection) clauses.push(projection);

  const availability = availabilityClause(input.rosterRate);
  if (availability && clauses.length < 3) clauses.push(availability);

  if (clauses.length === 0) {
    // Everything was missing. Say that, rather than saying nothing, because a
    // blank cell reads as a rendering fault and this is a real state: a player
    // we rank but hold no games and no projection for.
    return "Ranked here, but we hold no usage or projection for him yet this season.";
  }

  const sentence = clauses.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Where a row sorts.
 *
 * Three things, weighted, and the weights are the argument the page makes:
 *
 *   - What he adds over a startable replacement is the biggest term, because
 *     that is the actual question. A tight end projected for nine is a bigger
 *     add than a receiver projected for eleven, and only this term knows it.
 *   - Whether his role just changed is next. It is what separates a player
 *     worth bidding on this week from one who has been available all year at
 *     the same price.
 *   - How widely he is gone is a small negative. A player rostered in half the
 *     leagues is a real add for the other half, so he stays on the board; he
 *     just sits below the one nobody has taken yet.
 *
 * Exposed and stored on the row so `rank.test.ts` can pin an ordering rather
 * than asserting on rendered output.
 */
export function boardScore(input: {
  position: BoardPosition;
  pointsAboveReplacement: number | null;
  projectedPoints: number | null;
  opportunitySwing: number;
  rosterPct: number | null;
}): number {
  const par = input.pointsAboveReplacement;
  // A player with no projection is not evidence of anything, so he scores off
  // the bottom rather than scoring zero and landing among the neutral ones.
  if (par == null && input.projectedPoints == null) return -100;

  // Weighted by how long the upgrade lasts, so a one-week streaming position
  // cannot outrank a starter you would keep. Order only; the printed figure is
  // the real one.
  const parTerm = (par ?? 0) * POSITION_PERSISTENCE[input.position];
  const swingTerm = input.opportunitySwing * 4.0;
  const scarcityTerm = input.rosterPct == null ? 0 : -(input.rosterPct / 100) * 3.0;
  return Math.round((parTerm + swingTerm + scarcityTerm) * 100) / 100;
}

/**
 * The one player the page leads with.
 *
 * Deliberately NOT `rows[0]`. The flat score exists to order players INSIDE a
 * position, and across positions it still leans toward kickers and defenses
 * even after the persistence weight, because their replacement bar is so much
 * lower (the full argument is in the header of
 * `components/waiver-wire/waiver-board.tsx`). A page whose headline add is a
 * streaming defense is a page nobody reads twice.
 *
 * So the hero is the best of the four positions people actually make claims
 * for, and the fallback to the whole board exists only so a week with nothing
 * but streamers still shows something rather than an empty frame.
 *
 * Pure. Takes the rows the board already sorted and picks one.
 */
export function topPickup<T extends { position: BoardPosition; score: number }>(
  rows: readonly T[],
): T | null {
  if (rows.length === 0) return null;
  const skill = rows.filter((r) => TOUCH_POSITIONS.includes(r.position));
  const pool = skill.length > 0 ? skill : rows;
  return pool.reduce((best, row) => (row.score > best.score ? row : best), pool[0]);
}
