/**
 * Coverage for lib/league-lineups/build.ts.
 *
 * The properties worth holding, in order of how badly getting one wrong would
 * read on the page:
 *
 *   1. THE MOVES ADD UP. `pointsGained` across every move sums to exactly
 *      `pointsLeftOnBench`. This is the whole reason the optimiser is run once
 *      and diffed rather than asked one player at a time, and it is the one
 *      thing a reader can check with their own eyes.
 *   2. SLOT INDICES SURVIVE THE IDP GAP. A league with an IDP slot in the
 *      middle of its roster_positions must still report a move against the
 *      slot a reader can see, not against the one at the same index in the
 *      shorter projectable list.
 *   3. THE "0" PLACEHOLDER IS NOT A PLAYER, and it does not shift anybody.
 *   4. A NULL PROJECTION IS NEVER A ZERO, anywhere.
 *   5. A SETTLED WEEK IS GRADED ON RESULTS, not on the projections that were
 *      wrong enough to produce the lineup being graded.
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type { AccuracyRow, DefenseRow, PlayerRow, ProjectionRow } from "@/lib/power-pulse/load";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { EMPTY_GAME_ENVIRONMENT } from "@/lib/nfl-game-environment";
import { buildLineup, groupStartingSlots, projectableSlotIndex, type BuildLineupInput } from "./build";

const WEEK = 5;
const SEASON = 2026;

/** A plain roster_positions array: QB, two RBs, two WRs, TE, FLEX, bench. */
const SIMPLE_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN"];

/** The same league with a linebacker slot wedged between the TE and the FLEX. */
const IDP_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "TE", "LB", "FLEX", "BN", "BN"];

function player(sleeperId: string, position: string, name = sleeperId): PlayerRow {
  return {
    playerId: `p-${sleeperId}`,
    sleeperId,
    name,
    position: position as PulsePosition,
    team: "BUF",
    injuryStatus: null,
    depthOrder: null,
  };
}

function projection(playerId: string, points: number): ProjectionRow {
  return {
    playerId,
    week: WEEK,
    opponent: "SF",
    // No stat line, so the stored columns are used, and all three are equal so
    // the test does not depend on which scoring base gets picked.
    statLine: null,
    ppr: points,
    halfPpr: points,
    std: points,
  };
}

type Spec = {
  sleeperId: string;
  position: string;
  points: number | null;
  /** Actual points for a settled week. */
  actual?: number;
};

function buildInput(opts: {
  rosterPositions?: string[];
  roster: Spec[];
  /** Positional, "0" for an empty slot. Length need not match the slot list. */
  starters: string[];
  reserve?: string[];
  taxi?: string[];
  isFinal?: boolean;
  officialActualTotal?: number | null;
}): BuildLineupInput {
  const slots = alignedStartingSlots(opts.rosterPositions ?? SIMPLE_POSITIONS);

  const players = new Map<string, PlayerRow>();
  const projections = new Map<string, ProjectionRow>();
  const actualByPlayer = new Map<string, number>();

  for (const spec of opts.roster) {
    const row = player(spec.sleeperId, spec.position);
    players.set(spec.sleeperId, row);
    if (spec.points !== null) projections.set(row.playerId, projection(row.playerId, spec.points));
    if (spec.actual !== undefined) actualByPlayer.set(spec.sleeperId, spec.actual);
  }

  return {
    week: WEEK,
    season: SEASON,
    currentWeek: WEEK,
    isFinal: opts.isFinal ?? false,
    // The tests grade and display on the same basis, which is the ordinary
    // case: a settled week shows results, an unplayed one shows projections.
    // The one shape they do NOT cover is a week in progress, where the two
    // deliberately differ, and lib/league-lineups/status.test.ts owns that.
    actualsVisible: opts.isFinal ?? false,
    slots,
    setStarterIds: opts.starters,
    allPlayerSleeperIds: opts.roster.map((r) => r.sleeperId),
    reserveSleeperIds: opts.reserve ?? [],
    taxiSleeperIds: opts.taxi ?? [],
    players,
    projections,
    accuracy: new Map<string, AccuracyRow>(),
    defense: new Map<string, DefenseRow>(),
    defenseSeasons: [SEASON],
    // A ppr map so closestScoringBase resolves, with nothing exotic in it.
    scoringSettings: { rec: 1, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1 },
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    actualByPlayer,
    officialActualTotal: opts.officialActualTotal ?? null,
    homeAwayByTeamWeek: null,
    environment: EMPTY_GAME_ENVIRONMENT,
    positionalWar: new Map(),
  };
}

