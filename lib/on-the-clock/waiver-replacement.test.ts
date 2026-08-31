import { describe, it, expect } from "vitest";
import {
  buildWaiverPool,
  fillFromWaivers,
  rosteredPlayerIds,
} from "./waiver-replacement";
import type { PlayerProjection, ProjectionBoard } from "./projection-board";
import type { PulsePosition } from "@/lib/power-pulse/types";

function player(
  playerId: string,
  position: PulsePosition,
  points: number,
  weeks: number[] = [1, 2],
): PlayerProjection {
  return {
    playerId,
    position,
    weeks: weeks.map((week) => ({
      week,
      points,
      sigma: points * 0.5,
      opponent: null,
      oppMult: 1,
    })),
    seasonPoints: points * weeks.length,
    pointsPerWeek: points,
    beatRate: null,
    reliability: 1,
    availability: null,
    ratioStdev: null,
    weeksPlayed: 0,
  };
}

function board(players: PlayerProjection[]): ProjectionBoard {
  return {
    version: "test",
    scoringSignature: "test",
    season: 2026,
    fromWeek: 1,
    weeks: [1, 2],
    scoringBase: "pts_ppr",
    players: Object.fromEntries(players.map((p) => [p.playerId, p])),
  };
}

const slot = (name: string, playerId: string | null = null) => ({
  slot: name,
  playerId,
  points: 0,
  sigma: 0,
});

describe("buildWaiverPool", () => {
  const b = board([
    player("te-owned", "TE", 12),
    player("te-free-1", "TE", 8),
    player("te-free-2", "TE", 6),
    player("wr-free", "WR", 10),
  ]);

  it("offers only the players nobody owns", () => {
    const pool = buildWaiverPool(b, 1, new Set(["te-owned"]));
    expect(pool.get("TE")!.map((c) => c.playerId)).toEqual([
      "te-free-1",
      "te-free-2",
    ]);
  });

  it("ranks each position best first", () => {
    const pool = buildWaiverPool(b, 1, new Set());
    expect(pool.get("TE")!.map((c) => c.playerId)).toEqual([
      "te-owned",
      "te-free-1",
      "te-free-2",
    ]);
  });

  it("drops a player who is on bye that week, because he cannot fill the hole", () => {
    const withBye = board([player("te-bye", "TE", 9, [2])]);
    expect(buildWaiverPool(withBye, 1, new Set()).get("TE") ?? []).toEqual([]);
    expect(buildWaiverPool(withBye, 2, new Set()).get("TE")).toHaveLength(1);
  });

  it("empties out when the whole position is rostered, which is the scarce case", () => {
    // A twelve-team superflex dynasty where every startable quarterback is owned.
    const pool = buildWaiverPool(
      b,
      1,
      new Set(["te-owned", "te-free-1", "te-free-2"]),
    );
    expect(pool.get("TE") ?? []).toEqual([]);
  });
});

describe("fillFromWaivers", () => {
  const pool = buildWaiverPool(
    board([
      player("te1", "TE", 8),
      player("te2", "TE", 6),
      player("wr1", "WR", 11),
    ]),
    1,
    new Set(),
  );

  it("fills an empty slot with the best eligible player available", () => {
    const result = fillFromWaivers([slot("TE")], pool);
    expect(result.slotsFilled).toBe(1);
    expect(result.pointsAdded).toBeCloseTo(8, 5);
    expect(result.signings[0].playerId).toBe("te1");
  });

  it("leaves a slot the roster already covers alone", () => {
    const result = fillFromWaivers([slot("TE", "someone")], pool);
    expect(result.slotsFilled).toBe(0);
    expect(result.pointsAdded).toBe(0);
  });

  it("does not sign the same player into two slots", () => {
    const result = fillFromWaivers([slot("TE"), slot("TE")], pool);
    expect(result.slotsFilled).toBe(2);
    expect(result.signings.map((s) => s.playerId)).toEqual(["te1", "te2"]);
    expect(result.pointsAdded).toBeCloseTo(14, 5);
  });

  it("takes the best across every position a flex allows", () => {
    const result = fillFromWaivers([slot("FLEX")], pool);
    expect(result.signings[0].playerId).toBe("wr1");
  });

  it("leaves a real zero when the position is exhausted league-wide", () => {
    // The superflex dynasty case. Nothing is available, so the slot really is
    // worth nothing and the grade should say so.
    const empty = buildWaiverPool(board([]), 1, new Set());
    const result = fillFromWaivers([slot("QB")], empty);
    expect(result.slotsFilled).toBe(0);
    expect(result.pointsAdded).toBe(0);
  });

  it("adds variance as variance, not as standard deviation", () => {
    const result = fillFromWaivers([slot("TE")], pool);
    // te1 projects 8 with sigma 4, so the variance contribution is 16.
    expect(result.varianceAdded).toBeCloseTo(16, 5);
  });
});

describe("rosteredPlayerIds", () => {
  it("unions every team's roster", () => {
    const ids = rosteredPlayerIds([
      { playerIds: ["a", "b"] },
      { playerIds: ["b", "c"] },
    ]);
    expect([...ids].sort()).toEqual(["a", "b", "c"]);
  });

  it("is empty for a draft nobody has picked in yet", () => {
    expect(rosteredPlayerIds([]).size).toBe(0);
  });
});
