import { describe, expect, it } from "vitest";
import { buildLeaderboards, type LeaderboardInput, type SettledRosterWeek, type WeekStatLine } from "./build";
import type { LeaderboardPlayer, LeaderboardPosition } from "./types";

const SCORING = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };

function player(sleeperId: string, position: LeaderboardPosition, name = `Player ${sleeperId}`): LeaderboardPlayer {
  return { sleeperId, name, slug: `p-${sleeperId}`, position, nflTeam: "KC" };
}

function rosterWeek(
  week: number,
  rosterId: number,
  points: Record<string, number>,
  started: string[],
  opponentRosterId: number | null = null,
  official?: number,
): SettledRosterWeek {
  return {
    week,
    sleeperRosterId: rosterId,
    officialPoints: official ?? started.reduce((sum, id) => sum + (points[id] ?? 0), 0),
    playerPoints: new Map(Object.entries(points)),
    startedIds: new Set(started),
    opponentRosterId,
  };
}

function input(over: Partial<LeaderboardInput> = {}): LeaderboardInput {
  const players = new Map(
    [player("1", "RB", "Alpha Back"), player("2", "WR", "Bravo Wideout"), player("3", "RB", "Charlie Back"), player("4", "WR", "Delta Wideout")].map(
      (p) => [p.sleeperId, p],
    ),
  );
  return {
    season: 2026,
    weeks: [
      // Week 1: player 1 on team 10 (started), player 2 on team 20 (started).
      rosterWeek(1, 10, { "1": 20 }, ["1"], 20),
      rosterWeek(1, 20, { "2": 15 }, ["2"], 10),
      // Week 2: player 1 traded to team 20, player 2 dropped (free agent).
      rosterWeek(2, 10, { "3": 5 }, ["3"], 20),
      rosterWeek(2, 20, { "1": 30 }, ["1"], 10),
    ],
    statLines: new Map<number, WeekStatLine[]>([
      [1, [
        { sleeperId: "1", stats: { rush_yd: 200 } },
        { sleeperId: "2", stats: { rec: 5, rec_yd: 100 } },
        { sleeperId: "4", stats: { rec: 2, rec_yd: 30 } },
      ]],
      [2, [
        { sleeperId: "1", stats: { rush_yd: 300 } },
        { sleeperId: "2", stats: { rec: 8, rec_yd: 120 } },
        { sleeperId: "3", stats: { rush_yd: 50 } },
      ]],
    ]),
    players,
    teams: [
      { sleeperRosterId: 10, teamName: "Tens", ownerHandle: "ten", avatarId: null },
      { sleeperRosterId: 20, teamName: "Twenties", ownerHandle: "twenty", avatarId: null },
    ],
    currentRosters: new Map([["1", 20], ["3", 10]]),
    scoring: SCORING,
    positions: ["RB", "WR"],
    dedicatedSlots: { RB: 1, WR: 1 },
    playoffWeekStart: 2,
    bestBall: false,
    week: null,
    ...over,
  };
}