/** The seven-slot lineup, all filled, nobody better on the bench. */
function optimalRoster(): Spec[] {
  return [
    { sleeperId: "qb1", position: "QB", points: 22 },
    { sleeperId: "rb1", position: "RB", points: 18 },
    { sleeperId: "rb2", position: "RB", points: 14 },
    { sleeperId: "wr1", position: "WR", points: 17 },
    { sleeperId: "wr2", position: "WR", points: 13 },
    { sleeperId: "te1", position: "TE", points: 11 },
    { sleeperId: "flex1", position: "WR", points: 10 },
    { sleeperId: "bench1", position: "RB", points: 4 },
  ];
}

const OPTIMAL_STARTERS = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "flex1"];

describe("buildLineup: the lineup as set", () => {
  it("puts each starter in the slot Sleeper's positional array put him in", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    const byLabel = new Map<string, string | null>();
    for (const group of built.groups) {
      for (const entry of group.entries) {
        byLabel.set(`${entry.slot.label}-${entry.slot.order}`, entry.player?.sleeperId ?? null);
      }
    }
    expect(byLabel.get("QB-0")).toBe("qb1");
    expect(byLabel.get("RB-1")).toBe("rb1");
    expect(byLabel.get("RB-2")).toBe("rb2");
    expect(byLabel.get("FLEX-6")).toBe("flex1");
  });

  it("groups the slots into position blocks in display order", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    expect(built.groups.map((g) => g.group)).toEqual(["QB", "RB", "WR", "TE", "FLEX"]);
  });

  it("sums each block's projections and leaves an unprojected one out", () => {
    const roster = optimalRoster();
    roster[1] = { sleeperId: "rb1", position: "RB", points: null };
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));
    const rb = built.groups.find((g) => g.group === "RB");
    expect(rb?.projected).toBeCloseTo(14, 5);
    expect(rb?.unprojected).toBe(1);
    expect(built.unprojectedSlotCount).toBe(1);
  });

  it("treats a '0' as an empty slot without shifting anybody below it", () => {
    const built = buildLineup(
      buildInput({
        roster: optimalRoster(),
        // The second WR slot is left empty. Everything below it must stay put.
        starters: ["qb1", "rb1", "rb2", "wr1", "0", "te1", "flex1"],
      }),
    );
    const wr = built.groups.find((g) => g.group === "WR");
    expect(wr?.entries.map((e) => e.player?.sleeperId ?? null)).toEqual(["wr1", null]);
    const te = built.groups.find((g) => g.group === "TE");
    expect(te?.entries[0].player?.sleeperId).toBe("te1");
  });

  it("splits the roster into starters, bench, injured reserve and taxi", () => {
    const roster = [
      ...optimalRoster(),
      { sleeperId: "ir1", position: "WR", points: null },
      { sleeperId: "taxi1", position: "RB", points: 3 },
    ];
    const built = buildLineup(
      buildInput({
        roster,
        starters: OPTIMAL_STARTERS,
        reserve: ["ir1"],
        taxi: ["taxi1"],
      }),
    );
    expect(built.bench.map((p) => p.sleeperId)).toEqual(["bench1"]);
    expect(built.reserve.map((p) => p.sleeperId)).toEqual(["ir1"]);
    expect(built.taxi.map((p) => p.sleeperId)).toEqual(["taxi1"]);
    expect(built.bySleeperId.get("ir1")?.isInactive).toBe(true);
  });

  it("sorts the bench by projection, with an unprojected player last rather than as a zero", () => {
    const roster = [
      ...optimalRoster(),
      { sleeperId: "bench2", position: "WR", points: null },
      { sleeperId: "bench3", position: "WR", points: 8 },
    ];
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));
    expect(built.bench.map((p) => p.sleeperId)).toEqual(["bench3", "bench1", "bench2"]);
    expect(built.bench[2].projected).toBeNull();
  });

  it("names an unresolved Sleeper id rather than dropping its slot", () => {
    const built = buildLineup(
      buildInput({
        roster: optimalRoster(),
        starters: ["qb1", "rb1", "rb2", "wr1", "wr2", "ghost", "flex1"],
      }),
    );
    const te = built.groups.find((g) => g.group === "TE");
    expect(te?.entries[0].player?.name).toBe("Unknown player");
    expect(te?.entries[0].player?.projected).toBeNull();
  });
});

