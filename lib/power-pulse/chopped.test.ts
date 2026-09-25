/**
 * Power Pulse over a chopped (guillotine) league.
 *
 * The rule these tests hold: a league with no bracket is never handed a
 * bracket's numbers. Sleeper publishes a full paired slate for a chopped
 * league and that pairing decides nothing, so every figure the bracket
 * simulation would have produced is null here and the survival figures carry
 * the answer instead.
 *
 * The same fixture is run both ways, chopped and not, so each assertion about
 * what a chopped league does is paired with proof that an ordinary league is
 * untouched by the change.
 */

import { describe, expect, it } from "vitest";
import { computePowerPulse, type PowerPulseInput } from "./engine";
import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import type {
  LeagueRow,
  PlayerRow,
  ProjectionRow,
  RosterRow,
} from "./load";
import type { PulsePosition, ScheduleWeek } from "./types";

const SEASON = 2026;
const CURRENT_WEEK = 5;
const TEAM_COUNT = 4;

/** Four startable slots and one bench, so every roster fills a lineup. */
const ROSTER_POSITIONS = ["QB", "RB", "WR", "TE", "BN"];

const POSITIONS: PulsePosition[] = ["QB", "RB", "WR", "TE"];

function league(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    id: "league-row-1",
    sleeperLeagueId: "sleeper-1",
    name: "Test League",
    season: SEASON,
    status: "in_season",
    rosterPositions: ROSTER_POSITIONS,
    scoringSettings: { rec: 1, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1 },
    playoffTeams: 2,
    playoffWeekStart: 15,
    playoffRoundType: 0,
    medianMatch: false,
    chopped: false,
    ...overrides,
  };
}

/** Roster n holds four players, and its scoring separates it from the others. */
function roster(n: number): RosterRow {
  return {
    id: `roster-row-${n}`,
    sleeperRosterId: n,
    playerSleeperIds: POSITIONS.map((p) => `s-${n}-${p}`),
    starterSleeperIds: POSITIONS.map((p) => `s-${n}-${p}`),
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    wins: 2,
    losses: 2,
    ties: 0,
    pointsFor: 400 + n * 10,
    teamName: `Team ${n}`,
    ownerUserId: `user-${n}`,
    ownerHandle: `manager${n}`,
    ownerAvatarId: null,
  };
}

function players(): Map<string, PlayerRow> {
  const out = new Map<string, PlayerRow>();
  for (let n = 1; n <= TEAM_COUNT; n += 1) {
    for (const position of POSITIONS) {
      const sleeperId = `s-${n}-${position}`;
      out.set(sleeperId, {
        playerId: `p-${n}-${position}`,
        sleeperId,
        name: `Player ${n} ${position}`,
        position,
        team: "BUF",
        injuryStatus: null,
        depthOrder: 1,
      });
    }
  }
  return out;
}

/**
 * Every player projected for every remaining week, with a per-team step so the
 * four teams do not tie on everything and leave the ranks arbitrary.
 */
function projections(throughWeek: number): ProjectionRow[] {
  const out: ProjectionRow[] = [];
  for (let n = 1; n <= TEAM_COUNT; n += 1) {
    for (const position of POSITIONS) {
      for (let week = CURRENT_WEEK; week <= throughWeek; week += 1) {
        const points = 10 + n * 2;
        out.push({
          playerId: `p-${n}-${position}`,
          week,
          opponent: "MIA",
          statLine: null,
          ppr: points,
          halfPpr: points,
          std: points,
          availability: "projected",
          injuryStatus: null,
        });
      }
    }
  }
  return out;
}

/** Sleeper pairs a chopped league exactly as it pairs any other one. */
function schedule(throughWeek: number): ScheduleWeek[] {
  const weeks: ScheduleWeek[] = [];
  for (let week = CURRENT_WEEK; week <= throughWeek; week += 1) {
    weeks.push({
      week,
      isFinal: false,
      opponents: new Map([
        [1, 2],
        [2, 1],
        [3, 4],
        [4, 3],
      ]),
    });
  }
  return weeks;
}

function input(overrides: Partial<PowerPulseInput> = {}): PowerPulseInput {
  const throughWeek = 14;
  return {
    league: league(),
    rosters: [1, 2, 3, 4].map(roster),
    players: players(),
    projections: projections(throughWeek),
    accuracy: new Map(),
    defense: new Map(),
    defenseSeasons: [SEASON],
    schedule: schedule(throughWeek),
    setLineups: new Map(),
    results: new Map(),
    currentWeek: CURRENT_WEEK,
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    ...overrides,
  };
}

