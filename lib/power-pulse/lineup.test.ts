import { describe, it, expect } from "vitest";
import {
  buildOptimalLineup,
  scoreSetLineup,
  startingSlots,
  type LineupCandidate,
} from "./lineup";
import type { PulsePosition } from "./types";

function candidate(
  playerId: string,
  position: PulsePosition,
  points: number,
  sigma = 1,
): LineupCandidate {
  return { playerId, position, points, sigma };
}

describe("startingSlots", () => {
  it("drops bench, IR, and taxi slots", () => {
    expect(
      startingSlots(["QB", "RB", "RB", "WR", "FLEX", "BN", "BN", "IR", "TAXI"]),
    ).toEqual(["QB", "RB", "RB", "WR", "FLEX"]);
  });

  it("keeps kicker and defense, which Power Pulse does score", () => {
    expect(startingSlots(["QB", "K", "DEF", "BN"])).toEqual(["QB", "K", "DEF"]);
  });

  it("drops slots we cannot project rather than filling them with zero", () => {
    expect(startingSlots(["QB", "IDP_FLEX", "LB", "BN"])).toEqual(["QB"]);
  });
});

describe("buildOptimalLineup", () => {
  it("gives a superflex slot the second quarterback, not the first", () => {
    const result = buildOptimalLineup(
      ["QB", "SUPER_FLEX"],
      [candidate("qb1", "QB", 24), candidate("qb2", "QB", 19), candidate("rb1", "RB", 15)],
    );
    expect(result.total).toBeCloseTo(43, 5);
    expect(result.benched.map((c) => c.playerId)).toEqual(["rb1"]);
  });

  it("solves the overlapping-slot case that defeats plain greedy", () => {
    // WR_TE and WRRB_FLEX overlap without either containing the other.
    // Greedy in slot order takes WR1 for WR_TE and RB1 for WRRB_FLEX (32).
    // The right answer is TE1 in WR_TE and WR1 in WRRB_FLEX (35).
    const result = buildOptimalLineup(
      ["WR_TE", "WRRB_FLEX"],
      [candidate("wr1", "WR", 20), candidate("te1", "TE", 15), candidate("rb1", "RB", 12)],
    );
    expect(result.total).toBeCloseTo(35, 5);
    const bySlot = Object.fromEntries(result.slots.map((s) => [s.slot, s.playerId]));
    expect(bySlot.WR_TE).toBe("te1");
    expect(bySlot.WRRB_FLEX).toBe("wr1");
  });

  it("never starts the same player twice", () => {
    const result = buildOptimalLineup(
      ["RB", "RB", "FLEX"],
      [candidate("rb1", "RB", 20), candidate("wr1", "WR", 18)],
    );
    const ids = result.slots.map((s) => s.playerId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.total).toBeCloseTo(38, 5);
  });

  it("leaves a slot empty when nothing is eligible", () => {
    const result = buildOptimalLineup(["QB", "TE"], [candidate("qb1", "QB", 22)]);
    expect(result.total).toBeCloseTo(22, 5);
    expect(result.slots.find((s) => s.slot === "TE")?.playerId).toBeNull();
  });

  it("returns slots in the league's own order", () => {
    const result = buildOptimalLineup(
      ["QB", "RB", "WR", "FLEX"],
      [
        candidate("qb1", "QB", 22),
        candidate("rb1", "RB", 18),
        candidate("wr1", "WR", 17),
        candidate("wr2", "WR", 14),
      ],
    );
    expect(result.slots.map((s) => s.slot)).toEqual(["QB", "RB", "WR", "FLEX"]);
    expect(result.total).toBeCloseTo(71, 5);
  });

  it("benches the players who did not make the lineup", () => {
    const result = buildOptimalLineup(
      ["QB"],
      [candidate("qb1", "QB", 22), candidate("qb2", "QB", 20), candidate("rb1", "RB", 30)],
    );
    expect(result.total).toBeCloseTo(22, 5);
    expect(result.benched.map((c) => c.playerId).sort()).toEqual(["qb2", "rb1"]);
  });

  it("beats greedy on a full realistic superflex roster", () => {
    const slots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX", "SUPER_FLEX"];
    const roster: LineupCandidate[] = [
      candidate("qb1", "QB", 23),
      candidate("qb2", "QB", 18),
      candidate("rb1", "RB", 17),
      candidate("rb2", "RB", 14),
      candidate("rb3", "RB", 11),
      candidate("wr1", "WR", 19),
      candidate("wr2", "WR", 16),
      candidate("wr3", "WR", 13),
      candidate("wr4", "WR", 12),
      candidate("te1", "TE", 15),
      candidate("te2", "TE", 8),
    ];
    const result = buildOptimalLineup(slots, roster);
    // Top ten by value: 23,19,18,17,16,15,14,13,12,11 = 158, and every one of
    // them fits, so the optimum is the sum of the ten best.
    expect(result.total).toBeCloseTo(158, 5);
    expect(result.benched.map((c) => c.playerId).sort()).toEqual(["te2"]);
  });
});

describe("scoreSetLineup", () => {
  const pool = [
    candidate("a", "QB", 20, 3),
    candidate("b", "RB", 10, 4),
    candidate("c", "WR", 5, 1),
  ];

  it("scores only the players the manager actually started", () => {
    const result = scoreSetLineup(["a", "b"], pool);
    expect(result?.total).toBeCloseTo(30, 5);
    expect(result?.sigma).toBeCloseTo(5, 5);
  });

  it("treats an unprojected starter as zero, like a real bye-week mistake", () => {
    const result = scoreSetLineup(["a", "unknown"], pool);
    expect(result?.total).toBeCloseTo(20, 5);
  });

  it("returns null when there is no lineup to grade", () => {
    expect(scoreSetLineup([], pool)).toBeNull();
    expect(scoreSetLineup(["nobody"], pool)).toBeNull();
  });

  it("does not double count a duplicated starter id", () => {
    expect(scoreSetLineup(["a", "a"], pool)?.total).toBeCloseTo(20, 5);
  });
});
