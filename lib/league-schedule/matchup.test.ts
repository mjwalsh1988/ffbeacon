import { describe, it, expect } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type {
  AccuracyRow,
  DefenseRow,
  PlayerRow,
  ProjectionRow,
} from "@/lib/power-pulse/load";
import type { PulsePosition } from "@/lib/power-pulse/types";
import {
  buildMatchupView,
  type BuildMatchupInput,
  type MatchupSideInput,
} from "./matchup";
import type { SetLineupEntry } from "./lineups";
import { alignedStartingSlots } from "./slots";
import type { ScheduleSlot } from "./types";

const WEEK = 5;

/**
 * `position` is a plain string so a test can hand in an IDP position. Real
 * PlayerRow rows only ever carry the six positions Sleeper projects, because
 * loadPlayers filters to them, but the schedule view still has to render an IDP
 * slot with whatever the roster holds.
 */
function player(
  sleeperId: string,
  position: string,
  name = sleeperId,
): PlayerRow {
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

function projection(
  playerId: string,
  points: number,
  week = WEEK,
): ProjectionRow {
  return {
    playerId,
    week,
    opponent: "SF",
    // No stat line, so scoreWithFallback uses the stored columns. All three are
    // the same number so the test does not depend on which base gets picked.
    statLine: null,
    ppr: points,
    halfPpr: points,
    std: points,
  };
}

type World = {
  slots: ScheduleSlot[];
  players: Map<string, PlayerRow>;
  projections: Map<string, ProjectionRow>;
};

/** Build the resolved-player and projection maps from a compact description. */
function world(
  rosterPositions: string[],
  roster: { id: string; position: string; points?: number | null }[],
): World {
  const players = new Map<string, PlayerRow>();
  const projections = new Map<string, ProjectionRow>();
  for (const entry of roster) {
    const row = player(entry.id, entry.position);
    players.set(entry.id, row);
    if (entry.points !== null && entry.points !== undefined) {
      projections.set(
        `${row.playerId}|${WEEK}`,
        projection(row.playerId, entry.points),
      );
    }
  }
  return { slots: alignedStartingSlots(rosterPositions), players, projections };
}

function setLineup(
  slots: ScheduleSlot[],
  ids: (string | null)[],
): SetLineupEntry[] {
  return slots.map((slot, i) => ({
    slot,
    sleeperId: ids[i] ?? null,
    actualPoints: null,
  }));
}

function side(
  slots: ScheduleSlot[],
  opts: {
    rosterId?: number;
    starters: (string | null)[];
    all: string[];
    reserve?: string[];
    taxi?: string[];
    actualTotal?: number | null;
    actualByPlayer?: Record<string, number>;
  },
): MatchupSideInput {
  return {
    sleeperRosterId: opts.rosterId ?? 1,
    rosterRowId: `r-${opts.rosterId ?? 1}`,
    teamName: `Team ${opts.rosterId ?? 1}`,
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 3, losses: 1, ties: 0 },
    pulseRank: 2,
    setLineup: setLineup(slots, opts.starters),
    allPlayerSleeperIds: opts.all,
    reserveSleeperIds: opts.reserve ?? [],
    taxiSleeperIds: opts.taxi ?? [],
    actualTotal: opts.actualTotal ?? null,
    actualByPlayer: new Map(Object.entries(opts.actualByPlayer ?? {})),
  };
}

function input(
  w: World,
  home: MatchupSideInput,
  away: MatchupSideInput | null,
  overrides: Partial<BuildMatchupInput> = {},
): BuildMatchupInput {
  return {
    week: WEEK,
    season: 2026,
    currentWeek: WEEK,
    isFinal: false,
    slots: w.slots,
    home,
    away,
    players: w.players,
    projections: w.projections,
    accuracy: new Map<string, AccuracyRow>(),
    defense: new Map<string, DefenseRow>(),
    defenseSeasons: [],
    scoringSettings: null,
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    ...overrides,
  };
}

