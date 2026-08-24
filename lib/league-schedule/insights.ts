/**
 * The schedule quick stats: strength of schedule, luck, spotlights, stretches,
 * and who plays whom twice.
 *
 * Pure, and deliberately thin. The remaining strength of schedule is NOT
 * recomputed here: it is read straight off the Power Pulse cache through
 * ScheduleTeam. Two implementations of the same statistic on two pages of the
 * same league is a bug waiting for someone to notice the numbers disagree, and
 * the one on the Power Pulse page is the one the ranking itself is built from.
 *
 * What is computed here is the part the cache does not carry, because Power
 * Pulse only looks forward: how hard the schedule has been so far, and how much
 * of a team's record is the schedule rather than the roster.
 */

import { mean, rankDescending } from "@/lib/power-pulse/math";
import type {
  HeadToHeadCount,
  LuckRow,
  ScheduleMatchup,
  ScheduleMatchupSide,
  ScheduleStretch,
  ScheduleTeam,
  SosRow,
  WeekSpotlight,
} from "./types";

/** One week as the insight functions read it. */
export type InsightWeek = {
  week: number;
  isFinal: boolean;
  matchups: ScheduleMatchup[];
};

/** Standard competition ranking with a floor, so a row always has a number. */
function rankOrLast<T>(values: (number | null)[], items: T[]): number[] {
  const ranks = rankDescending(values);
  return ranks.map((rank) => rank ?? items.length);
}

/** This roster's side of a matchup, and its opponent's, or null when unpaired. */
function sidesFor(
  matchups: ScheduleMatchup[],
  rosterId: number,
): { own: ScheduleMatchupSide; opponent: ScheduleMatchupSide } | null {
  for (const matchup of matchups) {
    if (matchup.home.sleeperRosterId === rosterId) {
      return matchup.away ? { own: matchup.home, opponent: matchup.away } : null;
    }
    if (matchup.away && matchup.away.sleeperRosterId === rosterId) {
      return { own: matchup.away, opponent: matchup.home };
    }
  }
  return null;
}

/**
 * Strength of schedule, both directions.
 *
 * Remaining comes from the Power Pulse cache untouched. Played is the average
 * score of the opponents already faced, which answers "who has had it easy",
 * and it uses actual points rather than projections because those weeks are
 * settled and a projection for them would be a worse number about a known one.
 *
 * Rank 1 is the HARDEST in both columns. Every consumer has to say so, because
 * "SOS rank 1" means the opposite thing on half the internet.
 */
export function buildSosRows(teams: ScheduleTeam[], weeks: InsightWeek[]): SosRow[] {
  const finalWeeks = weeks.filter((w) => w.isFinal);

  const played = teams.map((team) => {
    const opponentScores: number[] = [];
    for (const week of finalWeeks) {
      const pair = sidesFor(week.matchups, team.sleeperRosterId);
      if (!pair || pair.opponent.actual === null) continue;
      opponentScores.push(pair.opponent.actual);
    }
    return opponentScores.length > 0 ? mean(opponentScores) : null;
  });

  const playedRanks = rankDescending(played);

  return teams.map((team, i) => ({
    sleeperRosterId: team.sleeperRosterId,
    teamName: team.teamName,
    ownerHandle: team.ownerHandle,
    remainingPoints: team.sosPoints,
    remainingRank: team.sosRank,
    playedPoints: played[i],
    playedRank: playedRanks[i],
  }));
}

/**
 * The luck index: real record against the record a team would hold if it played
 * every other team every week.
 *
 * This is the stat league members argue about, and it is the one Sleeper does
 * not show. A 4-2 team with the eighth best score total did not earn that
 * record, and the all-play record is the evidence.
 *
 * A tie counts half a win and half a loss on both sides of the comparison, so a
 * week where two teams post the same score does not hand either an advantage.
 */
export function buildLuckRows(teams: ScheduleTeam[], weeks: InsightWeek[]): LuckRow[] {
  const finalWeeks = weeks.filter((w) => w.isFinal);
  if (finalWeeks.length === 0) return [];

  const allPlayWins = new Map<number, number>();
  const allPlayLosses = new Map<number, number>();
  for (const team of teams) {
    allPlayWins.set(team.sleeperRosterId, 0);
    allPlayLosses.set(team.sleeperRosterId, 0);
  }

  for (const week of finalWeeks) {
    const scores: { rosterId: number; points: number }[] = [];
    for (const matchup of week.matchups) {
      for (const side of [matchup.home, matchup.away]) {
        if (!side || side.actual === null) continue;
        scores.push({ rosterId: side.sleeperRosterId, points: side.actual });
      }
    }
    for (const a of scores) {
      if (!allPlayWins.has(a.rosterId)) continue;
      for (const b of scores) {
        if (a.rosterId === b.rosterId) continue;
        if (a.points > b.points) {
          allPlayWins.set(a.rosterId, (allPlayWins.get(a.rosterId) ?? 0) + 1);
        } else if (a.points < b.points) {
          allPlayLosses.set(a.rosterId, (allPlayLosses.get(a.rosterId) ?? 0) + 1);
        } else {
          allPlayWins.set(a.rosterId, (allPlayWins.get(a.rosterId) ?? 0) + 0.5);
          allPlayLosses.set(a.rosterId, (allPlayLosses.get(a.rosterId) ?? 0) + 0.5);
        }
      }
    }
  }

  const luck = teams.map((team) => {
    const games = team.record.wins + team.record.losses + team.record.ties;
    const realRate = games > 0 ? (team.record.wins + team.record.ties * 0.5) / games : 0;
    const wins = allPlayWins.get(team.sleeperRosterId) ?? 0;
    const losses = allPlayLosses.get(team.sleeperRosterId) ?? 0;
    const allPlayRate = wins + losses > 0 ? wins / (wins + losses) : 0;
    return realRate - allPlayRate;
  });

  const luckRanks = rankOrLast(luck, teams);
  const pointsRanks = rankOrLast(
    teams.map((team) => team.pointsFor),
    teams,
  );

  return teams.map((team, i) => ({
    sleeperRosterId: team.sleeperRosterId,
    teamName: team.teamName,
    ownerHandle: team.ownerHandle,
    record: team.record,
    allPlayWins: allPlayWins.get(team.sleeperRosterId) ?? 0,
    allPlayLosses: allPlayLosses.get(team.sleeperRosterId) ?? 0,
    luck: luck[i],
    luckRank: luckRanks[i],
    pointsRank: pointsRanks[i],
  }));
}