describe("buildLineup: the optimiser", () => {
  it("finds no moves when the lineup is already the best one", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    expect(built.optimization.moves).toEqual([]);
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(0, 5);
    expect(built.optimization.efficiency).toBeCloseTo(1, 5);
    expect(built.optimization.unavailable).toBe(false);
  });

  it("names the swap when a better player is on the bench", () => {
    const roster = optimalRoster();
    // A 25-point receiver benched behind a 13-point one.
    roster[7] = { sleeperId: "bench1", position: "WR", points: 25 };
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));

    expect(built.optimization.moves).toHaveLength(1);
    const move = built.optimization.moves[0];
    expect(move.inPlayer.sleeperId).toBe("bench1");
    // He displaces the weakest player the fill can move out of a slot he is
    // eligible for, which is the 10-point receiver in the FLEX.
    expect(move.outPlayer?.sleeperId).toBe("flex1");
    expect(move.pointsGained).toBeCloseTo(15, 5);
  });

  it("gains sum to exactly the points left on the bench", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22 },
      { sleeperId: "rb1", position: "RB", points: 6 },
      { sleeperId: "rb2", position: "RB", points: 5 },
      { sleeperId: "wr1", position: "WR", points: 7 },
      { sleeperId: "wr2", position: "WR", points: 4 },
      { sleeperId: "te1", position: "TE", points: 9 },
      { sleeperId: "flex1", position: "WR", points: 3 },
      // Three better players, all benched.
      { sleeperId: "bench1", position: "RB", points: 20 },
      { sleeperId: "bench2", position: "WR", points: 18 },
      { sleeperId: "bench3", position: "WR", points: 16 },
    ];
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));

    const summed = built.optimization.moves.reduce((total, m) => total + m.pointsGained, 0);
    expect(built.optimization.pointsLeftOnBench).not.toBeNull();
    expect(summed).toBeCloseTo(built.optimization.pointsLeftOnBench as number, 5);
  });

  it("reports the move against the slot a reader can see, past an IDP gap", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22 },
      { sleeperId: "rb1", position: "RB", points: 18 },
      { sleeperId: "rb2", position: "RB", points: 14 },
      { sleeperId: "wr1", position: "WR", points: 17 },
      { sleeperId: "wr2", position: "WR", points: 13 },
      { sleeperId: "te1", position: "TE", points: 11 },
      { sleeperId: "lb1", position: "LB", points: null },
      { sleeperId: "flex1", position: "WR", points: 3 },
      { sleeperId: "bench1", position: "WR", points: 25 },
    ];
    const built = buildLineup(
      buildInput({
        rosterPositions: IDP_POSITIONS,
        roster,
        starters: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "lb1", "flex1"],
      }),
    );

    expect(built.optimization.moves).toHaveLength(1);
    // FLEX, which is slot index 7 in the aligned list and index 6 in the
    // projectable one. Reporting the projectable index would say "LB".
    expect(built.optimization.moves[0].slotLabel).toBe("FLEX");
    expect(built.optimization.moves[0].outPlayer?.sleeperId).toBe("flex1");
  });

  it("counts an IDP slot's own set-lineup points in both totals so they stay comparable", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22 },
      { sleeperId: "rb1", position: "RB", points: 18 },
      { sleeperId: "rb2", position: "RB", points: 14 },
      { sleeperId: "wr1", position: "WR", points: 17 },
      { sleeperId: "wr2", position: "WR", points: 13 },
      { sleeperId: "te1", position: "TE", points: 11 },
      { sleeperId: "lb1", position: "LB", points: null },
      { sleeperId: "flex1", position: "WR", points: 10 },
    ];
    const built = buildLineup(
      buildInput({
        rosterPositions: IDP_POSITIONS,
        roster,
        starters: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "lb1", "flex1"],
      }),
    );
    // Nobody better on the bench, so the set lineup IS the optimum and the gap
    // is zero. An IDP slot double-counted or dropped would break exactly this.
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(0, 5);
    expect(built.unprojectableSlotCount).toBe(1);
  });

  it("offers filling an empty slot as a move, with no player coming out", () => {
    const roster = optimalRoster();
    const built = buildLineup(
      buildInput({
        roster,
        starters: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "0"],
      }),
    );
    expect(built.optimization.moves).toHaveLength(1);
    expect(built.optimization.moves[0].outPlayer).toBeNull();
    expect(built.optimization.moves[0].inPlayer.sleeperId).toBe("flex1");
    expect(built.optimization.moves[0].pointsGained).toBeCloseTo(10, 5);
  });

  it("never seats a player on injured reserve or the taxi squad", () => {
    const roster = [
      ...optimalRoster(),
      { sleeperId: "ir1", position: "WR", points: 40 },
      { sleeperId: "taxi1", position: "WR", points: 39 },
    ];
    const built = buildLineup(
      buildInput({
        roster,
        starters: OPTIMAL_STARTERS,
        reserve: ["ir1"],
        taxi: ["taxi1"],
      }),
    );
    expect(built.optimization.moves).toEqual([]);
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(0, 5);
  });

  it("ignores a swap worth less than the noise floor", () => {
    const roster = optimalRoster();
    // Worth 0.3 more than the FLEX incumbent, which is under MIN_MOVE_GAIN.
    roster[7] = { sleeperId: "bench1", position: "WR", points: 10.3 };
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));
    expect(built.optimization.moves).toEqual([]);
    // The gap still reports it, because it comes from the fill rather than
    // from the filtered list of advice.
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(0.3, 5);
  });

  it("says the optimum is unavailable rather than optimal when nothing is projected", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: null },
      { sleeperId: "rb1", position: "RB", points: null },
    ];
    const built = buildLineup(buildInput({ roster, starters: ["qb1", "rb1"] }));
    expect(built.optimization.unavailable).toBe(true);
    expect(built.optimization.optimalTotal).toBeNull();
    expect(built.optimization.pointsLeftOnBench).toBeNull();
    expect(built.optimization.efficiency).toBeNull();
    expect(built.optimization.moves).toEqual([]);
  });
});

