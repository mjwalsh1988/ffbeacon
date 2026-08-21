import { describe, it, expect } from "vitest";
import { computeRosterSwap, type RosterSwapInput } from "./roster-swap";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";

/** One QB, two RB, one FLEX. Small enough to check the lineup by hand. */
const SLOTS = ["QB", "RB", "RB", "FLEX"];
const WEEKS = [10, 11, 12];

function player(
  playerId: string,
  position: LineupCandidate["position"],
  points: number,
): LineupCandidate {
  return { playerId, position, points, sigma: points * 0.5 };
}

/** The same roster every week, copied so no test can share an object. */
function everyWeek(
  weeks: number[],
  candidates: LineupCandidate[],
): Map<number, LineupCandidate[]> {
  return new Map(weeks.map((w) => [w, candidates.map((c) => ({ ...c }))]));
}

const ROSTER = [
  player("qb1", "QB", 18),
  player("rb1", "RB", 14),
  player("rb2", "RB", 10),
  player("wr1", "WR", 9),
  player("wr2", "WR", 2),
];

// Starters: qb1 18, rb1 14, rb2 10, wr1 9 in the FLEX. Total 51. wr2 is benched.
const BASE_TOTAL = 51;

function input(overrides: Partial<RosterSwapInput> = {}): RosterSwapInput {
  return {
    slots: SLOTS,
    weeks: WEEKS,
    rosterByWeek: everyWeek(WEEKS, ROSTER),
    incomingByWeek: new Map(),
    outgoingPlayerIds: [],
    ...overrides,
  };
}

describe("computeRosterSwap", () => {
  it("reports zero when nothing moves", () => {
    const result = computeRosterSwap(input());
    expect(result.meanBefore).toBe(BASE_TOTAL);
    expect(result.meanAfter).toBe(BASE_TOTAL);
    expect(result.delta).toBe(0);
    expect(result.weeksImproved).toBe(0);
    expect(result.weeksWorsened).toBe(0);
    expect(result.incomingStartWeeks).toEqual({});
  });

  it("covers every requested week in both distributions", () => {
    const result = computeRosterSwap(input());
    expect([...result.weeklyBefore.keys()]).toEqual(WEEKS);
    expect([...result.weeklyAfter.keys()]).toEqual(WEEKS);
    expect(result.weeks.map((w) => w.week)).toEqual(WEEKS);
    for (const week of WEEKS) {
      expect(result.weeklyBefore.get(week)!.mean).toBe(BASE_TOTAL);
      expect(result.weeklyBefore.get(week)!.sigma).toBeGreaterThan(0);
      expect(result.weeklyAfter.get(week)!.mean).toBe(BASE_TOTAL);
    }
  });

  it("handles two in and two out", () => {
    // Out: rb1 (14, starting) and wr2 (2, benched). In: rb3 (20) and wr3 (16).
    // After: qb1 18, rb3 20, rb2 10, wr3 16 in the FLEX. Total 64.
    const result = computeRosterSwap(
      input({
        outgoingPlayerIds: ["rb1", "wr2"],
        incomingByWeek: everyWeek(WEEKS, [
          player("rb3", "RB", 20),
          player("wr3", "WR", 16),
        ]),
      }),
    );

    expect(result.meanAfter).toBe(64);
    expect(result.delta).toBe(13);
    expect(result.weeksImproved).toBe(WEEKS.length);
    expect(result.weeksWorsened).toBe(0);
    expect(result.incomingStartWeeks).toEqual({ rb3: 3, wr3: 3 });
    for (const week of result.weeks) {
      expect(week.startingIncoming.sort()).toEqual(["rb3", "wr3"]);
      expect(week.afterTotal - week.beforeTotal).toBe(week.delta);
    }
  });

  it("charges nothing for an outgoing bench player", () => {
    // wr2 projects 2 and never starts, so sending him costs the lineup nothing.
    const result = computeRosterSwap(input({ outgoingPlayerIds: ["wr2"] }));
    expect(result.meanAfter).toBe(BASE_TOTAL);
    expect(result.delta).toBe(0);
    expect(result.weeksWorsened).toBe(0);
  });

  it("charges the real cost for an outgoing starter", () => {
    // rb1 (14) leaves and there is no third back, so the second RB slot goes
    // empty. After: qb1 18, rb2 10 at RB, wr1 9 in the FLEX. Total 37.
    const result = computeRosterSwap(input({ outgoingPlayerIds: ["rb1"] }));
    expect(result.meanAfter).toBe(18 + 10 + 9);
    expect(result.delta).toBe(37 - BASE_TOTAL);
    expect(result.weeksWorsened).toBe(WEEKS.length);
    expect(result.weeksImproved).toBe(0);
  });

  it("returns delta 0 when the arrival never displaces anyone", () => {
    const result = computeRosterSwap(
      input({ incomingByWeek: everyWeek(WEEKS, [player("rb9", "RB", 3)]) }),
    );
    expect(result.delta).toBe(0);
    expect(result.weeksImproved).toBe(0);
    expect(result.weeksWorsened).toBe(0);
    // Projected but never starting, which is a measured zero rather than silence.
    expect(result.incomingStartWeeks).toEqual({ rb9: 0 });
  });

  it("keeps an incoming player out of incomingStartWeeks when he has no projections", () => {
    const result = computeRosterSwap(
      input({
        incomingByWeek: new Map(),
        outgoingPlayerIds: ["wr2"],
      }),
    );
    expect(result.incomingStartWeeks).not.toHaveProperty("ghost");
    expect(result.incomingStartWeeks).toEqual({});
  });

  it("counts only the weeks an arrival is actually projected for", () => {
    // Projected in week 10 alone. Weeks 11 and 12 are a bye, not a zero, so the
    // lineup those weeks is exactly what it was before.
    const result = computeRosterSwap(
      input({
        incomingByWeek: new Map([[10, [player("rb3", "RB", 25)]]]),
      }),
    );
    expect(result.incomingStartWeeks).toEqual({ rb3: 1 });
    expect(result.weeks[0].startingIncoming).toEqual(["rb3"]);
    expect(result.weeks[1].startingIncoming).toEqual([]);
    expect(result.weeks[1].afterTotal).toBe(BASE_TOTAL);
    expect(result.weeks[2].afterTotal).toBe(BASE_TOTAL);
    expect(result.weeksImproved).toBe(1);
  });

  it("uses the mean across every week for the headline delta", () => {
    const result = computeRosterSwap(
      input({
        incomingByWeek: new Map([[10, [player("rb3", "RB", 25)]]]),
      }),
    );
    // Week 10: rb3 (25) and rb1 (14) take the RB slots, rb2 (10) beats wr1 (9)
    // to the FLEX, so the lineup goes 51 to 67. The other two weeks gain
    // nothing, so the headline delta is 16 / 3.
    const gains = result.weeks.map((w) => w.delta);
    expect(gains[0]).toBe(16);
    expect(gains[1]).toBe(0);
    expect(gains[2]).toBe(0);
    expect(result.delta).toBeCloseTo(gains[0] / 3, 10);
  });
});
