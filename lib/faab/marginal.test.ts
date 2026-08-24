import { describe, it, expect } from "vitest";
import {
  computeLineupSwap,
  type CandidateWeek,
  type LineupSwapInput,
  type RosterMetaEntry,
} from "./marginal";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";

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

/**
 * The reported bug, in miniature.
 *
 * Malik Nabers is on IR, so every remaining week projects him at zero and the
 * lineup loses nothing by cutting him. He is also the most valuable player on
 * the roster. Ranking cut candidates on the injured projection made him the
 * cheapest man to release; both guards exist to stop that sentence being
 * printed.
 */
describe("cut guards", () => {
  const WEEKS = [5, 6, 7];

  /** A full roster: a stud on IR, real starters, and one spare part. */
  function injuredStudRoster() {
    return [
      player("qb1", "QB", 18),
      player("rb1", "RB", 14),
      player("rb2", "RB", 10),
      player("stud", "WR", 0), // on IR, so the model projects nothing
      player("spare", "WR", 3),
    ];
  }

  /** The same players as they project when nobody is hurt. */
  function healthyRoster() {
    return [
      player("qb1", "QB", 18),
      player("rb1", "RB", 14),
      player("rb2", "RB", 10),
      player("stud", "WR", 21),
      player("spare", "WR", 3),
    ];
  }

  const META = new Map<string, RosterMetaEntry>([
    ["qb1", { name: "Quarterback One", position: "QB" }],
    ["rb1", { name: "Back One", position: "RB" }],
    ["rb2", { name: "Back Two", position: "RB" }],
    ["stud", { name: "Malik Nabers", position: "WR", injuryStatus: "IR" }],
    ["spare", { name: "Spare Part", position: "WR" }],
  ]);

  /** Nabers is the most expensive asset; the spare part is the cheapest. */
  const VALUES = new Map<string, number | null>([
    ["qb1", 6600],
    ["rb1", 8300],
    ["rb2", 5900],
    ["stud", 7772],
    ["spare", 900],
  ]);

  function guardInput(overrides: Partial<LineupSwapInput> = {}): LineupSwapInput {
    return baseInput({
      weeks: WEEKS,
      rosterByWeek: weeksOf(WEEKS, injuredStudRoster()),
      healthyRosterByWeek: weeksOf(WEEKS, healthyRoster()),
      rosterMeta: META,
      mustDrop: true,
      rosterValues: VALUES,
      // A waiver running back, priced below the stud and above the spare part.
      candidateValue: 5381,
      dropGuard: { ...DEFAULT_FAAB_SETTINGS.dropGuard, minValuedPlayers: 0 },
      ...overrides,
    });
  }

  it("does not name an injured star as the cut", () => {
    const result = computeLineupSwap(guardInput());
    expect(result.dropCost?.playerId).not.toBe("stud");
    expect(result.dropCost?.playerId).toBe("spare");
  });

  /**
   * Without the value guard the healthy baseline alone already saves him: on
   * the healthy board he is the best receiver on the roster and the most
   * expensive man to lose.
   */
  it("ranks cuts on what a player is worth when he plays", () => {
    const result = computeLineupSwap(
      guardInput({
        rosterValues: undefined,
        candidateValue: null,
      }),
    );
    expect(result.dropCost?.playerId).toBe("spare");
  });

  it("goes back to naming the injured player when the guards are off", () => {
    const result = computeLineupSwap(
      guardInput({
        healthyRosterByWeek: undefined,
        dropGuard: { ...DEFAULT_FAAB_SETTINGS.dropGuard, enabled: false },
      }),
    );
    expect(result.dropCost?.playerId).toBe("stud");
  });

  it("reports the cost the reader actually pays, not the healthy-board cost", () => {
    const result = computeLineupSwap(guardInput());
    expect(result.dropCost?.playerId).toBe("spare");
    // On the healthy board the stud takes the flex and releasing the spare part
    // costs nothing, which is why he ranks cheapest. On the board the reader is
    // actually playing, the stud is hurt and the spare part IS the flex, so
    // releasing him costs 3 a week. That is the number we print.
    expect(result.dropCost?.pointsPerWeek).toBeCloseTo(3, 5);
  });

  it("carries the injury designation so the page can say why it matters", () => {
    const result = computeLineupSwap(
      guardInput({
        rosterValues: new Map<string, number | null>([
          ["qb1", 6600],
          ["rb1", 8300],
          ["rb2", 5900],
          // The market has written this season off for him, which is the one
          // case where naming the cut is fair.
          ["stud", 120],
          ["spare", 900],
        ]),
        healthyRosterByWeek: undefined,
      }),
    );
    expect(result.dropCost?.playerId).toBe("stud");
    expect(result.dropCost?.injuryStatus).toBe("IR");
    // Said on his own row rather than in a sentence about the whole roster, so
    // a reader scanning the shortlist sees it against the name it applies to.
    expect(result.dropCost?.note).toMatch(/IR/);
  });

  it("offers a shortlist rather than one name, cheapest first", () => {
    // A deeper bench than the guard fixture, so there is a real list to rank.
    const deep = [
      player("qb1", "QB", 18),
      player("rb1", "RB", 14),
      player("rb2", "RB", 10),
      player("stud", "WR", 0),
      player("spare", "WR", 3),
      player("spare2", "WR", 2),
      player("spare3", "TE", 1),
      player("spare4", "WR", 1),
      player("spare5", "TE", 0.5),
    ];
    const deepMeta = new Map(META);
    for (const id of ["spare2", "spare3", "spare4", "spare5"]) {
      deepMeta.set(id, { name: `Bench ${id}`, position: "WR", team: "FA" });
    }
    const deepValues = new Map(VALUES);
    for (const [id, value] of [
      ["spare2", 800],
      ["spare3", 700],
      ["spare4", 600],
      ["spare5", 500],
    ] as const) {
      deepValues.set(id, value);
    }

    const result = computeLineupSwap(
      guardInput({
        rosterByWeek: weeksOf(WEEKS, deep),
        healthyRosterByWeek: undefined,
        rosterMeta: deepMeta,
        rosterValues: deepValues,
      }),
    );

    expect(result.dropOptions.length).toBeGreaterThan(1);
    // Capped, so a deep bench does not become a wall of names to read past.
    expect(result.dropOptions.length).toBeLessThanOrEqual(4);
    // The applied cut leads the list, because the figures are net of it.
    expect(result.dropOptions[0].playerId).toBe(result.dropCost?.playerId);
    const costs = result.dropOptions.map((o) => o.pointsPerWeek);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    // Still no sign of the protected star.
    expect(result.dropOptions.map((o) => o.playerId)).not.toContain("stud");
  });

  it("offers what it has when a strong roster leaves only one honest cut", () => {
    const result = computeLineupSwap(guardInput());
    expect(result.dropOptions).toHaveLength(1);
    expect(result.dropOptions[0].playerId).toBe("spare");
  });

  it("keeps a protected player off the shortlist entirely", () => {
    const result = computeLineupSwap(guardInput());
    expect(result.dropOptions.map((o) => o.playerId)).not.toContain("stud");
    expect(result.dropNote).toMatch(/left him off this list/);
  });

  it("gives every option a plain-language line and a team", () => {
    const result = computeLineupSwap(guardInput());
    for (const option of result.dropOptions) {
      expect(option.note).toBeTruthy();
      expect(option.name).toBeTruthy();
      expect(option).toHaveProperty("team");
    }
  });

  /**
   * In a keeper league the cut is the asset, so the bar is not "is he worth
   * less than the man I am adding" but "is he near the bottom of my roster".
   * Nabers is third by value here, so he is never named however the week reads.
   */
  it("protects the top of a keeper roster regardless of this week", () => {
    const result = computeLineupSwap(
      guardInput({
        isKeeperLeague: true,
        healthyRosterByWeek: undefined,
        // Priced above everyone, which in redraft would clear the ratio guard
        // for the whole roster.
        candidateValue: 9999,
      }),
    );
    expect(result.dropCost?.playerId).toBe("spare");
  });

  it("says so rather than naming somebody when the whole roster is protected", () => {
    const result = computeLineupSwap(
      guardInput({
        // Every rostered player is worth more than the claim.
        candidateValue: 100,
      }),
    );
    expect(result.dropCost).toBeNull();
    expect(result.dropOptions).toEqual([]);
    expect(result.dropNote).toMatch(/nobody on your roster/i);
    // Deliberately names no one: the cheapest player to lose is the one the
    // guards just protected, so printing him would read as the suggestion we
    // refused to make.
    expect(result.dropNote).not.toMatch(/Malik Nabers|Back One|Spare Part/);
  });

  it("stands down on a roster with too few priced players to rank", () => {
    const result = computeLineupSwap(
      guardInput({
        healthyRosterByWeek: undefined,
        dropGuard: { ...DEFAULT_FAAB_SETTINGS.dropGuard, minValuedPlayers: 8 },
      }),
    );
    // Five valued players is below the floor, so the guard does not run and the
    // raw lineup cost wins again.
    expect(result.dropCost?.playerId).toBe("stud");
  });
});