describe("buildLineup: a settled week", () => {
  it("grades the retrospective on what players scored, not on what they were projected", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22, actual: 20 },
      { sleeperId: "rb1", position: "RB", points: 18, actual: 4 },
      { sleeperId: "rb2", position: "RB", points: 14, actual: 12 },
      { sleeperId: "wr1", position: "WR", points: 17, actual: 15 },
      { sleeperId: "wr2", position: "WR", points: 13, actual: 11 },
      { sleeperId: "te1", position: "TE", points: 11, actual: 9 },
      { sleeperId: "flex1", position: "WR", points: 10, actual: 8 },
      // Projected worst on the roster, scored the most. This is the whole point.
      { sleeperId: "bench1", position: "RB", points: 4, actual: 30 },
    ];
    const built = buildLineup(
      buildInput({ roster, starters: OPTIMAL_STARTERS, isFinal: true }),
    );

    expect(built.optimization.moves).toHaveLength(1);
    expect(built.optimization.moves[0].inPlayer.sleeperId).toBe("bench1");
    expect(built.optimization.moves[0].outPlayer?.sleeperId).toBe("rb1");
    expect(built.optimization.moves[0].pointsGained).toBeCloseTo(26, 5);
  });

  it("prefers the league's own official score over re-adding the parts", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22, actual: 20 },
      { sleeperId: "rb1", position: "RB", points: 18, actual: 10 },
    ];
    const built = buildLineup(
      buildInput({
        roster,
        starters: ["qb1", "rb1"],
        isFinal: true,
        officialActualTotal: 30.4,
      }),
    );
    expect(built.actualTotal).toBe(30.4);
  });

  it("falls back to the summed parts when no official score is stored", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22, actual: 20 },
      { sleeperId: "rb1", position: "RB", points: 18, actual: 10 },
    ];
    const built = buildLineup(
      buildInput({ roster, starters: ["qb1", "rb1"], isFinal: true }),
    );
    expect(built.actualTotal).toBeCloseTo(30, 5);
  });

  it("reports no actual total at all before the week settles", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    expect(built.actualTotal).toBeNull();
    for (const group of built.groups) {
      for (const entry of group.entries) {
        expect(entry.player?.actual ?? null).toBeNull();
      }
    }
  });
});

