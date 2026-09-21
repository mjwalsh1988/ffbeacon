import { describe, expect, it } from "vitest";
import { isChopThisWeek, resolveLeagueOutcome } from "./phase";

const BRACKET_DECIDED = [
  { r: 1, m: 1, t1: 4, t2: 8, w: 4, l: 8 },
  { r: 3, m: 6, p: 1, t1: 4, t2: 2, w: 4, l: 2 },
  { r: 3, m: 7, p: 3, t1: 1, t2: 3, w: 3, l: 1 },
];

/** The same bracket before the final was played. */
const BRACKET_PENDING = [
  { r: 1, m: 1, t1: 4, t2: 8, w: 4, l: 8 },
  { r: 3, m: 6, p: 1, t1: 4, t2: 2 },
];

function rosters(count: number, eliminated: Record<number, number> = {}) {
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    return {
      sleeperRosterId: id,
      settings: eliminated[id] ? { eliminated: eliminated[id] } : { eliminated: 0 },
    };
  });
}

describe("resolveLeagueOutcome, bracket leagues", () => {
  it("reads the champion and the runner up off the p:1 match", () => {
    const outcome = resolveLeagueOutcome({
      status: "complete",
      settings: { type: 2 },
      winnersBracket: BRACKET_DECIDED,
      rosters: rosters(8),
    });

    expect(outcome.phase).toBe("complete");
    expect(outcome.champion).toEqual({ sleeperRosterId: 4, source: "bracket" });
    expect(outcome.runnerUpRosterId).toBe(2);
    expect(outcome.chopped).toBe(false);
  });

  it("treats a decided bracket as complete even before Sleeper says so", () => {
    // The question every surface asks is "has a champion been decided", and the
    // bracket has answered it. Waiting on the status flag would leave the page
    // saying the season is live under a trophy.
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: { type: 0 },
      winnersBracket: BRACKET_DECIDED,
      rosters: rosters(8),
    });
    expect(outcome.phase).toBe("complete");
    expect(outcome.champion?.sleeperRosterId).toBe(4);
  });

  it("does not crown anyone off a final that has not been played", () => {
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: { type: 0 },
      winnersBracket: BRACKET_PENDING,
      rosters: rosters(8),
    });
    expect(outcome.phase).toBe("in_season");
    expect(outcome.champion).toBeNull();
    expect(outcome.runnerUpRosterId).toBeNull();
  });

  it("is complete with no champion when the season ended and no bracket was captured", () => {
    const outcome = resolveLeagueOutcome({
      status: "complete",
      settings: { type: 2 },
      winnersBracket: null,
      rosters: rosters(8),
    });
    expect(outcome.phase).toBe("complete");
    expect(outcome.champion).toBeNull();
  });

  it("never reads the third place game as the championship", () => {
    const outcome = resolveLeagueOutcome({
      status: "complete",
      settings: { type: 2 },
      winnersBracket: [{ r: 3, m: 7, p: 3, t1: 1, t2: 3, w: 3, l: 1 }],
      rosters: rosters(8),
    });
    expect(outcome.champion).toBeNull();
  });

  it("reports pre_draft before the draft", () => {
    const outcome = resolveLeagueOutcome({
      status: "pre_draft",
      settings: { type: 0 },
      winnersBracket: [],
      rosters: rosters(10),
    });
    expect(outcome.phase).toBe("pre_draft");
  });
});

describe("resolveLeagueOutcome, chopped leagues", () => {
  const CHOPPED = { type: 3 };

  it("lists the chops newest first and names the most recent one", () => {
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: CHOPPED,
      rosters: rosters(6, { 2: 1, 5: 3, 6: 2 }),
    });

    expect(outcome.chopped).toBe(true);
    expect(outcome.chops.map((c) => c.sleeperRosterId)).toEqual([5, 6, 2]);
    expect(outcome.latestChop).toEqual({ sleeperRosterId: 5, week: 3 });
    expect(outcome.aliveCount).toBe(3);
    expect(outcome.phase).toBe("in_season");
  });

  it("crowns the last roster standing", () => {
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: CHOPPED,
      rosters: rosters(4, { 1: 1, 2: 2, 4: 3 }),
    });
    expect(outcome.phase).toBe("complete");
    expect(outcome.champion).toEqual({
      sleeperRosterId: 3,
      source: "last_standing",
    });
  });

  it("does not crown a league that has chopped nobody", () => {
    // A one-team league that never started is not a league with a champion.
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: CHOPPED,
      rosters: rosters(1),
    });
    expect(outcome.champion).toBeNull();
    expect(outcome.phase).toBe("in_season");
  });

  it("reads a zero in `eliminated` as alive, not as week zero", () => {
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: CHOPPED,
      rosters: rosters(4),
    });
    expect(outcome.chops).toEqual([]);
    expect(outcome.aliveCount).toBe(4);
  });

  it("ignores a bracket on a chopped league", () => {
    // Sleeper can carry a stale or empty bracket on one of these. A chopped
    // league has no bracket, and crowning off it would name the wrong roster.
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: CHOPPED,
      winnersBracket: BRACKET_DECIDED,
      rosters: rosters(6, { 2: 1 }),
    });
    expect(outcome.champion).toBeNull();
    expect(outcome.runnerUpRosterId).toBeNull();
  });

  it("is an ordinary league when the commissioner disabled elimination", () => {
    const outcome = resolveLeagueOutcome({
      status: "in_season",
      settings: { type: 3, disable_elimination: 1 },
      rosters: rosters(6, { 2: 1 }),
    });
    expect(outcome.chopped).toBe(false);
    expect(outcome.chops).toEqual([]);
  });
});

describe("isChopThisWeek", () => {
  it("is true for the week that just settled", () => {
    // currentWeek is the first UNPLAYED week, so week 4 settled when the live
    // week is 5.
    expect(isChopThisWeek({ sleeperRosterId: 1, week: 4 }, 5)).toBe(true);
  });

  it("is false for an older chop, and for nothing at all", () => {
    expect(isChopThisWeek({ sleeperRosterId: 1, week: 2 }, 5)).toBe(false);
    expect(isChopThisWeek(null, 5)).toBe(false);
  });
});
