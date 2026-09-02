import { describe, it, expect } from "vitest";
import {
  biggestMiss,
  gradeWeek,
  planSlots,
  summariseLineup,
  type LedgerPlayer,
  type WeekInput,
} from "./lineup";
import type { GradedWeek } from "./types";

const players = (
  entries: [string, string, LedgerPlayer["position"]][],
): Map<string, LedgerPlayer> =>
  new Map(entries.map(([sleeperId, name, position]) => [sleeperId, { sleeperId, name, position }]));

const POOL = players([
  ["qb1", "Quarterback One", "QB"],
  ["rb1", "Runner One", "RB"],
  ["rb2", "Runner Two", "RB"],
  ["wr1", "Receiver One", "WR"],
  ["wr2", "Receiver Two", "WR"],
  ["te1", "Tight End One", "TE"],
  ["k1", "Kicker One", "K"],
]);

describe("planSlots", () => {
  it("keeps the index alignment of Sleeper's starters array across an ungradable slot", () => {
    // LB sits between QB and RB. If it were dropped rather than kept with
    // gradable:false, RB would take index 1 and every player below the gap
    // would be read into the wrong slot.
    const plan = planSlots(["QB", "LB", "RB", "BN"]);
    expect(plan.aligned).toEqual([
      { index: 0, token: "QB", gradable: true },
      { index: 1, token: "LB", gradable: false },
      { index: 2, token: "RB", gradable: true },
    ]);
    expect(plan.gradableTokens).toEqual(["QB", "RB"]);
    expect(plan.ungradableTokens).toEqual(["LB"]);
  });

  it("drops bench, IR and taxi, which never hold a starter", () => {
    const plan = planSlots(["QB", "BN", "IR", "TAXI", "NA", "WR"]);
    expect(plan.aligned.map((s) => s.token)).toEqual(["QB", "WR"]);
  });
});

describe("gradeWeek", () => {
  const plan = planSlots(["QB", "RB", "WR", "FLEX", "BN"]);

  const week = (over: Partial<WeekInput> = {}): WeekInput => ({
    week: 3,
    officialPoints: 60,
    starterIds: ["qb1", "rb2", "wr1", "wr2"],
    playerPoints: new Map([
      ["qb1", 20],
      ["rb1", 25],
      ["rb2", 5],
      ["wr1", 20],
      ["wr2", 15],
      ["te1", 3],
    ]),
    opponentPoints: 70,
    ineligibleIds: new Set<string>(),
    ...over,
  });

  it("grades the set lineup against the best legal lineup out of the same players", () => {
    const graded = gradeWeek(plan, week(), POOL);
    // Set: qb1 20 + rb2 5 + wr1 20 + wr2 15 = 60
    expect(graded.setPoints).toBe(60);
    // Best: qb1 20 + rb1 25 (RB) + wr1 20 (WR) + wr2 15 (FLEX) = 80
    expect(graded.optimalPoints).toBe(80);
    expect(graded.pointsLeft).toBe(20);
  });

  it("reads the result off the official score and the best lineup off official plus the deficit", () => {
    const graded = gradeWeek(plan, week(), POOL);
    expect(graded.outcome).toBe("loss");
    // 60 official + 20 left = 80, which beats the opponent's 70.
    expect(graded.bestLineupOutcome).toBe("win");
  });

  it("treats a draw as its own outcome rather than a loss", () => {
    const graded = gradeWeek(plan, week({ opponentPoints: 60 }), POOL);
    expect(graded.outcome).toBe("tie");
  });

  it("gives an unpaired week a null outcome rather than a loss", () => {
    const graded = gradeWeek(plan, week({ opponentPoints: null }), POOL);
    expect(graded.outcome).toBeNull();
    expect(graded.bestLineupOutcome).toBeNull();
    expect(graded.opponentPoints).toBeNull();
  });

  it("measures both sides over the gradable slots only, so an IDP slot is never a deficit", () => {
    const idpPlan = planSlots(["QB", "LB", "RB", "BN"]);
    const graded = gradeWeek(
      idpPlan,
      {
        week: 1,
        officialPoints: 55,
        // index 1 is the LB slot, filled by a player we hold no position for.
        starterIds: ["qb1", "lb9", "rb1"],
        playerPoints: new Map([
          ["qb1", 20],
          ["lb9", 10],
          ["rb1", 25],
          ["rb2", 5],
        ]),
        opponentPoints: 50,
        ineligibleIds: new Set<string>(),
      },
      POOL,
    );
    // 20 + 25 over the two gradable slots. The linebacker's 10 is in neither
    // side of the comparison, so the deficit is zero rather than 10.
    expect(graded.setPoints).toBe(45);
    expect(graded.optimalPoints).toBe(45);
    expect(graded.pointsLeft).toBe(0);
    expect(graded.ungradedSlots).toBe(1);
    // The result still comes from the league's own official total.
    expect(graded.outcome).toBe("win");
  });

  it("counts an unfilled slot as a hole to be filled, not as a player scoring zero", () => {
    const graded = gradeWeek(
      plan,
      week({ starterIds: ["qb1", "rb2", "wr1", "0"], officialPoints: 45 }),
      POOL,
    );
    expect(graded.setPoints).toBe(45);
    expect(graded.biggestMiss?.outPlayerId).toBeNull();
  });
});