describe("buildLeaderboards", () => {
  it("puts every player who played on the board, free agents included", () => {
    const view = buildLeaderboards(input());
    const names = view.boards.all.map((l) => l.player.name);
    expect(names).toEqual(["Alpha Back", "Bravo Wideout", "Charlie Back", "Delta Wideout"]);
  });

  it("uses Sleeper's credited points for rostered weeks and scores free agent weeks from the stat line", () => {
    const view = buildLeaderboards(input());
    const bravo = view.boards.all.find((l) => l.player.sleeperId === "2")!;
    // Week 1 rostered: 15 as credited. Week 2 free agent: 8 + 12 = 20 from the line.
    expect(bravo.points).toBe(35);
    expect(bravo.games).toBe(2);
    const delta = view.boards.all.find((l) => l.player.sleeperId === "4")!;
    expect(delta.points).toBe(5);
    expect(delta.currentRosterId).toBeNull();
  });

  it("records who held a player each week, across a trade and a drop", () => {
    const view = buildLeaderboards(input());
    const alpha = view.boards.all.find((l) => l.player.sleeperId === "1")!;
    expect(alpha.ownership).toEqual([
      { week: 1, rosterId: 10, points: 20 },
      { week: 2, rosterId: 20, points: 30 },
    ]);
    expect(alpha.currentRosterId).toBe(20);
    const bravo = view.boards.all.find((l) => l.player.sleeperId === "2")!;
    expect(bravo.ownership.map((w) => w.rosterId)).toEqual([20, null]);
  });

  it("ranks ties together and reports the gap to the row above", () => {
    const view = buildLeaderboards(input());
    expect(view.boards.all[0].gapAbove).toBeNull();
    expect(view.boards.all[1].gapAbove).toBe(15);
    // Charlie (5, rostered) and Delta (5, free agent) are tied, so both are 3rd.
    expect(view.boards.all.map((l) => l.rank)).toEqual([1, 2, 3, 3]);
    expect(view.boards.all[3].gapAbove).toBe(0);
  });

  it("lists the best players nobody holds today", () => {
    const view = buildLeaderboards(input());
    expect(view.unowned.map((l) => l.player.sleeperId)).toEqual(["2", "4"]);
  });

  it("labels the owner at the time on single-week games and marks playoff weeks", () => {
    const view = buildLeaderboards(input());
    const top = view.bestWeeks[0];
    expect(top.player.sleeperId).toBe("1");
    expect(top.week).toBe(2);
    expect(top.rosterId).toBe(20);
    expect(top.playoff).toBe(true);
    const freeAgentGame = view.bestWeeks.find((w) => w.player.sleeperId === "2" && w.week === 2)!;
    expect(freeAgentGame.rosterId).toBeNull();
  });

  it("marks no playoff week in a league with no bracket", () => {
    const view = buildLeaderboards(input({ playoffWeekStart: null }));
    expect(view.bestWeeks.every((w) => !w.playoff)).toBe(true);
    expect(view.teamHighs.every((s) => !s.playoff)).toBe(true);
  });

  it("finds bench games, and leaves them out of a best ball league", () => {
    const weeks = [
      rosterWeek(1, 10, { "1": 20, "3": 18 }, ["1"], 20),
      rosterWeek(1, 20, { "2": 15 }, ["2"], 10),
    ];
    const view = buildLeaderboards(input({ weeks, statLines: new Map([[1, []]]) }));
    expect(view.benchHeroes.map((w) => w.player.sleeperId)).toEqual(["3"]);
    const bestBall = buildLeaderboards(input({ weeks, statLines: new Map([[1, []]]), bestBall: true }));
    expect(bestBall.showsBench).toBe(false);
    expect(bestBall.benchHeroes).toEqual([]);
  });

  it("leaves injured reserve and taxi players out of the bench list", () => {
    const week = rosterWeek(1, 10, { "1": 20, "3": 18 }, ["1"], 20);
    week.ineligibleIds = new Set(["3"]);
    const view = buildLeaderboards(input({ weeks: [week, rosterWeek(1, 20, { "2": 15 }, ["2"], 10)], statLines: new Map([[1, []]]) }));
    expect(view.benchHeroes).toEqual([]);
    // He still counts on the points board.
    expect(view.boards.all.find((l) => l.player.sleeperId === "3")!.points).toBe(18);
  });

  it("counts the top X at each position as teams times dedicated slots, on today's rosters", () => {
    const view = buildLeaderboards(input());
    // Two teams, one RB slot: the top 2 RBs are Alpha (team 20) and Charlie (team 10).
    const rb = view.topTier.cutoffs.find((c) => c.position === "RB")!;
    expect(rb.cutoff).toBe(2);
    // Top 2 WRs: Bravo and Delta, both free agents today.
    const wr = view.topTier.cutoffs.find((c) => c.position === "WR")!;
    expect(wr.unowned).toBe(2);
    const byTeam = Object.fromEntries(view.topTier.rows.map((r) => [r.rosterId, r.total]));
    expect(byTeam).toEqual({ 10: 1, 20: 1 });
  });

  it("draws the cut line over teams still holding a roster, as in a chopped league", () => {
    // Team 10 has been eliminated and holds nobody; only team 20 is left.
    const view = buildLeaderboards(input({ currentRosters: new Map([["1", 20]]) }));
    expect(view.topTier.cutoffs.find((c) => c.position === "RB")!.cutoff).toBe(1);
  });

  it("pairs each game once and sorts margins", () => {
    const view = buildLeaderboards(input());
    expect(view.games.closest).toHaveLength(2);
    const week2 = view.games.blowouts.find((g) => g.week === 2)!;
    expect(week2.homeId).toBe(10);
    expect(week2.awayId).toBe(20);
    expect(week2.margin).toBe(25);
    expect(week2.winnerId).toBe(20);
  });

  it("does not call a roster that started nobody the week's low score", () => {
    const weeks = [
      rosterWeek(1, 10, { "1": 20 }, ["1"]),
      rosterWeek(1, 20, {}, []),
    ];
    const view = buildLeaderboards(input({ weeks }));
    expect(view.teamLows.map((s) => s.rosterId)).toEqual([10]);
  });

  it("narrows everything to one week, and falls back to the season for a week that has not settled", () => {
    const week1 = buildLeaderboards(input({ week: 1 }));
    expect(week1.week).toBe(1);
    expect(week1.boards.all[0].player.sleeperId).toBe("1");
    expect(week1.boards.all[0].points).toBe(20);
    expect(week1.weeklyHighs).toEqual([]);
    const unsettled = buildLeaderboards(input({ week: 9 }));
    expect(unsettled.week).toBeNull();
    expect(unsettled.settledWeeks).toEqual([1, 2]);
  });

  it("leaves free agent weeks out when the league's scoring cannot be read", () => {
    const view = buildLeaderboards(input({ scoring: {} }));
    expect(view.scoresFreeAgents).toBe(false);
    expect(view.boards.all.find((l) => l.player.sleeperId === "4")).toBeUndefined();
    // Rostered weeks still count on Sleeper's own figures.
    expect(view.boards.all.find((l) => l.player.sleeperId === "1")!.points).toBe(50);
  });

  it("keeps players at positions the league does not start off the board", () => {
    const view = buildLeaderboards(input({ positions: ["RB"] }));
    expect(view.boards.all.every((l) => l.player.position === "RB")).toBe(true);
    expect(view.boards.WR).toBeUndefined();
  });

  it("counts weekly high scores, with ties crediting everyone tied", () => {
    const weeks = [
      rosterWeek(1, 10, { "1": 20 }, ["1"], 20),
      rosterWeek(1, 20, { "2": 20 }, ["2"], 10),
      rosterWeek(2, 10, { "1": 30 }, ["1"], 20),
      rosterWeek(2, 20, { "2": 10 }, ["2"], 10),
    ];
    const view = buildLeaderboards(input({ weeks }));
    expect(view.weeklyHighs).toEqual([
      { rosterId: 10, value: 2, rank: 1 },
      { rosterId: 20, value: 1, rank: 2 },
    ]);
  });
});
