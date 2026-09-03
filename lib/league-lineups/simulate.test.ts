import { describe, expect, it } from "vitest";
import type { ScheduleSlot } from "@/lib/league-schedule/types";
import {
  baselineSigma,
  countSwapCandidates,
  eligiblePositionsFor,
  isEligibleFor,
  pointsDirection,
  probabilityDirection,
  simulateSwap,
  swapCandidates,
  type LineupBaseline,
} from "./simulate";
import type { LineupGroup, LineupPlayer, RosterSlotKind } from "./types";

function player(
  over: Partial<LineupPlayer> & { sleeperId: string; position: string },
): LineupPlayer {
  return {
    playerId: `uuid-${over.sleeperId}`,
    name: `Player ${over.sleeperId}`,
    team: "BUF",
    injuryStatus: null,
    nflOpponent: "MIA",
    nflIsHome: true,
    opponentMultiplier: 1,
    beatRate: null,
    availability: null,
    reliability: 1,
    projected: 10,
    sigma: 5,
    actual: null,
    isInactive: false,
    rosterSlot: "bench" as RosterSlotKind,
    startingSlotLabel: null,
    startingSlotOrder: null,
    positionalWar: null,
    positionalWarRank: null,
    positionalWarPoolSize: null,
    environment: null,
    environmentTier: null,
    ...over,
  };
}

function slot(token: string, order: number): ScheduleSlot {
  return {
    token,
    label: token,
    description: token,
    group: "FLEX",
    projectable: true,
    order,
  };
}

function group(players: (LineupPlayer | null)[]): LineupGroup {
  return {
    group: "FLEX",
    label: "Flex",
    entries: players.map((p, i) => ({ slot: slot("FLEX", i), player: p })),
    projected: null,
    unprojected: 0,
  };
}

describe("slot eligibility", () => {
  it("reads the league's own slot mapping rather than a copy of it", () => {
    expect(eligiblePositionsFor("FLEX")).toEqual(["RB", "WR", "TE"]);
    expect(eligiblePositionsFor("SUPER_FLEX")).toEqual(["QB", "RB", "WR", "TE"]);
    expect(eligiblePositionsFor("QB")).toEqual(["QB"]);
  });

  it("lets a superflex take a quarterback and a flex refuse one", () => {
    expect(isEligibleFor("SUPER_FLEX", "QB")).toBe(true);
    expect(isEligibleFor("FLEX", "QB")).toBe(false);
    expect(isEligibleFor("FLEX", "TE")).toBe(true);
  });

  it("treats an IDP slot as accepting nobody rather than everybody", () => {
    expect(eligiblePositionsFor("LB")).toEqual([]);
    expect(isEligibleFor("LB", "LB")).toBe(false);
  });

  it("does not blow up on a slot token we have never seen", () => {
    expect(eligiblePositionsFor("SOMETHING_NEW")).toEqual([]);
    expect(isEligibleFor("SOMETHING_NEW", "RB")).toBe(false);
  });
});

describe("swapCandidates", () => {
  const bench = [
    player({ sleeperId: "rb1", position: "RB", projected: 12, rosterSlot: "bench" }),
    player({ sleeperId: "wr1", position: "WR", projected: 15, rosterSlot: "bench" }),
    player({ sleeperId: "qb1", position: "QB", projected: 22, rosterSlot: "bench" }),
    player({ sleeperId: "ir1", position: "WR", projected: 30, rosterSlot: "reserve" }),
    player({ sleeperId: "tx1", position: "RB", projected: 28, rosterSlot: "taxi" }),
    player({ sleeperId: "none", position: "WR", projected: null, rosterSlot: "bench" }),
  ];

  it("offers only bench players the slot can legally hold, best first", () => {
    expect(swapCandidates(bench, "FLEX").map((p) => p.sleeperId)).toEqual(["wr1", "rb1"]);
  });

  it("lets a superflex reach the quarterback", () => {
    expect(swapCandidates(bench, "SUPER_FLEX").map((p) => p.sleeperId)).toEqual([
      "qb1",
      "wr1",
      "rb1",
    ]);
  });

  it("never offers injured reserve or the taxi squad, however good they are", () => {
    const ids = swapCandidates(bench, "FLEX").map((p) => p.sleeperId);
    expect(ids).not.toContain("ir1");
    expect(ids).not.toContain("tx1");
  });

  it("drops a player with no projection rather than treating him as a zero", () => {
    expect(swapCandidates(bench, "FLEX").map((p) => p.sleeperId)).not.toContain("none");
  });

  it("counts exactly what it would have listed", () => {
    // The board decides whether a slot gets a button from the count and then
    // the dialog fills itself from the list. If the two ever disagree, a slot
    // opens a panel that says nobody is available.
    for (const token of ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "LB", "NEW"]) {
      expect(countSwapCandidates(bench, token)).toBe(swapCandidates(bench, token).length);
    }
  });
});

describe("baselineSigma", () => {
  it("adds variances, not spreads", () => {
    const groups = [
      group([
        player({ sleeperId: "a", position: "RB", projected: 10, sigma: 3 }),
        player({ sleeperId: "b", position: "WR", projected: 10, sigma: 4 }),
      ]),
    ];
    expect(baselineSigma(groups)).toBeCloseTo(5, 10);
  });

  it("counts nothing for a slot with no projection, matching the total", () => {
    const groups = [
      group([
        player({ sleeperId: "a", position: "RB", projected: 10, sigma: 3 }),
        player({ sleeperId: "b", position: "LB", projected: null, sigma: 9 }),
        null,
      ]),
    ];
    expect(baselineSigma(groups)).toBeCloseTo(3, 10);
  });
});

