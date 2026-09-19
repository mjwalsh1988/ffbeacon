/**
 * The invented six-team league behind the playoff guide's luck figure.
 *
 * EVERY SCORE HERE IS MADE UP, and the figure's caption says so. What is not
 * made up is the arithmetic: the all-play records and the luck figure come from
 * buildLuckRows in lib/league-schedule/insights.ts, the function the Schedules
 * page runs for its Luck index panel, so the guide cannot describe the panel
 * one way while the panel does it another.
 *
 * The league is a single round robin: six teams, five weeks, everyone plays
 * everyone once. Team A and Team B score exactly the same total. Team A draws
 * its opponents on their quiet weeks and goes 4-1; Team B draws them on their
 * best weeks and goes 1-4.
 */

import { buildLuckRows, type InsightWeek } from "@/lib/league-schedule/insights";
import type { LuckRow, ScheduleMatchup, ScheduleTeam } from "@/lib/league-schedule/types";

export const LUCK_TEAM_NAMES = [
  "Team A",
  "Team B",
  "Team C",
  "Team D",
  "Team E",
  "Team F",
] as const;

/** SCORES[week][team]. Invented. */
export const LUCK_SCORES: number[][] = [
  [98, 121, 110, 100, 124, 92],
  [104, 99, 96, 115, 97, 108],
  [101, 112, 99, 95, 105, 118],
  [118, 106, 125, 111, 100, 113],
  [119, 102, 109, 104, 112, 97],
];

/** PAIRINGS[week] lists [teamIndex, teamIndex] games. A circle-method round robin. */
export const LUCK_PAIRINGS: [number, number][][] = [
  [
    [0, 5],
    [1, 4],
    [2, 3],
  ],
  [
    [0, 4],
    [5, 3],
    [1, 2],
  ],
  [
    [0, 3],
    [4, 2],
    [5, 1],
  ],
  [
    [0, 2],
    [3, 1],
    [4, 5],
  ],
  [
    [0, 1],
    [2, 5],
    [3, 4],
  ],
];

export type LuckExampleRow = LuckRow & {
  name: string;
  pointsFor: number;
  /** The team's head-to-head result each week, for the figure's week strip. */
  weeks: { week: number; score: number; opponent: string; opponentScore: number; won: boolean }[];
};

function side(team: number, score: number): ScheduleMatchup["home"] {
  return {
    sleeperRosterId: team + 1,
    teamName: LUCK_TEAM_NAMES[team],
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pulseRank: null,
    actual: score,
    projectedOptimal: null,
    sigma: null,
    pointsLeftOnBench: null,
    won: false,
  };
}

/** The six teams, with records derived from the pairings and luck from buildLuckRows. */
export function buildLuckExample(): LuckExampleRow[] {
  const n = LUCK_TEAM_NAMES.length;
  const records = Array.from({ length: n }, () => ({ wins: 0, losses: 0, ties: 0 }));
  const pointsFor = Array.from({ length: n }, () => 0);
  const perTeamWeeks: LuckExampleRow["weeks"][] = Array.from({ length: n }, () => []);

  const weeks: InsightWeek[] = LUCK_PAIRINGS.map((games, w) => {
    const scores = LUCK_SCORES[w];
    const matchups: ScheduleMatchup[] = games.map(([a, b], i) => {
      pointsFor[a] += scores[a];
      pointsFor[b] += scores[b];
      if (scores[a] > scores[b]) {
        records[a].wins++;
        records[b].losses++;
      } else if (scores[a] < scores[b]) {
        records[b].wins++;
        records[a].losses++;
      } else {
        records[a].ties++;
        records[b].ties++;
      }
      perTeamWeeks[a].push({
        week: w + 1,
        score: scores[a],
        opponent: LUCK_TEAM_NAMES[b],
        opponentScore: scores[b],
        won: scores[a] > scores[b],
      });
      perTeamWeeks[b].push({
        week: w + 1,
        score: scores[b],
        opponent: LUCK_TEAM_NAMES[a],
        opponentScore: scores[a],
        won: scores[b] > scores[a],
      });
      return {
        matchupId: i + 1,
        week: w + 1,
        isFinal: true,
        home: side(a, scores[a]),
        away: side(b, scores[b]),
        homeWinProb: null,
      };
    });
    return { week: w + 1, isFinal: true, matchups };
  });

  const teams: ScheduleTeam[] = LUCK_TEAM_NAMES.map((name, t) => ({
    sleeperRosterId: t + 1,
    rosterRowId: `example-${t + 1}`,
    teamName: name,
    ownerHandle: null,
    ownerUserId: null,
    coOwnerIds: [],
    ownerAvatarId: null,
    record: records[t],
    pointsFor: pointsFor[t],
    pulseRank: null,
    sosPoints: null,
    sosRank: null,
  }));

  return buildLuckRows(teams, weeks).map((row, t) => ({
    ...row,
    name: LUCK_TEAM_NAMES[t],
    pointsFor: pointsFor[t],
    weeks: perTeamWeeks[t].sort((x, y) => x.week - y.week),
  }));
}