describe("buildMatchupView totals", () => {
  it("lets a bye contribute nothing instead of a zero", () => {
    const w = world(
      ["QB", "RB", "WR", "FLEX", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        // No projection row at all. That is a bye, or a player Sleeper does not
        // publish. Either way it is an absent number, not a zero.
        { id: "rb1", position: "RB", points: null },
        { id: "wr1", position: "WR", points: 15 },
        { id: "rb2", position: "RB", points: 10 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1", "wr1", "rb2"],
          all: ["qb1", "rb1", "wr1", "rb2"],
        }),
        null,
      ),
    );

    expect(view.home.projectedTotal).toBeCloseTo(45, 5);
    expect(view.home.unprojectedSlots).toBe(1);
    const rbSlot = view.home.slots[1];
    expect(rbSlot.player?.sleeperId).toBe("rb1");
    expect(rbSlot.player?.projected).toBeNull();
    expect(rbSlot.player?.sigma).toBeNull();
  });

  it("renders an IDP slot with its player, no projection, and outside the totals", () => {
    const w = world(
      ["QB", "LB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "lb1", position: "LB", points: null },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["qb1", "lb1"], all: ["qb1", "lb1"] }),
        null,
      ),
    );

    expect(view.hasUnprojectableSlots).toBe(true);
    const idpSlot = view.home.slots[1];
    expect(idpSlot.slot.projectable).toBe(false);
    expect(idpSlot.player?.name).toBe("lb1");
    expect(idpSlot.player?.projected).toBeNull();
    expect(idpSlot.player?.opponentMultiplier).toBeNull();
    expect(view.home.unprojectedSlots).toBe(1);
    // The QB alone. An IDP slot filled with zero would put every team on a
    // floor no team can reach.
    expect(view.home.projectedTotal).toBeCloseTo(20, 5);
    expect(view.home.optimalTotal).toBeCloseTo(20, 5);
  });

  it("keeps an unresolvable player in its slot rather than shifting the lineup", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 12 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["ghost", "rb1"], all: ["ghost", "rb1"] }),
        null,
      ),
    );

    expect(view.home.slots[0].player?.name).toBe("Unknown player");
    expect(view.home.slots[0].player?.playerId).toBeNull();
    expect(view.home.slots[1].player?.sleeperId).toBe("rb1");
    expect(view.home.unprojectedSlots).toBe(1);
  });

  it("reports no win probability when the roster is unpaired", () => {
    const w = world(["QB", "BN"], [{ id: "qb1", position: "QB", points: 20 }]);
    const view = buildMatchupView(
      input(w, side(w.slots, { starters: ["qb1"], all: ["qb1"] }), null),
    );
    expect(view.away).toBeNull();
    expect(view.homeWinProb).toBeNull();
  });

  it("gives the stronger side a win probability above a half", () => {
    const w = world(
      ["QB", "BN"],
      [
        { id: "qb1", position: "QB", points: 26 },
        { id: "qb2", position: "QB", points: 14 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { rosterId: 1, starters: ["qb1"], all: ["qb1"] }),
        side(w.slots, { rosterId: 2, starters: ["qb2"], all: ["qb2"] }),
      ),
    );
    expect(view.homeWinProb).not.toBeNull();
    expect(view.homeWinProb as number).toBeGreaterThan(0.5);
    expect(view.isCurrent).toBe(true);
  });
});

