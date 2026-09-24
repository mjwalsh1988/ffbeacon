/**
 * Lineups with the IDP switch (plan IDP-305).
 *
 * build.golden.test.ts pins the OFF path. These pin the ON path: defensive
 * slots are projected and optimised, a DL/LB player can be seated as LB, the
 * pairing reads the outgoing starter's eligibility, and the what-if offers a
 * dual-eligible bench player for a slot his primary cannot fill.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type { PlayerRow, ProjectionRow } from "@/lib/power-pulse/load";
import { slotEligibility, type PulsePosition } from "@/lib/power-pulse/types";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { EMPTY_GAME_ENVIRONMENT } from "@/lib/nfl-game-environment";
import { buildLineup, type BuildLineupInput } from "./build";
import { countSwapCandidates, isEligibleFor, swapCandidates } from "./simulate";

const WEEK = 5;
const POSITIONS = ["QB", "LB", "IDP_FLEX", "BN", "BN", "BN"];
/** A complete offensive map plus Sleeper's default IDP rules, so defenders score. */
const SCORING = {
  pass_yd: 0.04,
  pass_td: 4,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  idp_tkl_solo: 2,
  idp_tkl_ast: 1,
  idp_sack: 6,
};

function row(sleeperId: string, position: string, eligible?: string[]): PlayerRow {
  return {
    playerId: `p-${sleeperId}`,
    sleeperId,
    name: sleeperId,
    position: position as PulsePosition,
    team: "BUF",
    injuryStatus: null,
    depthOrder: null,
    eligible: eligible ?? [position],
  };
}

function offense(playerId: string, points: number): ProjectionRow {
  return { playerId, week: WEEK, opponent: "SF", statLine: null, ppr: points, halfPpr: points, std: points };
}

/** A defender's line: `solo` solo tackles and one assisted, so under SCORING it is solo * 2 + 1. */
function defender(playerId: string, solo: number): ProjectionRow {
  return {
    playerId,
    week: WEEK,
    opponent: "SF",
    statLine: { idp_tkl_solo: solo, idp_tkl_ast: 1 },
    ppr: null,
    halfPpr: null,
    std: null,
    availability: "projected",
  };
}

function input(idpEnabled: boolean): BuildLineupInput {
  const players = new Map<string, PlayerRow>([
    ["qb", row("qb", "QB")],
    ["lb-weak", row("lb-weak", "LB")],
    ["db-flex", row("db-flex", "DB")],
    // A DL/LB player on the bench: the best defender on the roster.
    ["edge", row("edge", "DL", ["DL", "LB"])],
  ]);
  const projections = new Map<string, ProjectionRow>([
    ["p-qb", offense("p-qb", 20)],
    ["p-lb-weak", defender("p-lb-weak", 2)],
    ["p-db-flex", defender("p-db-flex", 4)],
    ["p-edge", defender("p-edge", 7)],
  ]);
  return {
    week: WEEK,
    season: 2026,
    currentWeek: WEEK,
    isFinal: false,
    actualsVisible: false,
    slots: alignedStartingSlots(POSITIONS, idpEnabled ? slotEligibility(true) : undefined),
    setStarterIds: ["qb", "lb-weak", "db-flex"],
    allPlayerSleeperIds: ["qb", "lb-weak", "db-flex", "edge"],
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    players,
    projections,
    accuracy: new Map(),
    defense: new Map(),
    defenseSeasons: [2026],
    scoringSettings: SCORING,
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    actualByPlayer: new Map(),
    officialActualTotal: null,
    homeAwayByTeamWeek: null,
    environment: EMPTY_GAME_ENVIRONMENT,
    positionalWar: new Map(),
    idpEnabled,
  };
}

describe("Lineups with the IDP switch", () => {
  it("off: defensive slots stay unprojectable and out of both totals", () => {
    const built = buildLineup(input(false));
    expect(built.unprojectableSlotCount).toBe(2);
    // Off, the loader never hands a defender a projection (projectablePlayerIds
    // leaves them out). Even when one arrives, the fill cannot touch a
    // defensive slot: nothing is offered and nothing is left on the bench.
    expect(built.optimization.moves).toEqual([]);
    expect(built.optimization.pointsLeftOnBench).toBe(0);
    expect(built.bench[0].eligible).toBeUndefined();
  });

  it("on: every defensive slot is projectable and the bench DL/LB replaces the weak linebacker", () => {
    const built = buildLineup(input(true));
    expect(built.unprojectableSlotCount).toBe(0);
    const move = built.optimization.moves[0];
    expect(move?.inPlayer.sleeperId).toBe("edge");
    // Paired against the starter who can hold the slot he takes, never the
    // cheapest starter of any position.
    expect(move?.outPlayer?.sleeperId).toBe("lb-weak");
    expect(built.optimization.pointsLeftOnBench).toBeGreaterThan(0);
    // The gains still sum to the gap (every pair listed here is above the floor).
    const listed = built.optimization.moves.reduce((t, m) => t + m.pointsGained, 0);
    expect(listed + built.optimization.unlistedGain).toBeCloseTo(
      built.optimization.pointsLeftOnBench ?? 0,
      2,
    );
    expect(built.bench.find((p) => p.sleeperId === "edge")?.eligible).toEqual(["DL", "LB"]);
  });

  it("the what-if offers the DL/LB player for the LB slot only with the switch on", () => {
    const built = buildLineup(input(true));
    expect(isEligibleFor("IDP_FLEX", ["LB"], true)).toBe(true);
    expect(isEligibleFor("LB", ["DL", "LB"], true)).toBe(true);
    expect(isEligibleFor("LB", ["DL", "LB"])).toBe(false);
    expect(swapCandidates(built.bench, "LB", true).map((p) => p.sleeperId)).toEqual(["edge"]);
    expect(countSwapCandidates(built.bench, "LB", false)).toBe(0);
  });
});