describe("computePowerPulse over a chopped league", () => {
  it("scores an ordinary league with its bracket figures, unchanged", () => {
    const teams = computePowerPulse(input());

    expect(teams).toHaveLength(TEAM_COUNT);
    for (const team of teams) {
      expect(team.chopped).toBe(false);
      expect(team.playoffOdds).not.toBeNull();
      expect(team.titleOdds).not.toBeNull();
      expect(team.projectedWins).not.toBeNull();
      expect(team.scoreSchedule).not.toBeNull();
      expect(team.sosPoints).not.toBeNull();
      // And none of the survival figures, which its league does not have.
      expect(team.chopOddsThisWeek).toBeNull();
      expect(team.surviveAllOdds).toBeNull();
      expect(team.expectedWeeksAlive).toBeNull();
    }
  });

  it("gives a chopped league survival figures and no bracket figures at all", () => {
    const teams = computePowerPulse(
      input({ league: league({ chopped: true }) }),
    );

    expect(teams).toHaveLength(TEAM_COUNT);
    for (const team of teams) {
      expect(team.chopped).toBe(true);
      expect(team.playoffOdds).toBeNull();
      expect(team.byeOdds).toBeNull();
      expect(team.titleOdds).toBeNull();
      expect(team.lastPlaceOdds).toBeNull();
      expect(team.expectedWins).toBeNull();
      expect(team.projectedWins).toBeNull();
      expect(team.projectedLosses).toBeNull();
      expect(team.projectedTies).toBeNull();
      // No opponent means no schedule to be strong or weak in.
      expect(team.scoreSchedule).toBeNull();
      expect(team.scoreScheduleRank).toBeNull();
      expect(team.sosPoints).toBeNull();
      expect(team.sosRank).toBeNull();

      expect(team.chopOddsThisWeek).not.toBeNull();
      expect(team.surviveAllOdds).not.toBeNull();
      expect(team.expectedWeeksAlive).not.toBeNull();
    }

    // Somebody goes out every week and somebody is last standing, so both sets
    // of odds have to add up over the league rather than merely being present.
    const chopSum = teams.reduce((a, t) => a + (t.chopOddsThisWeek ?? 0), 0);
    const winSum = teams.reduce((a, t) => a + (t.surviveAllOdds ?? 0), 0);
    expect(chopSum).toBeCloseTo(1, 2);
    expect(winSum).toBeCloseTo(1, 2);
  });

  it("carries no opponent and no win probability into a chopped preview week", () => {
    const [team] = computePowerPulse(
      input({ league: league({ chopped: true }) }),
    );

    expect(team.weekly.length).toBeGreaterThan(0);
    for (const week of team.weekly) {
      expect(week.opponentRosterId).toBeNull();
      expect(week.opponentName).toBeNull();
      expect(week.winProb).toBeNull();
      // The projection itself is real and stays.
      expect(week.mean).toBeGreaterThan(0);
    }
  });

  it("scores only the teams still in the league", () => {
    const teams = computePowerPulse(
      input({
        league: league({ chopped: true }),
        aliveRosterIds: [1, 2, 3],
      }),
    );

    expect(teams.map((t) => t.sleeperRosterId).sort()).toEqual([1, 2, 3]);
    // The chopped team is not ranked last, it is not ranked, and the odds of
    // the three still playing add up without it.
    const chopSum = teams.reduce((a, t) => a + (t.chopOddsThisWeek ?? 0), 0);
    expect(chopSum).toBeCloseTo(1, 2);
  });

  it("treats an empty alive list as 'we do not know' and scores everyone", () => {
    const teams = computePowerPulse(
      input({ league: league({ chopped: true }), aliveRosterIds: [] }),
    );
    expect(teams).toHaveLength(TEAM_COUNT);
  });

  it("weights a chopped league's score without the schedule component", () => {
    // The schedule component is 25% of an ordinary score and is absent here,
    // so the other three carry the whole thing. The visible consequence is
    // that a team's rank follows its scoring rank, which the fixture separates
    // cleanly: roster 4 projects the most points, roster 1 the fewest.
    const teams = computePowerPulse(
      input({ league: league({ chopped: true }) }),
    );
    const byRank = [...teams].sort(
      (a, b) => (a.pulseRank ?? 99) - (b.pulseRank ?? 99),
    );
    expect(byRank[0].sleeperRosterId).toBe(4);
    expect(byRank[byRank.length - 1].sleeperRosterId).toBe(1);
  });

  it("projects a chopped league past the playoff week start, to the last chop", () => {
    // An ordinary league stops at playoffWeekStart - 1 (week 14). A chopped
    // league has no bracket and keeps chopping, so with four teams left from
    // week 5 the last chop lands in week 7 and the weeks it previews are its
    // own, not the bracket's.
    const chopped = computePowerPulse(
      input({ league: league({ chopped: true }) }),
    );
    const ordinary = computePowerPulse(input());

    expect(chopped[0].weekly.map((w) => w.week)).toEqual([5, 6, 7]);
    expect(ordinary[0].weekly.at(-1)?.week).toBe(14);
  });

  it("finishes sooner in a league that chops two a week", () => {
    // Four teams from week 5, two out a week: weeks 5 and 6 leave one.
    const twoAWeek = computePowerPulse(
      input({ league: league({ chopped: true, choppedPerWeek: 2 }) }),
    );
    expect(twoAWeek[0].weekly.map((w) => w.week)).toEqual([5, 6]);
    // With half the field going each week, the chance of going out this week
    // across the four teams sums to two chops, not one (each figure is
    // stored to four places, hence the tolerance).
    const total = twoAWeek.reduce((sum, t) => sum + (t.chopOddsThisWeek ?? 0), 0);
    expect(total).toBeCloseTo(2, 3);
  });
});
