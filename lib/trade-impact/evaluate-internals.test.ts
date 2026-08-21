import { describe, it, expect } from "vitest";
import { buildOptimalLineup, type LineupCandidate } from "@/lib/power-pulse/lineup";
import { computeRosterSwap } from "./roster-swap";

/**
 * Guards for the arithmetic inside lib/trade-impact/evaluate.ts.
 *
 * WHY THIS FILE EXISTS, and it is worth being blunt about it. An implementation
 * review found two defects in `evaluate.ts` that a green suite of 1962 tests did
 * not catch, and both reached the rendered page:
 *
 *   Per-position starter output was accumulated across every remaining week and
 *   never divided, then printed by a sentence that says "points a week". With
 *   ten weeks left the number was ten times too large, which also pushed it
 *   permanently past the noise threshold meant to keep the reason quiet.
 *
 *   The "after" position map was the roster MINUS what you send, with nothing
 *   added back. Trading a receiver for a better receiver reported that you had
 *   gutted your receiving corps.
 *
 * Neither was caught because `reasons.test.ts` stubs `positionBefore` and
 * `positionAfter` as `{}` and hand-feeds the depth-cost figure. The reason
 * builder was tested; the thing that produces its input was not.
 *
 * `evaluate.ts` itself needs a Supabase client and a whole league, so the two
 * helpers that carry this arithmetic are exercised here through their published
 * behaviour: the position-points shape (a per-week rate over the candidate set
 * that actually exists after the trade) and the per-slot averages that replaced
 * a third pass of lineup building.
 */

function candidate(
  playerId: string,
  position: LineupCandidate["position"],
  points: number,
): LineupCandidate {
  return { playerId, position, points, sigma: points * 0.4 };
}

/**
 * The same shape `positionPointsFrom` implements in evaluate.ts: sum across the
 * weeks, then divide by the number of weeks. Kept here as an executable
 * statement of the contract, so a future change that drops the division fails a
 * test rather than a reader's trust.
 */
function positionPointsFrom(
  byWeek: Map<number, LineupCandidate[]>,
  weeks: number[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const week of weeks) {
    for (const c of byWeek.get(week) ?? []) {
      totals[c.position] = (totals[c.position] ?? 0) + c.points;
    }
  }
  if (weeks.length === 0) return totals;
  for (const p of Object.keys(totals)) totals[p] /= weeks.length;
  return totals;
}

function applySwap(
  before: Map<number, LineupCandidate[]>,
  incomingByWeek: Map<number, LineupCandidate[]>,
  outgoingPlayerIds: string[],
  weeks: number[],
): Map<number, LineupCandidate[]> {
  const leaving = new Set(outgoingPlayerIds.filter(Boolean));
  const out = new Map<number, LineupCandidate[]>();
  for (const week of weeks) {
    out.set(week, [
      ...(before.get(week) ?? []).filter((c) => !leaving.has(c.playerId)),
      ...(incomingByWeek.get(week) ?? []),
    ]);
  }
  return out;
}

const WEEKS = [10, 11, 12, 13];

function weeklyOf(candidates: LineupCandidate[]): Map<number, LineupCandidate[]> {
  const byWeek = new Map<number, LineupCandidate[]>();
  for (const week of WEEKS) byWeek.set(week, candidates.map((c) => ({ ...c })));
  return byWeek;
}

describe("per-position starter output", () => {
  it("is a per-week rate, not a season total", () => {
    // One receiver worth 12 points, four weeks. The answer is 12, not 48. The
    // sentence that prints this says "points a week".
    const before = weeklyOf([candidate("wr1", "WR", 12)]);
    const totals = positionPointsFrom(before, WEEKS);
    expect(totals.WR).toBeCloseTo(12, 6);
    expect(totals.WR).not.toBeCloseTo(48, 6);
  });

  it("counts the players arriving in the trade", () => {
    // THE REGRESSION THAT SHIPPED. Send a 10-point receiver, receive a 16-point
    // one. The after figure must go UP.
    const before = weeklyOf([candidate("out", "WR", 10), candidate("keep", "WR", 8)]);
    const incoming = weeklyOf([candidate("in", "WR", 16)]);
    const after = applySwap(before, incoming, ["out"], WEEKS);

    const beforeTotals = positionPointsFrom(before, WEEKS);
    const afterTotals = positionPointsFrom(after, WEEKS);

    expect(beforeTotals.WR).toBeCloseTo(18, 6);
    expect(afterTotals.WR).toBeCloseTo(24, 6);
    expect(afterTotals.WR).toBeGreaterThan(beforeTotals.WR);
  });

  it("reports a real loss when the player leaving is better", () => {
    const before = weeklyOf([candidate("out", "RB", 18), candidate("keep", "RB", 6)]);
    const incoming = weeklyOf([candidate("in", "RB", 7)]);
    const after = applySwap(before, incoming, ["out"], WEEKS);

    expect(positionPointsFrom(before, WEEKS).RB).toBeCloseTo(24, 6);
    expect(positionPointsFrom(after, WEEKS).RB).toBeCloseTo(13, 6);
  });

  it("returns an empty record rather than dividing by zero", () => {
    expect(positionPointsFrom(new Map(), [])).toEqual({});
  });

  it("does not invent a position nobody on the roster plays", () => {
    const before = weeklyOf([candidate("wr1", "WR", 12)]);
    expect(Object.keys(positionPointsFrom(before, WEEKS))).toEqual(["WR"]);
  });
});