/**
 * The closest game and the biggest mismatch in one week, by win probability.
 * Both come back null when the week has no matchup carrying one, which is a
 * league with no Power Pulse cache rather than a week where every game is even.
 */
export function weekSpotlight(week: InsightWeek): WeekSpotlight {
  let closest: ScheduleMatchup | null = null;
  let closestDistance = Infinity;
  let mismatch: ScheduleMatchup | null = null;
  let mismatchDistance = -Infinity;

  for (const matchup of week.matchups) {
    if (matchup.homeWinProb === null) continue;
    const distance = Math.abs(matchup.homeWinProb - 0.5);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = matchup;
    }
    if (distance > mismatchDistance) {
      mismatchDistance = distance;
      mismatch = matchup;
    }
  }

  return { week: week.week, closest, mismatch };
}

/** One run of consecutive remaining weeks, with the opponent projection average. */
type StretchCandidate = { startWeek: number; endWeek: number; opponentPoints: number };

/**
 * Every window of `size` consecutive REMAINING weeks, scored by the average
 * opponent projection.
 *
 * Consecutive means consecutive among the weeks that are left, not consecutive
 * by number: a team on a bye in week 9 is still facing weeks 8 and 10 back to
 * back as far as its season is concerned.
 *
 * A window only counts when every week in it has an opponent projection.
 * Averaging two weeks and calling it three would make an easy stretch with one
 * unknown look harder or softer than a fully known one, and the two would then
 * be compared against each other.
 */
function stretchCandidates(
  rosterId: number,
  weeks: InsightWeek[],
  size: number,
): StretchCandidate[] {
  if (size < 1) return [];
  const remaining = weeks.filter((w) => !w.isFinal);

  const entries = remaining.map((week) => {
    const pair = sidesFor(week.matchups, rosterId);
    return { week: week.week, opponentPoints: pair?.opponent.projectedOptimal ?? null };
  });

  const out: StretchCandidate[] = [];
  for (let i = 0; i + size <= entries.length; i += 1) {
    const window = entries.slice(i, i + size);
    if (window.some((entry) => entry.opponentPoints === null)) continue;
    out.push({
      startWeek: window[0].week,
      endWeek: window[window.length - 1].week,
      opponentPoints: mean(window.map((entry) => entry.opponentPoints as number)),
    });
  }
  return out;
}

/** The hardest run left on a team's schedule. Null when nothing qualifies. */
export function toughestStretch(
  rosterId: number,
  weeks: InsightWeek[],
  size = 3,
): ScheduleStretch | null {
  const candidates = stretchCandidates(rosterId, weeks, size);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.opponentPoints > best.opponentPoints ? c : best));
}

/** The softest run left on a team's schedule. Null when nothing qualifies. */
export function easiestStretch(
  rosterId: number,
  weeks: InsightWeek[],
  size = 3,
): ScheduleStretch | null {
  const candidates = stretchCandidates(rosterId, weeks, size);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.opponentPoints < best.opponentPoints ? c : best));
}

/**
 * Who this team plays more than once, and in which weeks. Sleeper's own UI does
 * not surface this anywhere, and it decides every tiebreak argument a league
 * has in December.
 */
export function headToHeadCounts(
  rosterId: number,
  weeks: InsightWeek[],
  teams: ScheduleTeam[],
): HeadToHeadCount[] {
  const namesById = new Map(teams.map((team) => [team.sleeperRosterId, team.teamName]));
  const meetings = new Map<number, number[]>();

  for (const week of weeks) {
    const pair = sidesFor(week.matchups, rosterId);
    if (!pair) continue;
    const opponentId = pair.opponent.sleeperRosterId;
    const list = meetings.get(opponentId) ?? [];
    list.push(week.week);
    meetings.set(opponentId, list);
  }

  const out: HeadToHeadCount[] = [];
  for (const [opponentRosterId, list] of meetings) {
    if (list.length < 2) continue;
    out.push({
      sleeperRosterId: rosterId,
      opponentRosterId,
      opponentName: namesById.get(opponentRosterId) ?? `Team ${opponentRosterId}`,
      meetings: [...list].sort((a, b) => a - b),
    });
  }

  out.sort((a, b) => {
    const byCount = b.meetings.length - a.meetings.length;
    if (byCount !== 0) return byCount;
    return a.opponentName.localeCompare(b.opponentName);
  });
  return out;
}
