/**
 * What a player's role did, measured from the games already played.
 *
 * Pure. Takes stat lines and returns the shape the board renders.
 *
 * WHY OPPORTUNITY AND NOT POINTS. A waiver claim is a bet on a role, and a role
 * change shows up in touches a week or two before it shows up in fantasy
 * points. A back-up running back who carried it fourteen times on Sunday is the
 * add whether or not one of those carries reached the end zone; a receiver who
 * scored eighteen points on two catches is the one everybody else is bidding
 * on for the wrong reason. Touches are the honest column.
 *
 * WHY TOUCHES ARE TARGETS PLUS CARRIES AND NOT SNAP SHARE. Snap share is the
 * better measure and we show it, but Sleeper publishes it a week late:
 * `snap_pct` is populated for week 1 while week 2 is still null, verified
 * against production. A board that led on snap share would be blank for the
 * exact week a reader is bidding into. `rec_tgt` and `rush_att` are populated
 * the same night, so they lead and snap share follows with its own week label.
 *
 * WHY THE BASELINE IS A MEAN AND NOT LAST WEEK. Comparing week 3 to week 2
 * alone turns one quiet game into a collapse and one good game into a
 * breakout. The baseline is every earlier week we hold, which in week 3 is two
 * games and by week 10 is nine, so the comparison gets steadier as the season
 * gives it more to work with.
 *
 * NOTHING HERE INVENTS A ZERO. A player with no line at all has nulls, not
 * zeroes, because "he did not play" and "he played and touched it nothing
 * times" are different facts and only one of them is evidence.
 */

import type { Opportunity } from "./types";

/** One week of a player's counting stats, as the board reads them. */
export type StatLine = {
  week: number;
  /** Targets. Null where Sleeper published no receiving line. */
  targets: number | null;
  /** Carries. Null where Sleeper published no rushing line. */
  carries: number | null;
  /** Offensive snaps played, and the team's total, when both are published. */
  offSnaps: number | null;
  teamOffSnaps: number | null;
  /** Fantasy points in the board's scoring, from the same row. */
  points: number | null;
  /** Games played in the row. Sleeper writes 0 for a week somebody missed. */
  gamesPlayed: number | null;
};

const EMPTY: Opportunity = {
  lastTouches: null,
  lastWeek: null,
  priorTouches: null,
  touchDelta: null,
  snapPct: null,
  snapWeek: null,
  lastPoints: null,
  weeksPlayed: 0,
};

/** Targets plus carries, or null when neither side published anything. */
function touchesOf(line: StatLine): number | null {
  if (line.targets == null && line.carries == null) return null;
  return (line.targets ?? 0) + (line.carries ?? 0);
}

/** Snap share as a percentage, or null when the team total is missing or zero. */
function snapPctOf(line: StatLine): number | null {
  if (line.offSnaps == null || line.teamOffSnaps == null) return null;
  if (line.teamOffSnaps <= 0) return null;
  return round1((line.offSnaps / line.teamOffSnaps) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the opportunity read for one player.
 *
 * `lines` may arrive in any order and may contain weeks at or after
 * `throughWeek`; anything from `throughWeek` onward is dropped, because a board
 * for week 4 must not quote what happened in week 4. That is not a detail: the
 * page is published on the Tuesday and read all week, and a row that silently
 * started including Sunday's result would change its own argument mid-week.
 */
export function buildOpportunity(lines: StatLine[], throughWeek: number): Opportunity {
  const played = lines
    .filter((l) => l.week < throughWeek)
    // A row Sleeper wrote for a week the player missed carries gp = 0. It is a
    // real fact about availability but it is not a week of usage, so it counts
    // toward nothing here except being absent from the baseline.
    .filter((l) => (l.gamesPlayed == null ? true : l.gamesPlayed > 0))
    .sort((a, b) => a.week - b.week);

  if (played.length === 0) return EMPTY;

  const last = played[played.length - 1];
  const lastTouches = touchesOf(last);

  const priorLines = played.slice(0, -1);
  const priorValues = priorLines
    .map(touchesOf)
    .filter((v): v is number => v != null);
  const priorTouches =
    priorValues.length > 0
      ? round1(priorValues.reduce((a, b) => a + b, 0) / priorValues.length)
      : null;

  // The newest week that actually carries a snap share, which is usually the
  // one before `last` rather than `last` itself.
  let snapPct: number | null = null;
  let snapWeek: number | null = null;
  for (let i = played.length - 1; i >= 0; i -= 1) {
    const pct = snapPctOf(played[i]);
    if (pct != null) {
      snapPct = pct;
      snapWeek = played[i].week;
      break;
    }
  }

  return {
    lastTouches,
    lastWeek: last.week,
    priorTouches,
    touchDelta:
      lastTouches != null && priorTouches != null
        ? round1(lastTouches - priorTouches)
        : null,
    snapPct,
    snapWeek,
    lastPoints: last.points == null ? null : round1(last.points),
    weeksPlayed: played.length,
  };
}

/**
 * How much a role moved, as a single 0-to-1 number the board can sort on.
 *
 * Deliberately blunt. It answers "did something change" and nothing more; the
 * question of whether the change is worth money is the projection's and the
 * bid's, further along the row. A player with no baseline to compare against
 * scores 0 rather than scoring high on the strength of one game, because a
 * rookie's first appearance and a starter's promotion look identical in week
 * one and only one of them is news.
 */
export function opportunitySwing(o: Opportunity): number {
  if (o.touchDelta == null || o.priorTouches == null) return 0;
  if (o.touchDelta <= 0) return 0;
  // Six extra touches is a full role change; past that the curve flattens,
  // because the difference between +6 and +14 is mostly one blowout.
  return Math.min(1, o.touchDelta / 6);
}