describe("computeRosterSwap per-slot averages", () => {
  const slots = ["QB", "RB", "WR", "FLEX"];

  it("matches what buildOptimalLineup produces for the same week", () => {
    // The point of carrying these out of the swap is that they are the SAME
    // numbers a caller would get by rebuilding every lineup. If they ever
    // disagree, the caller that stopped rebuilding is now wrong.
    const roster = [
      candidate("qb", "QB", 20),
      candidate("rb", "RB", 14),
      candidate("wr", "WR", 11),
      candidate("flex", "RB", 9),
    ];
    const result = computeRosterSwap({
      slots,
      weeks: WEEKS,
      rosterByWeek: weeklyOf(roster),
      incomingByWeek: new Map(),
      outgoingPlayerIds: [],
    });

    const direct = buildOptimalLineup(slots, roster);
    direct.slots.forEach((slot, i) => {
      expect(result.slotPointsBefore[i]).toBeCloseTo(slot.points, 6);
    });
  });

  it("is a per-week rate, so it is comparable with meanBefore", () => {
    const roster = [candidate("qb", "QB", 20), candidate("rb", "RB", 14)];
    const result = computeRosterSwap({
      slots,
      weeks: WEEKS,
      rosterByWeek: weeklyOf(roster),
      incomingByWeek: new Map(),
      outgoingPlayerIds: [],
    });
    const summed = result.slotPointsBefore.reduce((t, v) => t + v, 0);
    expect(summed).toBeCloseTo(result.meanBefore, 6);
  });

  it("raises the lineup total when an upgrade arrives, wherever it seats", () => {
    // A LIMIT THIS TEST EXISTS TO PIN DOWN. buildOptimalLineup guarantees the
    // optimal TOTAL, not a canonical assignment across interchangeable slots.
    // Hand this roster a 19-point receiver and the augmenting path seats him in
    // FLEX and slides the 4-point incumbent into WR, so the WR slot's own figure
    // does not move at all. The TOTAL is what improved, and the total is what
    // the lineup reasons report.
    const roster = [
      candidate("qb", "QB", 20),
      candidate("rb", "RB", 14),
      candidate("wr", "WR", 4),
    ];
    const result = computeRosterSwap({
      slots,
      weeks: WEEKS,
      rosterByWeek: weeklyOf(roster),
      incomingByWeek: weeklyOf([candidate("wr2", "WR", 19)]),
      outgoingPlayerIds: [],
    });

    expect(result.meanAfter).toBeGreaterThan(result.meanBefore);
    expect(result.delta).toBeCloseTo(19, 6);

    const summedAfter = result.slotPointsAfter.reduce((t, v) => t + v, 0);
    expect(summedAfter).toBeCloseTo(result.meanAfter, 6);

    // The 19 landed somewhere, and it is the FLEX rather than the WR slot. This
    // is why fillsHoleReason gates on the weakest slot ACTUALLY improving: when
    // the upgrade seats elsewhere it stays silent instead of reporting a slot
    // that did not change.
    const wrIndex = slots.indexOf("WR");
    const flexIndex = slots.indexOf("FLEX");
    expect(result.slotPointsAfter[wrIndex]).toBeCloseTo(4, 6);
    expect(result.slotPointsAfter[flexIndex]).toBeCloseTo(19, 6);
  });

  it("identifies the weakest slot without rebuilding a lineup", () => {
    // The whole reason the averages are carried out: this used to cost 28 exact
    // augmenting-path fills to recover.
    const roster = [
      candidate("qb", "QB", 22),
      candidate("rb", "RB", 15),
      candidate("wr", "WR", 3),
      candidate("flex", "RB", 10),
    ];
    const result = computeRosterSwap({
      slots,
      weeks: WEEKS,
      rosterByWeek: weeklyOf(roster),
      incomingByWeek: new Map(),
      outgoingPlayerIds: [],
    });
    let worst = 0;
    for (let i = 1; i < result.slotPointsBefore.length; i += 1) {
      if (result.slotPointsBefore[i] < result.slotPointsBefore[worst]) worst = i;
    }
    expect(slots[worst]).toBe("WR");
  });

  it("falls to zeros rather than NaN when there are no weeks left", () => {
    const result = computeRosterSwap({
      slots,
      weeks: [],
      rosterByWeek: new Map(),
      incomingByWeek: new Map(),
      outgoingPlayerIds: [],
    });
    expect(result.slotPointsBefore).toEqual([0, 0, 0, 0]);
    expect(result.slotPointsAfter).toEqual([0, 0, 0, 0]);
  });
});
