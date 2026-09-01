/**
 * Which game gets written about.
 *
 * TWO GAMES, PICKED FOR OPPOSITE REASONS, and the second one is not an
 * afterthought. A league where only the top of the table is covered is a league
 * where eight of twelve managers never see their own team named, and the bottom
 * of the table is where the comedy actually lives.
 *
 *   THE HEADLINE   The game that matters to the standings. Two good teams, and
 *                  a margin close enough that it is genuinely in doubt. A
 *                  first-versus-last blowout matters to nobody: the result is
 *                  already known, so there is nothing to preview.
 *
 *   THE UNDERCARD  The other end. Two teams with nothing to play for, which is
 *                  exactly why it is funny, and it is picked to be a DIFFERENT
 *                  game from the headline rather than merely a worse-scoring
 *                  one, so a six-game week never writes the same fixture twice.
 *
 * Pure and deterministic: same board, same picks, every time. That matters
 * because the admin preview must show the game the channel will actually get.
 */

import type { ScheduleMatchup, ScheduleWeekView } from "@/lib/league-schedule/types";

export type MatchupSlot = "headline" | "undercard";

export interface MatchupPick {
  slot: MatchupSlot;
  matchup: ScheduleMatchup;
  /** Why this one, in a sentence the admin panel can show. */
  reason: string;
}

/** Only games with two teams in them. A bye has nothing to preview. */
function playable(week: ScheduleWeekView): ScheduleMatchup[] {
  return week.matchups.filter((m) => m.away !== null);
}

/**
 * How good the two teams are, combined, as a 0 to 1 score.
 *
 * Built from Power Pulse RANK rather than raw score, because a rank is the only
 * measure that means the same thing in every league. A missing rank scores
 * mid-table rather than bottom: an unranked team is unknown, not bad.
 */
function strength(m: ScheduleMatchup, teams: number): number {
  const quality = (rank: number | null): number => {
    if (rank === null || teams <= 1) return 0.5;
    return 1 - (rank - 1) / (teams - 1);
  };
  return (quality(m.home.pulseRank) + quality(m.away?.pulseRank ?? null)) / 2;
}

/**
 * How close the game is, as a 0 to 1 score. 1 is a coin flip.
 *
 * Prefers the win probability, which already accounts for both spreads. Falls
 * back to the projected totals when the Power Pulse cache has no odds, and to
 * neutral when it has neither, so a league with no projections still gets a
 * headline game rather than none.
 */
function closeness(m: ScheduleMatchup): number {
  if (m.homeWinProb !== null) return 1 - Math.abs(m.homeWinProb - 0.5) * 2;
  const a = m.home.projectedOptimal;
  const b = m.away?.projectedOptimal ?? null;
  if (a === null || b === null) return 0.5;
  const gap = Math.abs(a - b);
  // Twenty points apart is a foregone conclusion; level is a coin flip.
  return Math.max(0, 1 - gap / 20);
}

/**
 * A stable tiebreak, so two identically-scored games do not swap places between
 * the preview the admin read and the one the channel got.
 */
function tiebreak(m: ScheduleMatchup): number {
  return m.matchupId ?? m.home.sleeperRosterId;
}

/**
 * Pick the games for one week.
 *
 * THE HEADLINE weights quality above closeness (0.65 to 0.35) on purpose. A
 * tight game between the eleventh and twelfth teams is close and means nothing;
 * a slightly lopsided game between the first and second decides a bye. Quality
 * is the thing that makes a game matter, and closeness only breaks the tie
 * among games that already do.
 *
 * THE UNDERCARD is the weakest remaining game outright, no closeness term. The
 * point is the badness.
 */
export function pickMatchups(
  week: ScheduleWeekView,
  totalRosters: number,
  want: { headline: boolean; undercard: boolean },
): MatchupPick[] {
  const games = playable(week);
  if (games.length === 0) return [];

  const scored = games.map((m) => ({
    m,
    strength: strength(m, totalRosters),
    closeness: closeness(m),
  }));

  const picks: MatchupPick[] = [];
  const taken = new Set<ScheduleMatchup>();

  if (want.headline) {
    const best = [...scored].sort(
      (x, y) =>
        y.strength * 0.65 +
        y.closeness * 0.35 -
        (x.strength * 0.65 + x.closeness * 0.35) ||
        tiebreak(x.m) - tiebreak(y.m),
    )[0];
    if (best) {
      taken.add(best.m);
      const tight = best.closeness >= 0.6;
      picks.push({
        slot: "headline",
        matchup: best.m,
        reason: tight
          ? "The best two teams still playing, and the model cannot separate them."
          : "The game with the most riding on it in the standings.",
      });
    }
  }

  if (want.undercard) {
    const worst = [...scored]
      .filter((s) => !taken.has(s.m))
      .sort((x, y) => x.strength - y.strength || tiebreak(x.m) - tiebreak(y.m))[0];
    if (worst) {
      picks.push({
        slot: "undercard",
        matchup: worst.m,
        // Stated plainly rather than dressed up. The writeup itself is where
        // the joke goes; the admin panel wants to know why this fixture.
        reason: "The weakest game on the slate, which is its own kind of appointment viewing.",
      });
    }
  }

  return picks;
}

/**
 * Order a finished week's games for the Tuesday recap run.
 *
 * One an hour, so the ORDER is the running order of the day. Most interesting
 * first: the closest final margins lead, because a two-point game is the one
 * people are still arguing about on Tuesday morning, and a hundred-point
 * beating is funny once rather than at eleven o'clock sharp.
 *
 * Deterministic, so a run interrupted at 2pm resumes on the same order at 3pm
 * rather than reshuffling and repeating a game the ledger has not yet recorded.
 */
export function orderRecaps(week: ScheduleWeekView): ScheduleMatchup[] {
  const games = playable(week).filter((m) => m.isFinal);
  return games.sort((x, y) => {
    const marginOf = (m: ScheduleMatchup): number => {
      const a = m.home.actual;
      const b = m.away?.actual ?? null;
      if (a === null || b === null) return Number.POSITIVE_INFINITY;
      return Math.abs(a - b);
    };
    return marginOf(x) - marginOf(y) || tiebreak(x) - tiebreak(y);
  });
}

/**
 * The key one recap is recorded under.
 *
 * The LOWER of the two Sleeper roster ids, never `matchup_id`. That column is
 * nullable when Sleeper leaves a roster unpaired, and a null in a dedupe key is
 * a key that stops deduplicating. The roster ids are always present and always
 * the same pair, whichever side the board happens to list first.
 */
export function recapKeyPart(m: ScheduleMatchup): number {
  const ids = [m.home.sleeperRosterId, m.away?.sleeperRosterId].filter(
    (n): n is number => typeof n === "number",
  );
  return Math.min(...ids);
}