describe("biggestMiss", () => {
  const plan = planSlots(["QB", "RB", "WR", "BN"]);

  it("only offers a swap the slot's own eligibility allows", () => {
    // The kicker outscores the running back but cannot fill an RB slot, so the
    // reported swap is the receiver into the receiver slot.
    const miss = biggestMiss(
      plan,
      ["qb1", "rb2", "wr2"],
      new Map([
        ["qb1", 20],
        ["rb2", 5],
        ["wr2", 8],
        ["k1", 30],
        ["wr1", 12],
      ]),
      POOL,
    );
    expect(miss?.inName).toBe("Receiver One");
    expect(miss?.outPlayerId).toBe("wr2");
    expect(miss?.gain).toBe(4);
  });

  it("returns null when the set lineup could not have been improved", () => {
    const miss = biggestMiss(
      plan,
      ["qb1", "rb1", "wr1"],
      new Map([
        ["qb1", 20],
        ["rb1", 25],
        ["wr1", 20],
        ["rb2", 1],
      ]),
      POOL,
    );
    expect(miss).toBeNull();
  });
});

describe("summariseLineup", () => {
  const week = (over: Partial<GradedWeek>): GradedWeek => ({
    week: 1,
    officialPoints: 100,
    setPoints: 100,
    optimalPoints: 100,
    pointsLeft: 0,
    ungradedSlots: 0,
    opponentPoints: 90,
    outcome: "win",
    bestLineupOutcome: "win",
    biggestMiss: null,
    ...over,
  });

  it("counts a loss the best lineup would have won, and nothing else", () => {
    const summary = summariseLineup([
      week({ outcome: "loss", bestLineupOutcome: "win", pointsLeft: 12 }),
      // A loss the bench could not have saved.
      week({ outcome: "loss", bestLineupOutcome: "loss", pointsLeft: 3 }),
      // A win with points left on the bench is not a win left on the bench.
      week({ outcome: "win", bestLineupOutcome: "win", pointsLeft: 40 }),
      // A draw turning into a win is half a game, so it is deliberately not
      // counted in a figure that reports whole games.
      week({ outcome: "tie", bestLineupOutcome: "win", pointsLeft: 2 }),
    ]);
    expect(summary.winsLeftOnBench).toBe(1);
    expect(summary.actualRecord).toEqual({ wins: 1, losses: 2, ties: 1 });
    expect(summary.bestLineupRecord).toEqual({ wins: 3, losses: 1, ties: 0 });
    expect(summary.pointsLeft).toBe(57);
  });

  it("skips an unpaired week in both records rather than scoring it as a loss", () => {
    const summary = summariseLineup([
      week({ opponentPoints: null, outcome: null, bestLineupOutcome: null, pointsLeft: 5 }),
      week({ outcome: "win", bestLineupOutcome: "win" }),
    ]);
    expect(summary.actualRecord).toEqual({ wins: 1, losses: 0, ties: 0 });
    expect(summary.bestLineupRecord).toEqual({ wins: 1, losses: 0, ties: 0 });
    // The deficit still counts: the lineup was still set badly that week.
    expect(summary.pointsLeft).toBe(5);
    expect(summary.weeksGraded).toBe(2);
  });

  it("reports a null efficiency rather than a zero when nothing is gradable", () => {
    const summary = summariseLineup([
      week({ setPoints: 0, optimalPoints: 0, opponentPoints: null, outcome: null, bestLineupOutcome: null }),
    ]);
    expect(summary.efficiency).toBeNull();
  });
});

