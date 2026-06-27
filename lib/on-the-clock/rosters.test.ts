import { describe, it, expect } from "vitest";
import { buildTeamRollups, type TeamRollupInput } from "./rosters";
import type { RankedPlayer } from "./board-types";
import type { ShapedPick, ShapedRoster } from "./types";

function player(over: Partial<RankedPlayer> & { playerId: string; value: number }): RankedPlayer {
  return {
    playerId: over.playerId,
    sleeperId: over.sleeperId ?? `s-${over.playerId}`,
    name: over.name ?? over.playerId,
    position: over.position ?? "WR",
    team: over.team ?? null,
    overallRank: over.overallRank ?? 1,
    positionRank: over.positionRank ?? 1,
    tier: over.tier ?? 1,
    value: over.value,
    isRookie: over.isRookie ?? false,
  };
}

function pick(over: Partial<ShapedPick> & { pickNo: number; rosterId: number }): ShapedPick {
  return {
    pickNo: over.pickNo,
    round: over.round ?? 1,
    draftSlot: over.draftSlot ?? over.rosterId,
    rosterId: over.rosterId,
    pickedBy: over.pickedBy ?? `u${over.rosterId}`,
    sleeperPlayerId: over.sleeperPlayerId ?? null,
    playerId: over.playerId ?? null,
    isKeeper: over.isKeeper ?? false,
    firstName: over.firstName ?? "First",
    lastName: over.lastName ?? `L${over.pickNo}`,
    position: over.position ?? "WR",
    team: over.team ?? null,
  };
}

const ROSTERS: ShapedRoster[] = [
  { rosterId: 1, ownerId: "u1", coOwners: [], players: [] },
  { rosterId: 2, ownerId: "u2", coOwners: [], players: [] },
];

const BOARD: RankedPlayer[] = [
  player({ playerId: "p1", value: 9000, position: "QB", overallRank: 1 }),
  player({ playerId: "p2", value: 7000, position: "RB", overallRank: 2 }),
  player({ playerId: "p3", value: 5000, position: "WR", overallRank: 3 }),
  player({ playerId: "p4", value: 3000, position: "TE", overallRank: 4 }),
];

function baseInput(over: Partial<TeamRollupInput> = {}): TeamRollupInput {
  return {
    rosters: ROSTERS,
    picks: [],
    tradedPicks: [],
    valueBoard: BOARD,
    teamNameByRosterId: { 1: "Alpha", 2: "Bravo" },
    myRosterId: 1,
    draftSettings: { teams: 2 },
    draftSeason: 2026,
    ...over,
  };
}

describe("buildTeamRollups", () => {
  it("groups drafted players by position and values them from the board", () => {
    const rollups = buildTeamRollups(
      baseInput({
        picks: [
          pick({ pickNo: 1, rosterId: 1, playerId: "p1", position: "QB" }),
          pick({ pickNo: 2, rosterId: 1, playerId: "p3", position: "WR" }),
        ],
        // No future picks so the test isolates player value.
        futureSeasonCount: 0,
      }),
    );
    const alpha = rollups.find((r) => r.rosterId === 1)!;
    expect(alpha.players.QB.map((p) => p.playerId)).toEqual(["p1"]);
    expect(alpha.players.WR.map((p) => p.playerId)).toEqual(["p3"]);
    expect(alpha.positionTotals.QB).toBe(9000);
    expect(alpha.playersValue).toBe(14000);
    expect(alpha.playerCount).toBe(2);
  });

  it("ranks teams by total value desc and flags the connected team", () => {
    const rollups = buildTeamRollups(
      baseInput({
        picks: [
          pick({ pickNo: 1, rosterId: 2, playerId: "p1", position: "QB" }), // 9000 -> Bravo
          pick({ pickNo: 2, rosterId: 1, playerId: "p4", position: "TE" }), // 3000 -> Alpha
        ],
        futureSeasonCount: 0,
      }),
    );
    expect(rollups.map((r) => r.teamName)).toEqual(["Bravo", "Alpha"]);
    expect(rollups[0].rank).toBe(1);
    expect(rollups[1].rank).toBe(2);
    expect(rollups.find((r) => r.isYou)?.teamName).toBe("Alpha");
  });

  it("gives every team a baseline of future picks (futures only) and counts them", () => {
    const rollups = buildTeamRollups(
      baseInput({ futureSeasonCount: 2, futureRounds: 3 }),
    );
    const alpha = rollups.find((r) => r.rosterId === 1)!;
    // 2 seasons x 3 rounds = 6 future picks, all owned by the team itself.
    expect(alpha.futurePicks).toHaveLength(6);
    expect(alpha.futurePicks.every((p) => p.isOwn)).toBe(true);
    // Only future seasons (draftSeason + 1 and beyond); none in the draft season.
    expect(alpha.futurePicks.every((p) => p.season > 2026)).toBe(true);
    expect(alpha.futurePicksValue).toBeGreaterThan(0);
  });

  it("surfaces the owner @username, suppressing it when it echoes the team name", () => {
    const rollups = buildTeamRollups(
      baseInput({
        futureSeasonCount: 0,
        teamNameByRosterId: { 1: "Team Rocket", 2: "Bravo" },
        ownerUsernameByRosterId: { 1: "ash", 2: "bravo" },
      }),
    );
    const alpha = rollups.find((r) => r.rosterId === 1)!;
    const bravo = rollups.find((r) => r.rosterId === 2)!;
    expect(alpha.ownerUsername).toBe("ash");
    // Bravo's username matches its team name (case-insensitive), so it is hidden.
    expect(bravo.ownerUsername).toBeNull();
  });

  it("moves a traded future pick to its new owner", () => {
    const rollups = buildTeamRollups(
      baseInput({
        futureSeasonCount: 1,
        futureRounds: 1,
        // Team 1's 2027 1st was traded to team 2.
        tradedPicks: [
          { season: 2027, round: 1, originalRosterId: 1, currentOwnerRosterId: 2 },
        ],
      }),
    );
    const alpha = rollups.find((r) => r.rosterId === 1)!;
    const bravo = rollups.find((r) => r.rosterId === 2)!;
    // Alpha lost its own pick; Bravo now holds two 2027 1sts (its own + Alpha's).
    expect(alpha.futurePicks).toHaveLength(0);
    expect(bravo.futurePicks).toHaveLength(2);
    const acquired = bravo.futurePicks.find((p) => p.originalRosterId === 1)!;
    expect(acquired.isOwn).toBe(false);
    expect(acquired.viaTeamName).toBe("Alpha");
  });
});
