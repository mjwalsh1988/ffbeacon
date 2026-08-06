import { describe, it, expect } from "vitest";
import { computeLineupSwap, type LineupSwapInput, type CandidateWeek } from "./marginal";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";

/** A one-QB, two-RB, one-FLEX league. Small enough to reason about by hand. */
const SLOTS = ["QB", "RB", "RB", "FLEX"];

function player(
  playerId: string,
  position: LineupCandidate["position"],
  points: number,
): LineupCandidate {
  return { playerId, position, points, sigma: points * 0.5 };
}

function weeksOf(
  weeks: number[],
  roster: LineupCandidate[],
): Map<number, LineupCandidate[]> {
  return new Map(weeks.map((w) => [w, roster.map((p) => ({ ...p }))]));
}

function candidateWeeks(weeks: number[], points: number): Map<number, CandidateWeek> {
  return new Map(
    weeks.map((w) => [
      w,
      { points, sigma: points * 0.5, opponent: "BUF", opponentMultiplier: 1 },
    ]),
  );
}

function baseInput(overrides: Partial<LineupSwapInput> = {}): LineupSwapInput {
  const weeks = [5, 6, 7];
  const roster = [
    player("qb1", "QB", 18),
    player("rb1", "RB", 14),
    player("rb2", "RB", 10),
    player("wr1", "WR", 9),
    player("wr2", "WR", 2),
  ];
  return {
    slots: SLOTS,
    weeks,
    rosterByWeek: weeksOf(weeks, roster),
    candidateByWeek: candidateWeeks(weeks, 12),
    candidatePlayerId: "new1",
    candidatePosition: "RB",
    rosterMeta: new Map([
      ["qb1", { name: "Quarterback One", position: "QB" }],
      ["rb1", { name: "Back One", position: "RB" }],
      ["rb2", { name: "Back Two", position: "RB" }],
      ["wr1", { name: "Receiver One", position: "WR" }],
      ["wr2", { name: "Receiver Two", position: "WR" }],
    ]),
    mustDrop: false,
    ...overrides,
  };
}

describe("computeLineupSwap", () => {
  it("reports a bench-only player as adding nothing", () => {
    // Roster already starts QB 18, RB 14, RB 10, FLEX 9. A 3-point candidate
    // cannot displace anyone, so the honest answer is zero, not a small number.
    const result = computeLineupSwap(
      baseInput({ candidateByWeek: candidateWeeks([5, 6, 7], 3) }),
    );
    expect(result.isBenchOnly).toBe(true);
    expect(result.weeksStarting).toBe(0);
    expect(result.netPointsPerWeek).toBeCloseTo(0, 6);
  });

  it("measures the real lineup gain, not the player's raw projection", () => {
    // The candidate scores 12. He displaces the 9-point FLEX, so the lineup
    // gains 3, not 12. Pricing him at 12 is the mistake this whole test exists
    // to prevent.
    const result = computeLineupSwap(baseInput());
    expect(result.weeksStarting).toBe(3);
    expect(result.pointsPerWeek).toBeCloseTo(3, 6);
  });

  it("charges the drop when the roster is full", () => {
    // wr2 projects 2 points and never starts, so cutting him costs nothing and
    // the net gain equals the gross gain.
    const result = computeLineupSwap(baseInput({ mustDrop: true }));
    expect(result.dropCost?.playerId).toBe("wr2");
    expect(result.dropCost?.pointsPerWeek).toBeCloseTo(0, 6);
    expect(result.netPointsPerWeek).toBeCloseTo(result.pointsPerWeek, 6);
  });

  it("picks the cheapest drop by lineup cost, not by raw points", () => {
    // The backup QB projects 16, more than the 9-point WR, but a one-QB league
    // never starts him, so he is the correct cut. Sorting by raw points would
    // cut the receiver and cost the manager real points.
    const weeks = [5];
    const roster = [
      player("qb1", "QB", 18),
      player("qb2", "QB", 16),
      player("rb1", "RB", 14),
      player("rb2", "RB", 10),
      player("wr1", "WR", 9),
    ];
    const result = computeLineupSwap(
      baseInput({
        weeks,
        rosterByWeek: weeksOf(weeks, roster),
        candidateByWeek: candidateWeeks(weeks, 12),
        mustDrop: true,
        rosterMeta: new Map([
          ["qb1", { name: "Starter QB", position: "QB" }],
          ["qb2", { name: "Backup QB", position: "QB" }],
          ["rb1", { name: "Back One", position: "RB" }],
          ["rb2", { name: "Back Two", position: "RB" }],
          ["wr1", { name: "Receiver One", position: "WR" }],
        ]),
      }),
    );
    expect(result.dropCost?.playerId).toBe("qb2");
  });

  it("counts a bye as an absent week rather than a zero", () => {
    // Week 6 has no projection. He still starts weeks 5 and 7, and the average
    // must not be dragged down by pretending he scored zero on his bye.
    const weeks = [5, 6, 7];
    const partial = new Map<number, CandidateWeek>([
      [5, { points: 12, sigma: 6, opponent: "BUF", opponentMultiplier: 1 }],
      [7, { points: 12, sigma: 6, opponent: "MIA", opponentMultiplier: 1 }],
    ]);
    const result = computeLineupSwap(
      baseInput({ weeks, candidateByWeek: partial }),
    );
    expect(result.weeksStarting).toBe(2);
    expect(result.weeks.find((w) => w.week === 6)?.startsForYou).toBe(false);
    // Two weeks at +3, one at 0, averaged over three weeks.
    expect(result.netPointsPerWeek).toBeCloseTo(2, 6);
  });

  it("produces weekly distributions for both scenarios", () => {
    const result = computeLineupSwap(baseInput());
    expect([...result.weeklyBefore.keys()]).toEqual([5, 6, 7]);
    expect([...result.weeklyAfter.keys()]).toEqual([5, 6, 7]);
    const before = result.weeklyBefore.get(5)!;
    const after = result.weeklyAfter.get(5)!;
    expect(after.mean).toBeGreaterThan(before.mean);
  });
});