describe("simulateSwap", () => {
  const baseline: LineupBaseline = {
    setTotal: 100,
    optimalTotal: 110,
    sigma: 20,
    opponent: { mean: 100, sigma: 20 },
  };

  it("moves the total by exactly the difference between the two players", () => {
    const impact = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 8, sigma: 4 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 4 }),
    });
    expect(impact?.pointsBefore).toBe(100);
    expect(impact?.pointsAfter).toBe(106);
    expect(impact?.pointsDelta).toBe(6);
  });

  it("adds the incoming player's whole projection to an empty slot", () => {
    const impact = simulateSwap({
      baseline,
      outPlayer: null,
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 4 }),
    });
    expect(impact?.pointsAfter).toBe(114);
  });

  it("closes the gap to the best lineup by the same amount it adds", () => {
    const impact = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 8, sigma: 4 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 4 }),
    });
    expect(impact?.gapBefore).toBe(10);
    expect(impact?.gapAfter).toBe(4);
    expect(impact?.gapDelta).toBe(-6);
  });

  it("never reports a negative gap, because the optimum cannot be beaten", () => {
    const impact = simulateSwap({
      baseline: { ...baseline, setTotal: 108, optimalTotal: 110 },
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 1, sigma: 1 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 40, sigma: 1 }),
    });
    expect(impact?.gapAfter).toBe(0);
  });

  it("raises the win probability when the swap adds points", () => {
    const impact = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 8, sigma: 4 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 4 }),
    });
    expect(impact?.winProbBefore).toBeCloseTo(0.5, 6);
    expect(impact?.winProbAfter ?? 0).toBeGreaterThan(0.5);
    expect(impact?.winProbDelta ?? 0).toBeGreaterThan(0);
  });

  it("reports no win probability at all rather than a fabricated one", () => {
    const impact = simulateSwap({
      baseline: { ...baseline, opponent: null },
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 8, sigma: 4 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 4 }),
    });
    expect(impact?.winProbBefore).toBeNull();
    expect(impact?.winProbAfter).toBeNull();
    expect(impact?.winProbDelta).toBeNull();
    // The points still answer, which is the whole reason it is three
    // independent figures rather than one verdict.
    expect(impact?.pointsDelta).toBe(6);
  });

  it("takes a swingier player as a real change in spread, not just in points", () => {
    const steady = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 10, sigma: 5 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 10, sigma: 5 }),
    });
    const swingy = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 10, sigma: 5 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 10, sigma: 15 }),
    });
    // Same points either way, and against an even opponent both are coin
    // flips: more variance cannot help a team that is already level.
    expect(steady?.pointsDelta).toBe(0);
    expect(swingy?.pointsDelta).toBe(0);
    expect(swingy?.winProbAfter).toBeCloseTo(0.5, 6);
  });

  it("makes an underdog better off for taking on variance", () => {
    const behind: LineupBaseline = {
      setTotal: 90,
      optimalTotal: 110,
      sigma: 10,
      opponent: { mean: 110, sigma: 10 },
    };
    const steady = simulateSwap({
      baseline: behind,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 10, sigma: 5 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 10, sigma: 5 }),
    });
    const swingy = simulateSwap({
      baseline: behind,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: 10, sigma: 5 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 10, sigma: 20 }),
    });
    expect(swingy?.winProbAfter ?? 0).toBeGreaterThan(steady?.winProbAfter ?? 0);
  });

  it("removes no variance for an outgoing player who had no projection", () => {
    const impact = simulateSwap({
      baseline,
      outPlayer: player({ sleeperId: "out", position: "RB", projected: null, sigma: 9 }),
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 0 }),
    });
    // He contributed nothing to the total, so he contributed nothing to the
    // spread either. 20^2 - 0 + 0 = 400.
    expect(impact?.pointsAfter).toBe(114);
    expect(impact?.winProbAfter).toBeCloseTo(
      simulateSwap({
        baseline,
        outPlayer: null,
        inPlayer: player({ sleeperId: "in", position: "RB", projected: 14, sigma: 0 }),
      })?.winProbAfter ?? -1,
      10,
    );
  });

  it("refuses to answer with no baseline rather than answering from zero", () => {
    expect(
      simulateSwap({
        baseline: { ...baseline, setTotal: null },
        outPlayer: null,
        inPlayer: player({ sleeperId: "in", position: "RB", projected: 14 }),
      }),
    ).toBeNull();
  });

  it("refuses to answer for an incoming player with no projection", () => {
    expect(
      simulateSwap({
        baseline,
        outPlayer: null,
        inPlayer: player({ sleeperId: "in", position: "RB", projected: null }),
      }),
    ).toBeNull();
  });

  it("reports no gap when there is no best lineup to compare against", () => {
    const impact = simulateSwap({
      baseline: { ...baseline, optimalTotal: null },
      outPlayer: null,
      inPlayer: player({ sleeperId: "in", position: "RB", projected: 14 }),
    });
    expect(impact?.gapBefore).toBeNull();
    expect(impact?.gapAfter).toBeNull();
    expect(impact?.gapDelta).toBeNull();
  });
});

describe("direction bands", () => {
  it("calls a twentieth of a point no change rather than an improvement", () => {
    expect(pointsDirection(0.04)).toBe("flat");
    expect(pointsDirection(-0.04)).toBe("flat");
    expect(pointsDirection(0.6)).toBe("up");
    expect(pointsDirection(-0.6)).toBe("down");
  });

  it("does the same for a probability at half a percentage point", () => {
    expect(probabilityDirection(0.004)).toBe("flat");
    expect(probabilityDirection(0.02)).toBe("up");
    expect(probabilityDirection(-0.02)).toBe("down");
    expect(probabilityDirection(null)).toBe("flat");
  });
});