describe("projectableSlotIndex", () => {
  it("maps projectable positions back to the full aligned list", () => {
    const slots = alignedStartingSlots(IDP_POSITIONS);
    // Eight non-bench slots; the LB at index 6 is the unprojectable one.
    expect(slots).toHaveLength(8);
    expect(projectableSlotIndex(slots)).toEqual([0, 1, 2, 3, 4, 5, 7]);
  });

  it("is the identity when every slot is projectable", () => {
    const slots = alignedStartingSlots(SIMPLE_POSITIONS);
    expect(projectableSlotIndex(slots)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("groupStartingSlots", () => {
  it("keeps the league's own order inside a block", () => {
    const slots = alignedStartingSlots(SIMPLE_POSITIONS);
    const groups = groupStartingSlots(
      // Deliberately shuffled, so the sort inside the block is what orders them.
      [...slots].reverse().map((slot) => ({ slot, player: null })),
    );
    const rb = groups.find((g) => g.group === "RB");
    expect(rb?.entries.map((e) => e.slot.order)).toEqual([1, 2]);
  });

  it("reports a block with nothing projected as null rather than zero", () => {
    const slots = alignedStartingSlots(SIMPLE_POSITIONS);
    const groups = groupStartingSlots(slots.map((slot) => ({ slot, player: null })));
    for (const group of groups) expect(group.projected).toBeNull();
  });
});

describe("buildLineup: the fill it hands back", () => {
  it("returns the exact candidate list and tokens it filled with", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    // Eight rostered players, all projectable and none inactive.
    expect(built.fillCandidates).toHaveLength(8);
    expect(built.fillTokens).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]);
    expect(built.fillTotal).toBeCloseTo(105, 5);
  });

  it("excludes injured reserve and taxi players from the candidate list it hands back", () => {
    const roster = [
      ...optimalRoster(),
      { sleeperId: "ir1", position: "WR", points: 40 },
      { sleeperId: "taxi1", position: "WR", points: 39 },
    ];
    const built = buildLineup(
      buildInput({ roster, starters: OPTIMAL_STARTERS, reserve: ["ir1"], taxi: ["taxi1"] }),
    );
    const ids = built.fillCandidates.map((c) => c.playerId);
    expect(ids).not.toContain("p-ir1");
    expect(ids).not.toContain("p-taxi1");
  });

  it("hands back the raw fill total, before the unprojectable add-back", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22 },
      { sleeperId: "rb1", position: "RB", points: 18 },
      { sleeperId: "rb2", position: "RB", points: 14 },
      { sleeperId: "wr1", position: "WR", points: 17 },
      { sleeperId: "wr2", position: "WR", points: 13 },
      { sleeperId: "te1", position: "TE", points: 11 },
      { sleeperId: "lb1", position: "LB", points: null },
      { sleeperId: "flex1", position: "WR", points: 10 },
    ];
    const built = buildLineup(
      buildInput({
        rosterPositions: IDP_POSITIONS,
        roster,
        starters: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "lb1", "flex1"],
      }),
    );
    // The seven projectable slots only. On an unplayed week the IDP slot adds
    // nothing, so the two happen to agree here; the point is that fillTotal is
    // the number a with-him fill can be compared against directly.
    expect(built.fillTotal).toBeCloseTo(105, 5);
    expect(built.fillTokens).not.toContain("LB");
  });

  it("hands back nothing to compare against when there is no fill", () => {
    const built = buildLineup(
      buildInput({
        roster: [{ sleeperId: "qb1", position: "QB", points: null }],
        starters: ["qb1"],
      }),
    );
    expect(built.fillTotal).toBeNull();
    expect(built.fillCandidates).toEqual([]);
  });
});