describe("floating point residue", () => {
  const plan = planSlots(["QB", "RB", "WR", "BN"]);

  it("reports a perfect lineup as a zero deficit, not as 1.4e-14", () => {
    // Two-decimal points that do not sum exactly in binary floating point.
    // Before the figures were snapped to two decimals, the set total and the
    // optimal total differed by IEEE-754 residue, that residue was greater than
    // zero, and the week was reported as having points left on the bench.
    const graded = gradeWeek(
      plan,
      {
        week: 1,
        officialPoints: 127.03,
        starterIds: ["qb1", "rb1", "wr1"],
        playerPoints: new Map([
          ["qb1", 20.14],
          ["rb1", 87.32],
          ["wr1", 19.57],
          ["rb2", 3.11],
        ]),
        opponentPoints: 158.42,
        ineligibleIds: new Set<string>(),
      },
      POOL,
    );
    expect(graded.pointsLeft).toBe(0);
    expect(graded.setPoints).toBe(graded.optimalPoints);
    expect(graded.biggestMiss).toBeNull();
    // A zero deficit must not turn a loss into a win.
    expect(graded.outcome).toBe("loss");
    expect(graded.bestLineupOutcome).toBe("loss");
  });

  it("gives a perfect season an efficiency of exactly 1", () => {
    const week = gradeWeek(
      plan,
      {
        week: 1,
        officialPoints: 127.03,
        starterIds: ["qb1", "rb1", "wr1"],
        playerPoints: new Map([
          ["qb1", 20.14],
          ["rb1", 87.32],
          ["wr1", 19.57],
        ]),
        opponentPoints: 100,
        ineligibleIds: new Set<string>(),
      },
      POOL,
    );
    expect(summariseLineup([week, week, week]).efficiency).toBe(1);
  });
});

describe("players a manager could not legally have started", () => {
  const plan = planSlots(["QB", "RB", "WR", "BN"]);

  const week = (ineligible: string[]): WeekInput => ({
    week: 4,
    officialPoints: 45,
    starterIds: ["qb1", "rb2", "wr1"],
    playerPoints: new Map([
      ["qb1", 20],
      ["rb2", 5],
      ["wr1", 20],
      // The best back on the roster, and the whole question is whether he
      // could have been started.
      ["rb1", 30],
    ]),
    opponentPoints: 60,
    ineligibleIds: new Set(ineligible),
  });

  it("leaves an IR or taxi player out of the best legal lineup", () => {
    // THE BUG THIS CLOSES. player_points carries a score for every player ON
    // the roster, injured reserve and taxi squad included, so without the
    // filter the optimum seats a taxi rookie and the page tells a manager they
    // left a win on the bench by not starting someone Sleeper would not let
    // them start.
    const withRb1 = gradeWeek(plan, week([]), POOL);
    expect(withRb1.pointsLeft).toBe(25);
    expect(withRb1.bestLineupOutcome).toBe("win");

    const withoutRb1 = gradeWeek(plan, week(["rb1"]), POOL);
    expect(withoutRb1.pointsLeft).toBe(0);
    expect(withoutRb1.bestLineupOutcome).toBe("loss");
    expect(withoutRb1.biggestMiss).toBeNull();
  });

  it("never offers an ineligible player as a swap", () => {
    const miss = biggestMiss(
      plan,
      ["qb1", "rb2", "wr1"],
      new Map([
        ["qb1", 20],
        ["rb2", 5],
        ["wr1", 20],
        ["rb1", 30],
      ]),
      POOL,
      new Set(["rb1"]),
    );
    expect(miss).toBeNull();
  });

  it("treats anyone who actually started as eligible, whatever the current list says", () => {
    // The lists are the roster's CURRENT ones and Sleeper publishes no per-week
    // history, so a player on IR today may have been healthy in week 4. Having
    // started is proof rather than inference, so his points stay in the set
    // lineup instead of vanishing out of it.
    const graded = gradeWeek(plan, week(["wr1"]), POOL);
    expect(graded.setPoints).toBe(45);
  });

  it("scores the set lineup from the same pool as the optimum", () => {
    // A starter our players table does not know sits in neither side of the
    // comparison. Counting him in the numerator and not the denominator used to
    // report a perfect manager on a week that could not be measured.
    const graded = gradeWeek(
      plan,
      {
        week: 5,
        officialPoints: 50,
        starterIds: ["qb1", "unknown9", "wr1"],
        playerPoints: new Map([
          ["qb1", 20],
          ["unknown9", 10],
          ["wr1", 20],
        ]),
        opponentPoints: 60,
        ineligibleIds: new Set<string>(),
      },
      POOL,
    );
    expect(graded.setPoints).toBe(40);
    expect(graded.optimalPoints).toBe(40);
    expect(graded.pointsLeft).toBe(0);
  });
});
