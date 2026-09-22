import { describe, it, expect } from "vitest";
import { buildOpportunity, opportunitySwing, type StatLine } from "./opportunity";

function line(week: number, over: Partial<StatLine> = {}): StatLine {
  return {
    week,
    targets: 0,
    carries: 0,
    offSnaps: null,
    teamOffSnaps: null,
    points: 0,
    gamesPlayed: 1,
    ...over,
  };
}

describe("buildOpportunity", () => {
  it("reads the newest week and averages every week before it", () => {
    const o = buildOpportunity(
      [
        line(1, { targets: 2, carries: 0 }),
        line(2, { targets: 4, carries: 0 }),
        line(3, { targets: 12, carries: 0 }),
      ],
      4,
    );
    expect(o.lastWeek).toBe(3);
    expect(o.lastTouches).toBe(12);
    expect(o.priorTouches).toBe(3);
    expect(o.touchDelta).toBe(9);
    expect(o.weeksPlayed).toBe(3);
  });

  it("counts targets and carries together, because a back who catches passes is doing both", () => {
    const o = buildOpportunity([line(1, { targets: 5, carries: 11 })], 2);
    expect(o.lastTouches).toBe(16);
  });

  it("never quotes the board's own week, so a Tuesday page does not change on Sunday", () => {
    const o = buildOpportunity(
      [line(3, { targets: 4 }), line(4, { targets: 40 })],
      4,
    );
    expect(o.lastWeek).toBe(3);
    expect(o.lastTouches).toBe(4);
  });

  it("skips a week the player missed rather than averaging in a zero he never played", () => {
    const o = buildOpportunity(
      [
        line(1, { targets: 8 }),
        line(2, { targets: 0, gamesPlayed: 0 }),
        line(3, { targets: 10 }),
      ],
      4,
    );
    expect(o.weeksPlayed).toBe(2);
    expect(o.priorTouches).toBe(8);
    expect(o.touchDelta).toBe(2);
  });

  it("returns nulls, never zeroes, for a player with no lines at all", () => {
    const o = buildOpportunity([], 4);
    expect(o.lastTouches).toBeNull();
    expect(o.lastWeek).toBeNull();
    expect(o.priorTouches).toBeNull();
    expect(o.touchDelta).toBeNull();
    expect(o.weeksPlayed).toBe(0);
  });

  it("has no baseline from a single week, so no delta is claimed", () => {
    const o = buildOpportunity([line(1, { targets: 9 })], 2);
    expect(o.lastTouches).toBe(9);
    expect(o.priorTouches).toBeNull();
    expect(o.touchDelta).toBeNull();
  });

  it("sorts unordered input rather than trusting the query's order", () => {
    const o = buildOpportunity(
      [line(3, { targets: 9 }), line(1, { targets: 1 }), line(2, { targets: 3 })],
      4,
    );
    expect(o.lastWeek).toBe(3);
    expect(o.priorTouches).toBe(2);
  });

  describe("snap share, which Sleeper publishes a week late", () => {
    it("falls back to the newest week that actually carries one", () => {
      const o = buildOpportunity(
        [
          line(1, { offSnaps: 20, teamOffSnaps: 60 }),
          line(2, { offSnaps: 42, teamOffSnaps: 60 }),
          line(3, { offSnaps: null, teamOffSnaps: null }),
        ],
        4,
      );
      expect(o.snapPct).toBe(70);
      expect(o.snapWeek).toBe(2);
      // The touch read is still on the newest week. The two are allowed to
      // disagree about which week they describe, and both say so.
      expect(o.lastWeek).toBe(3);
    });

    it("is null when nothing published one, not zero", () => {
      const o = buildOpportunity([line(1), line(2)], 3);
      expect(o.snapPct).toBeNull();
      expect(o.snapWeek).toBeNull();
    });

    it("refuses to divide by a zero team-snap count", () => {
      const o = buildOpportunity([line(1, { offSnaps: 5, teamOffSnaps: 0 })], 2);
      expect(o.snapPct).toBeNull();
    });
  });

  it("carries last week's actual points through untouched", () => {
    const o = buildOpportunity([line(1, { points: 18.44 })], 2);
    expect(o.lastPoints).toBe(18.4);
  });
});

describe("opportunitySwing", () => {
  const base = buildOpportunity([], 2);

  it("is zero without a baseline, so one appearance is not a breakout", () => {
    expect(opportunitySwing({ ...base, lastTouches: 14, touchDelta: null })).toBe(0);
  });

  it("is zero when the role shrank", () => {
    expect(opportunitySwing({ ...base, priorTouches: 12, touchDelta: -5 })).toBe(0);
  });

  it("scales up to a full role change at six extra touches", () => {
    expect(opportunitySwing({ ...base, priorTouches: 2, touchDelta: 3 })).toBe(0.5);
    expect(opportunitySwing({ ...base, priorTouches: 2, touchDelta: 6 })).toBe(1);
  });

  it("caps, so one blowout cannot outrank everything else on the board", () => {
    expect(opportunitySwing({ ...base, priorTouches: 2, touchDelta: 25 })).toBe(1);
  });
});
