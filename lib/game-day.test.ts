import { describe, it, expect } from "vitest";
import { easternDateKey, isGameDay, weekRowState } from "./game-day";

/** 2026-09-21 is a Sunday. 17:00Z is 1pm Eastern, a normal early kickoff. */
const SUNDAY_1PM_ET = "2026-09-21T17:00:00.000Z";
/** 00:15Z on the Monday is 8:15pm Eastern on the SUNDAY. */
const SUNDAY_NIGHT_ET = "2026-09-22T00:15:00.000Z";

describe("easternDateKey", () => {
  it("reads a UTC instant as its Eastern calendar day", () => {
    expect(easternDateKey(SUNDAY_1PM_ET)).toBe("2026-09-21");
  });

  it("keeps a Sunday night game on Sunday, where UTC has already rolled over", () => {
    expect(easternDateKey(SUNDAY_NIGHT_ET)).toBe("2026-09-21");
  });

  it("is null for junk rather than throwing inside a render", () => {
    expect(easternDateKey("not a date")).toBeNull();
  });
});

describe("isGameDay", () => {
  it("is true through the whole Eastern day, not just at kickoff", () => {
    // 9am Eastern, hours before a 1pm game.
    expect(isGameDay(SUNDAY_1PM_ET, new Date("2026-09-21T13:00:00.000Z"))).toBe(true);
    // 11pm Eastern, hours after it finished.
    expect(isGameDay(SUNDAY_1PM_ET, new Date("2026-09-22T03:00:00.000Z"))).toBe(true);
  });

  it("is false the next Eastern morning", () => {
    expect(isGameDay(SUNDAY_1PM_ET, new Date("2026-09-22T13:00:00.000Z"))).toBe(false);
  });

  it("is false the day before", () => {
    expect(isGameDay(SUNDAY_1PM_ET, new Date("2026-09-20T18:00:00.000Z"))).toBe(false);
  });

  it("agrees with the viewer's timezone being irrelevant", () => {
    // The same instant, expressed with an offset rather than as Z.
    expect(isGameDay("2026-09-21T13:00:00-04:00", new Date(SUNDAY_1PM_ET))).toBe(true);
  });

  it("is false without a kickoff, because an unknown time is not today", () => {
    expect(isGameDay(null, new Date(SUNDAY_1PM_ET))).toBe(false);
    expect(isGameDay(undefined, new Date(SUNDAY_1PM_ET))).toBe(false);
  });
});

describe("weekRowState", () => {
  const now = new Date(SUNDAY_1PM_ET);

  it("prefers real numbers over a spinner, even on game day", () => {
    expect(weekRowState({ hasStats: true, kickoffAt: SUNDAY_1PM_ET, now })).toBe("played");
  });

  it("marks a game being played today with nothing synced yet", () => {
    expect(weekRowState({ hasStats: false, kickoffAt: SUNDAY_1PM_ET, now })).toBe(
      "in-progress",
    );
  });

  it("leaves a future week as upcoming", () => {
    expect(
      weekRowState({ hasStats: false, kickoffAt: "2026-09-28T17:00:00.000Z", now }),
    ).toBe("upcoming");
  });

  it("treats an unknown kickoff as upcoming rather than as live", () => {
    expect(weekRowState({ hasStats: false, kickoffAt: null, now })).toBe("upcoming");
  });

  it("does not resurrect a past week we never got stats for", () => {
    expect(
      weekRowState({ hasStats: false, kickoffAt: "2026-09-14T17:00:00.000Z", now }),
    ).toBe("upcoming");
  });
});
