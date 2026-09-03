import { describe, expect, it } from "vitest";
import type { ScheduleSlot } from "@/lib/league-schedule/types";
import { buildWeekRecap, playerSwings, SWING_THRESHOLD } from "./recap";
import type { LineupGroup, LineupOptimization, LineupPlayer, RosterSlotKind } from "./types";

function player(
  over: Partial<LineupPlayer> & { sleeperId: string },
): LineupPlayer {
  return {
    playerId: `uuid-${over.sleeperId}`,
    name: `Player ${over.sleeperId}`,
    position: "RB",
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
    actual: 10,
    isInactive: false,
    rosterSlot: "starter" as RosterSlotKind,
    startingSlotLabel: "RB",
    startingSlotOrder: 0,
    positionalWar: null,
    positionalWarRank: null,
    positionalWarPoolSize: null,
    environment: null,
    environmentTier: null,
    ...over,
  };
}

function slot(order: number): ScheduleSlot {
  return {
    token: "RB",
    label: "RB",
    description: "running back",
    group: "RB",
    projectable: true,
    order,
  };
}

function groups(players: (LineupPlayer | null)[]): LineupGroup[] {
  return [
    {
      group: "RB",
      label: "Running backs",
      entries: players.map((p, i) => ({ slot: slot(i), player: p })),
      projected: null,
      unprojected: 0,
    },
  ];
}

function optimization(over: Partial<LineupOptimization> = {}): LineupOptimization {
  return {
    setTotal: 100,
    optimalTotal: 110,
    pointsLeftOnBench: 10,
    efficiency: 0.9,
    moves: [],
    unlistedGain: 0,
    ungradedSlotCount: 0,
    unavailable: false,
    ...over,
  };
}

describe("playerSwings", () => {
  it("needs both numbers, so a player with a score and no projection is left out", () => {
    const swings = playerSwings(
      groups([
        player({ sleeperId: "a", projected: 10, actual: 18 }),
        player({ sleeperId: "b", projected: null, actual: 22 }),
        player({ sleeperId: "c", projected: 14, actual: null }),
        null,
      ]),
    );
    expect(swings.map((s) => s.player.sleeperId)).toEqual(["a"]);
    expect(swings[0].diff).toBe(8);
  });

  it("counts a player once even when two slots somehow name him", () => {
    const dupe = player({ sleeperId: "a", projected: 10, actual: 18 });
    const swings = playerSwings(groups([dupe, dupe]));
    expect(swings).toHaveLength(1);
  });
});

describe("buildWeekRecap", () => {
  it("puts the best lineup on the OFFICIAL basis, not the gradable one", () => {
    // The optimiser measures over the slots it can grade. Adding its deficit to
    // Sleeper's own total is what keeps "best you had" from printing a figure
    // LOWER than the score beside it in an IDP league.
    const recap = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ optimalTotal: 90, pointsLeftOnBench: 12 }),
      actualTotal: 130,
      opponentActual: null,
    });
    expect(recap.bestPossible).toBe(142);
    expect(recap.leftOnBench).toBe(12);
  });

  it("says the bench cost the game only when it actually would have won it", () => {
    const lost = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ pointsLeftOnBench: 20 }),
      actualTotal: 100,
      opponentActual: 110,
    });
    expect(lost.outcome).toBe("loss");
    expect(lost.bestOutcome).toBe("win");
    expect(lost.costTheGame).toBe(true);

    const stillLost = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ pointsLeftOnBench: 4 }),
      actualTotal: 100,
      opponentActual: 110,
    });
    expect(stillLost.costTheGame).toBe(false);
  });

  it("never claims a win was cost, and never counts a draw as one", () => {
    const won = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ pointsLeftOnBench: 30 }),
      actualTotal: 120,
      opponentActual: 110,
    });
    expect(won.costTheGame).toBe(false);

    const tied = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ pointsLeftOnBench: 30 }),
      actualTotal: 110,
      opponentActual: 110,
    });
    expect(tied.outcome).toBe("tie");
    expect(tied.costTheGame).toBe(false);
  });

  it("reports no result at all for an unpaired week rather than a loss", () => {
    const recap = buildWeekRecap({
      groups: groups([]),
      optimization: optimization(),
      actualTotal: 100,
      opponentActual: null,
    });
    expect(recap.outcome).toBeNull();
    expect(recap.bestOutcome).toBeNull();
    expect(recap.margin).toBeNull();
    expect(recap.costTheGame).toBe(false);
  });

  it("holds back a swing inside the noise, and keeps one outside it", () => {
    const recap = buildWeekRecap({
      groups: groups([
        player({ sleeperId: "noise", projected: 10, actual: 10 + SWING_THRESHOLD - 0.1 }),
        player({ sleeperId: "real", projected: 10, actual: 10 + SWING_THRESHOLD + 5 }),
        player({ sleeperId: "bad", projected: 18, actual: 2 }),
      ]),
      optimization: optimization(),
      actualTotal: 100,
      opponentActual: 90,
    });
    expect(recap.overperformers.map((s) => s.player.sleeperId)).toEqual(["real"]);
    expect(recap.underperformers.map((s) => s.player.sleeperId)).toEqual(["bad"]);
    // The count is over everybody measurable, not only the ones named.
    expect(recap.measuredCount).toBe(3);
    expect(recap.beatCount).toBe(2);
  });

  it("orders each list by how big the miss was", () => {
    const recap = buildWeekRecap({
      groups: groups([
        player({ sleeperId: "small", projected: 10, actual: 15 }),
        player({ sleeperId: "big", projected: 10, actual: 30 }),
        player({ sleeperId: "mid", projected: 10, actual: 20 }),
      ]),
      optimization: optimization(),
      actualTotal: 100,
      opponentActual: 90,
    });
    expect(recap.overperformers.map((s) => s.player.sleeperId)).toEqual([
      "big",
      "mid",
      "small",
    ]);
  });

  it("reports nothing rather than a zero when the week has not settled", () => {
    const recap = buildWeekRecap({
      groups: groups([]),
      optimization: optimization(),
      actualTotal: null,
      opponentActual: null,
    });
    expect(recap.scored).toBeNull();
    expect(recap.bestPossible).toBeNull();
    expect(recap.efficiency).toBeNull();
    expect(recap.outcome).toBeNull();
  });

  it("caps efficiency at 1 rather than reporting a lineup that beat the optimum", () => {
    const recap = buildWeekRecap({
      groups: groups([]),
      optimization: optimization({ pointsLeftOnBench: 0 }),
      actualTotal: 100,
      opponentActual: null,
    });
    expect(recap.efficiency).toBe(1);
  });
});