/**
 * The two failures a review found in the first version of the move diff, each
 * pinned by the case that produced it.
 */
describe("buildLineup: the move pairing", () => {
  const TWO_SLOT = ["QB", "RB", "BN", "BN"];

  it("pairs an incoming player with a starter who could actually hold his slot", () => {
    // Both slots are being upgraded at once. Pairing purely by value put the
    // incoming running back against the outgoing QUARTERBACK, printed "+8.0"
    // for it, and left a second pair worth -5.0 that the threshold silently
    // dropped. The headline gap said +3.0. Three numbers, none of them the
    // move a manager could make.
    const roster: Spec[] = [
      { sleeperId: "qbA", position: "QB", points: 2 },
      { sleeperId: "rbA", position: "RB", points: 8 },
      { sleeperId: "qbB", position: "QB", points: 3 },
      { sleeperId: "rbB", position: "RB", points: 10 },
    ];
    const built = buildLineup(
      buildInput({ rosterPositions: TWO_SLOT, roster, starters: ["qbA", "rbA"] }),
    );

    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(3, 5);
    expect(built.optimization.moves).toHaveLength(2);

    const byIn = new Map(built.optimization.moves.map((m) => [m.inPlayer.sleeperId, m]));
    // The running back replaces the running back, the quarterback the
    // quarterback, and each gain is the one that swap is actually worth.
    expect(byIn.get("rbB")?.outPlayer?.sleeperId).toBe("rbA");
    expect(byIn.get("rbB")?.pointsGained).toBeCloseTo(2, 5);
    expect(byIn.get("qbB")?.outPlayer?.sleeperId).toBe("qbA");
    expect(byIn.get("qbB")?.pointsGained).toBeCloseTo(1, 5);

    const summed = built.optimization.moves.reduce((t, m) => t + m.pointsGained, 0);
    expect(summed).toBeCloseTo(built.optimization.pointsLeftOnBench as number, 5);
  });

  it("never reports a negative gain", () => {
    const roster: Spec[] = [
      { sleeperId: "qbA", position: "QB", points: 2 },
      { sleeperId: "rbA", position: "RB", points: 8 },
      { sleeperId: "qbB", position: "QB", points: 3 },
      { sleeperId: "rbB", position: "RB", points: 10 },
    ];
    const built = buildLineup(
      buildInput({ rosterPositions: TWO_SLOT, roster, starters: ["qbA", "rbA"] }),
    );
    for (const move of built.optimization.moves) {
      expect(move.pointsGained).toBeGreaterThan(0);
    }
  });

  it("reports the gain it held back rather than letting the two figures disagree", () => {
    const roster = optimalRoster();
    // Worth 0.3 more than the FLEX incumbent, which is under MIN_MOVE_GAIN.
    roster[7] = { sleeperId: "bench1", position: "WR", points: 10.3 };
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));

    expect(built.optimization.moves).toEqual([]);
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(0.3, 5);
    // The panel needs this to explain why it is showing a gap and no moves.
    expect(built.optimization.unlistedGain).toBeCloseTo(0.3, 5);
  });

  it("reports no unlisted gain when every move cleared the threshold", () => {
    const roster = optimalRoster();
    roster[7] = { sleeperId: "bench1", position: "WR", points: 25 };
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));
    expect(built.optimization.unlistedGain).toBeCloseTo(0, 5);
  });
});