describe("buildMatchupView on a final week", () => {
  it("reports actual points and no win probability", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 12 },
        { id: "qb2", position: "QB", points: 18 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          rosterId: 1,
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1"],
          actualTotal: 31.7,
          actualByPlayer: { qb1: 24.1, rb1: 7.6 },
        }),
        side(w.slots, {
          rosterId: 2,
          starters: ["qb2"],
          all: ["qb2"],
          actualTotal: 28.4,
        }),
        { isFinal: true },
      ),
    );

    expect(view.isFinal).toBe(true);
    expect(view.isCurrent).toBe(false);
    expect(view.homeWinProb).toBeNull();
    expect(view.home.actualTotal).toBe(31.7);
    expect(view.home.slots[0].player?.actual).toBe(24.1);
    expect(view.home.slots[1].player?.actual).toBe(7.6);
  });

  it("falls back to the slot's own points when the per-player map is missing", () => {
    const w = world(["QB", "BN"], [{ id: "qb1", position: "QB", points: 20 }]);
    const home = side(w.slots, {
      starters: ["qb1"],
      all: ["qb1"],
      actualTotal: 24.1,
    });
    home.setLineup[0].actualPoints = 24.1;
    const view = buildMatchupView(input(w, home, null, { isFinal: true }));
    expect(view.home.slots[0].player?.actual).toBe(24.1);
  });

  it("leaves actual null on a week that has not been played", () => {
    const w = world(["QB", "BN"], [{ id: "qb1", position: "QB", points: 20 }]);
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1"],
          all: ["qb1"],
          actualByPlayer: { qb1: 24.1 },
        }),
        null,
      ),
    );
    expect(view.home.slots[0].player?.actual).toBeNull();
    expect(view.home.actualTotal).toBeNull();
  });
});

describe("the settled-week bench retrospective", () => {
  /**
   * A roster where the projections and the results disagree completely.
   *
   * By projection the set lineup is already optimal, so a projection-graded
   * retrospective reports a perfect week. By what actually happened, the bench
   * back outscored the starter by fifteen. Only one of those is an answer to
   * "how many points did I leave on the bench in week 5".
   */
  const settled = () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 12 },
        { id: "rb2", position: "RB", points: 5 },
      ],
    );
    return { w };
  };

  it("grades the gap on actual points, not on the projections that were wrong", () => {
    const { w } = settled();
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1", "rb2"],
          actualTotal: 28,
          actualByPlayer: { qb1: 24, rb1: 4, rb2: 19 },
        }),
        null,
        { isFinal: true },
      ),
    );

    // 24 + 19, not 20 + 12.
    expect(view.home.optimalTotal).toBeCloseTo(43, 5);
    expect(view.home.pointsLeftOnBench).toBeCloseTo(15, 5);
    // The projection column is untouched, so the table can still print both.
    expect(view.home.projectedTotal).toBeCloseTo(32, 5);
  });

  it("states the swap in the same currency as the gap", () => {
    const { w } = settled();
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1", "rb2"],
          actualTotal: 28,
          actualByPlayer: { qb1: 24, rb1: 4, rb2: 19 },
        }),
        null,
        { isFinal: true },
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    const upgrade = view.home.benchUpgrades[0];
    expect(upgrade.inPlayer.sleeperId).toBe("rb2");
    expect(upgrade.outPlayer.sleeperId).toBe("rb1");
    // "would have outscored him by 15", which is what the box score says. The
    // projection said 5 against 12 and would have printed nothing at all.
    expect(upgrade.gain).toBeCloseTo(15, 5);
  });

  it("reports a perfect settled week when nothing on the bench beat the lineup", () => {
    const { w } = settled();
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1", "rb2"],
          actualTotal: 39,
          actualByPlayer: { qb1: 24, rb1: 15, rb2: 3 },
        }),
        null,
        { isFinal: true },
      ),
    );
    expect(view.home.optimalTotal).toBeCloseTo(39, 5);
    expect(view.home.pointsLeftOnBench).toBe(0);
    expect(view.home.benchUpgrades).toEqual([]);
  });

  it("keeps the projection path on a week that has not been played", () => {
    const { w } = settled();
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1", "rb2"],
          // Results are on file (Sleeper publishes live points mid-week) but the
          // week is not final, so they must not drive the comparison.
          actualByPlayer: { qb1: 24, rb1: 4, rb2: 19 },
        }),
        null,
      ),
    );
    expect(view.home.optimalTotal).toBeCloseTo(32, 5);
    expect(view.home.pointsLeftOnBench).toBe(0);
    expect(view.home.benchUpgrades).toEqual([]);
  });

  it("counts an IDP slot's real score once the week is settled", () => {
    // An IDP slot never receives a projection, so before the week it adds
    // nothing to either total. Afterwards it has a real number, and both sides
    // of the subtraction have to carry it or the gap is off by that much.
    const w = world(
      ["QB", "LB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "lb1", position: "LB", points: null },
        { id: "qb2", position: "QB", points: 10 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "lb1"],
          all: ["qb1", "lb1", "qb2"],
          actualTotal: 27,
          actualByPlayer: { qb1: 18, lb1: 9, qb2: 25 },
        }),
        null,
        { isFinal: true },
      ),
    );

    // Set: 18 + 9. Optimal: qb2 at 25 in the QB slot, plus the same 9 from the
    // slot the fill cannot touch.
    expect(view.home.optimalTotal).toBeCloseTo(34, 5);
    expect(view.home.pointsLeftOnBench).toBeCloseTo(7, 5);
  });
});