describe("buildLineup: both totals come from one candidate pool", () => {
  it("leaves an ungradable starter out of BOTH totals and counts him", () => {
    // "ghost" is on the roster and in the lineup, scored 30 according to
    // Sleeper's per-player points, and has no row in our players table. Counting
    // that 30 in the set total while the optimal fill cannot use him understated
    // the optimum, floored the gap at zero, and made the page report a perfect
    // lineup on a week it could not measure.
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22, actual: 20 },
      { sleeperId: "rb1", position: "RB", points: 18, actual: 10 },
    ];
    const input = buildInput({
      rosterPositions: ["QB", "RB", "BN"],
      roster,
      starters: ["qb1", "ghost"],
      isFinal: true,
    });
    // On the roster and scoring, but unknown to `players`.
    input.allPlayerSleeperIds = [...input.allPlayerSleeperIds, "ghost"];
    input.actualByPlayer.set("ghost", 30);

    const built = buildLineup(input);

    // The set lineup is the quarterback's 20 alone. The ghost's 30 is excluded
    // because the optimum cannot use him, and counting it on one side only was
    // the whole bug: it made the optimum look worse than the lineup.
    expect(built.optimization.setTotal).toBeCloseTo(20, 5);
    // The optimum seats the quarterback and pulls rb1 off the bench into the
    // running back slot the ghost was occupying: 20 plus 10.
    expect(built.optimization.optimalTotal).toBeCloseTo(30, 5);
    expect(built.optimization.pointsLeftOnBench).toBeCloseTo(10, 5);
    expect(built.optimization.ungradedSlotCount).toBe(1);
    // So the page reports the real move rather than telling the manager they
    // were perfect on a week it could not fully grade.
    expect(built.optimization.moves).toHaveLength(1);
    expect(built.optimization.moves[0].inPlayer.sleeperId).toBe("rb1");
    // Nobody is named as coming out: the slot's holder is the very player we
    // could not grade, and inventing a gain against him is what the exclusion
    // exists to prevent.
    expect(built.optimization.moves[0].outPlayer).toBeNull();
  });

  it("counts nothing as ungraded on an ordinary week", () => {
    const built = buildLineup(buildInput({ roster: optimalRoster(), starters: OPTIMAL_STARTERS }));
    expect(built.optimization.ungradedSlotCount).toBe(0);
  });

  it("rounds a perfect lineup to exactly zero left on the bench", () => {
    const roster: Spec[] = [
      { sleeperId: "qb1", position: "QB", points: 22.7 },
      { sleeperId: "rb1", position: "RB", points: 18.3 },
      { sleeperId: "rb2", position: "RB", points: 14.1 },
      { sleeperId: "wr1", position: "WR", points: 17.9 },
      { sleeperId: "wr2", position: "WR", points: 13.3 },
      { sleeperId: "te1", position: "TE", points: 11.7 },
      { sleeperId: "flex1", position: "WR", points: 10.1 },
    ];
    const built = buildLineup(buildInput({ roster, starters: OPTIMAL_STARTERS }));
    expect(built.optimization.pointsLeftOnBench).toBe(0);
    expect(built.optimization.efficiency).toBe(1);
  });
});