describe("bench upgrades", () => {
  it("finds the swap and names the slot it happens in", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 5 },
        { id: "rb2", position: "RB", points: 12 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["qb1", "rb1"], all: ["qb1", "rb1", "rb2"] }),
        null,
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    const upgrade = view.home.benchUpgrades[0];
    expect(upgrade.inPlayer.sleeperId).toBe("rb2");
    expect(upgrade.outPlayer.sleeperId).toBe("rb1");
    expect(upgrade.slotLabel).toBe("RB");
    expect(upgrade.gain).toBeCloseTo(7, 5);
    expect(upgrade.requiresMove).toBe(false);
    expect(view.home.optimalTotal).toBeCloseTo(32, 5);
    expect(view.home.pointsLeftOnBench).toBeCloseTo(7, 5);
  });

  it("lists a taxi player but tags the roster move, and keeps them out of the optimal lineup", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 5 },
        { id: "rb2", position: "RB", points: 12 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["qb1", "rb1"],
          all: ["qb1", "rb1", "rb2"],
          taxi: ["rb2"],
        }),
        null,
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    expect(view.home.benchUpgrades[0].inPlayer.sleeperId).toBe("rb2");
    expect(view.home.benchUpgrades[0].requiresMove).toBe(true);
    expect(view.home.benchUpgrades[0].inPlayer.isInactive).toBe(true);
    // Sleeper will not let a taxi player into a lineup, so the best LEGAL
    // lineup is the one already set.
    expect(view.home.optimalTotal).toBeCloseTo(25, 5);
    expect(view.home.pointsLeftOnBench).toBe(0);
  });

  it("says nothing when the lineup is already the best one", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 12 },
        { id: "rb2", position: "RB", points: 5 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["qb1", "rb1"], all: ["qb1", "rb1", "rb2"] }),
        null,
      ),
    );
    expect(view.home.benchUpgrades).toEqual([]);
    expect(view.home.pointsLeftOnBench).toBe(0);
  });

  it("ignores a gain below the printing threshold", () => {
    const w = world(
      ["RB", "BN"],
      [
        { id: "rb1", position: "RB", points: 10 },
        { id: "rb2", position: "RB", points: 10.3 },
      ],
    );
    const view = buildMatchupView(
      input(w, side(w.slots, { starters: ["rb1"], all: ["rb1", "rb2"] }), null),
    );
    expect(view.home.benchUpgrades).toEqual([]);
  });

  it("displaces each starter at most once", () => {
    // Three bench backs all want the same weak starter. Listing the swap three
    // times would read as three separate gains that stack, which they do not.
    const w = world(
      ["RB", "RB", "BN"],
      [
        { id: "rb1", position: "RB", points: 5 },
        { id: "rb2", position: "RB", points: 6 },
        { id: "rb3", position: "RB", points: 20 },
        { id: "rb4", position: "RB", points: 19 },
        { id: "rb5", position: "RB", points: 18 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, {
          starters: ["rb1", "rb2"],
          all: ["rb1", "rb2", "rb3", "rb4", "rb5"],
        }),
        null,
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    expect(view.home.benchUpgrades[0].inPlayer.sleeperId).toBe("rb3");
    expect(view.home.benchUpgrades[0].outPlayer.sleeperId).toBe("rb1");
    // The single swap is worth 15. The optimal lineup is worth 28 more than the
    // one set, because it replaces both starters. The two numbers are different
    // on purpose and the copy must never add the swaps up.
    expect(view.home.benchUpgrades[0].gain).toBeCloseTo(15, 5);
    expect(view.home.pointsLeftOnBench).toBeCloseTo(28, 5);
  });

  it("offers an empty starting slot as a target rather than displacing a starter", () => {
    // The manager left the WR slot open. Telling them to bench their weakest
    // eligible starter instead of pointing at the hole is the worst version of
    // this panel, and the hole is already counted in pointsLeftOnBench.
    const w = world(
      ["QB", "WR", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "wr1", position: "WR", points: 14 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["qb1", null], all: ["qb1", "wr1"] }),
        null,
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    const upgrade = view.home.benchUpgrades[0];
    expect(upgrade.inPlayer.sleeperId).toBe("wr1");
    expect(upgrade.slotLabel).toBe("WR");
    // An unfilled slot is worth nothing, so the whole projection is the gain.
    expect(upgrade.gain).toBeCloseTo(14, 5);
    expect(upgrade.outPlayer.name).toBe("an empty slot");
    expect(upgrade.outPlayer.playerId).toBeNull();
    expect(upgrade.outPlayer.projected).toBeNull();
    expect(upgrade.outPlayer.actual).toBeNull();
    // The gap and the swap agree, which is the point.
    expect(view.home.projectedTotal).toBeCloseTo(20, 5);
    expect(view.home.optimalTotal).toBeCloseTo(34, 5);
    expect(view.home.pointsLeftOnBench).toBeCloseTo(14, 5);
  });

  it("prefers the empty slot over an occupied one when both are eligible", () => {
    const w = world(
      ["RB", "RB", "BN"],
      [
        { id: "rb1", position: "RB", points: 9 },
        { id: "rb2", position: "RB", points: 15 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["rb1", null], all: ["rb1", "rb2"] }),
        null,
      ),
    );

    expect(view.home.benchUpgrades).toHaveLength(1);
    expect(view.home.benchUpgrades[0].outPlayer.name).toBe("an empty slot");
    expect(view.home.benchUpgrades[0].gain).toBeCloseTo(15, 5);
  });

  it("does not treat an ungradeable starter as a zero-point target", () => {
    // rb1 is on a bye, so there is no number for him. Calling that zero would
    // invent a fifteen point gain out of our own missing data.
    const w = world(
      ["RB", "BN"],
      [
        { id: "rb1", position: "RB", points: null },
        { id: "rb2", position: "RB", points: 15 },
      ],
    );
    const view = buildMatchupView(
      input(w, side(w.slots, { starters: ["rb1"], all: ["rb1", "rb2"] }), null),
    );
    expect(view.home.benchUpgrades).toEqual([]);
  });

  it("does not propose a player for a slot they cannot fill", () => {
    const w = world(
      ["QB", "RB", "BN"],
      [
        { id: "qb1", position: "QB", points: 20 },
        { id: "rb1", position: "RB", points: 5 },
        { id: "te1", position: "TE", points: 18 },
      ],
    );
    const view = buildMatchupView(
      input(
        w,
        side(w.slots, { starters: ["qb1", "rb1"], all: ["qb1", "rb1", "te1"] }),
        null,
      ),
    );
    // A tight end is eligible for neither QB nor RB, so there is no swap even
    // though he outscores both starters.
    expect(view.home.benchUpgrades).toEqual([]);
  });
});
