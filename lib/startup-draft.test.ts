import { describe, it, expect } from "vitest";
import {
  classifyDraftPool,
  substituteStartupPick,
  describeUnresolved,
  startupPickNoFor,
  slotLabel,
  classifyTradeTiming,
  describeTiming,
} from "./startup-draft";
import { ROOKIE_DRAFT_MAX_ROUNDS, type DraftShape } from "./on-the-clock/draft-derive";

const SNAKE: DraftShape = { type: "snake", reversalRound: 0 };
const LINEAR: DraftShape = { type: "linear", reversalRound: 0 };
const THIRD_ROUND_REVERSAL: DraftShape = { type: "snake", reversalRound: 3 };

describe("classifyDraftPool", () => {
  it("trusts captured evidence over the round count", () => {
    // A 3-round draft the round-count rule would call a rookie draft, but the
    // capture says the whole player pool was on the board.
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 3, capturedPool: "everyone" }),
    ).toBe("startup");
    // And the reverse: a long draft that was actually rookies-only.
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 25, capturedPool: "rookies" }),
    ).toBe("rookie");
  });

  it("falls back to the round count when nothing is captured", () => {
    expect(classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 23 })).toBe("startup");
    expect(classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 4 })).toBe("rookie");
  });

  it("uses the shared rookie round threshold, not a second copy of it", () => {
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: ROOKIE_DRAFT_MAX_ROUNDS }),
    ).toBe("rookie");
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: ROOKIE_DRAFT_MAX_ROUNDS + 1 }),
    ).toBe("startup");
  });

  it("is a no-op for redraft leagues, whatever the round count", () => {
    // Redraft has no startup/rookie split; classifying it as a rookie draft is
    // what leaves redraft valuation completely untouched.
    expect(classifyDraftPool({ formatSlug: "redraft-ppr", rounds: 16 })).toBe("rookie");
    expect(classifyDraftPool({ formatSlug: null, rounds: 16 })).toBe("rookie");
  });

  it("ignores a captured pool value it does not recognise", () => {
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 23, capturedPool: "nonsense" }),
    ).toBe("startup");
    expect(
      classifyDraftPool({ formatSlug: "dynasty-ppr-sflex", rounds: 23, capturedPool: null }),
    ).toBe("startup");
  });
});

describe("substituteStartupPick", () => {
  it("a used seat becomes the player taken, never flagged as an estimate", () => {
    expect(
      substituteStartupPick({
        seatKnown: true,
        used: true,
        usedPlayerId: "gibbs",
        simulatedPlayerId: null,
      }),
    ).toEqual({ kind: "player", playerId: "gibbs", simulated: false });
  });

  it("prefers the real selection over a simulation when both exist", () => {
    expect(
      substituteStartupPick({
        seatKnown: true,
        used: true,
        usedPlayerId: "gibbs",
        simulatedPlayerId: "chase",
      }),
    ).toEqual({ kind: "player", playerId: "gibbs", simulated: false });
  });

  it("an unused seat becomes the simulated player, always flagged", () => {
    expect(
      substituteStartupPick({
        seatKnown: true,
        used: false,
        usedPlayerId: null,
        simulatedPlayerId: "chase",
      }),
    ).toEqual({ kind: "player", playerId: "chase", simulated: true });
  });

  it("refuses to resolve rather than falling back to a rookie price", () => {
    expect(
      substituteStartupPick({
        seatKnown: false,
        used: false,
        usedPlayerId: null,
        simulatedPlayerId: "chase",
      }),
    ).toEqual({ kind: "unresolved", reason: "no-seat" });

    expect(
      substituteStartupPick({
        seatKnown: true,
        used: true,
        usedPlayerId: null,
        simulatedPlayerId: "chase",
      }),
    ).toEqual({ kind: "unresolved", reason: "not-captured" });

    expect(
      substituteStartupPick({
        seatKnown: true,
        used: false,
        usedPlayerId: null,
        simulatedPlayerId: null,
      }),
    ).toEqual({ kind: "unresolved", reason: "board-exhausted" });
  });

  it("has a reader-facing sentence for every reason", () => {
    for (const reason of ["no-seat", "not-captured", "board-exhausted"] as const) {
      expect(describeUnresolved(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("startupPickNoFor", () => {
  const rosterToSeat = new Map<number, number>([
    [7, 1],
    [5, 11],
    [2, 12],
  ]);

  it("maps a round plus roster to the snake pick number", () => {
    // Seat 1, round 1 is pick 1. Round 2 reverses, so seat 1 is pick 24.
    expect(startupPickNoFor({ round: 1, originalRosterId: 7, rosterToSeat, teams: 12, shape: SNAKE }))
      .toEqual({ seat: 1, pickNo: 1 });
    expect(startupPickNoFor({ round: 2, originalRosterId: 7, rosterToSeat, teams: 12, shape: SNAKE }))
      .toEqual({ seat: 1, pickNo: 24 });
  });

  it("does not reverse a linear draft", () => {
    expect(startupPickNoFor({ round: 2, originalRosterId: 7, rosterToSeat, teams: 12, shape: LINEAR }))
      .toEqual({ seat: 1, pickNo: 13 });
  });

  it("honours a third-round reversal", () => {
    // With reversal at 3, rounds 2 and 3 both run reversed, so seat 1 picks
    // last in round 3 (pick 36) rather than first.
    expect(
      startupPickNoFor({
        round: 3,
        originalRosterId: 7,
        rosterToSeat,
        teams: 12,
        shape: THIRD_ROUND_REVERSAL,
      }),
    ).toEqual({ seat: 1, pickNo: 36 });
  });

  it("returns null when the roster holds no seat", () => {
    expect(
      startupPickNoFor({ round: 1, originalRosterId: 99, rosterToSeat, teams: 12, shape: SNAKE }),
    ).toBeNull();
  });

  it("returns null for a degenerate draft or round", () => {
    expect(
      startupPickNoFor({ round: 1, originalRosterId: 7, rosterToSeat, teams: 0, shape: SNAKE }),
    ).toBeNull();
    expect(
      startupPickNoFor({ round: 0, originalRosterId: 7, rosterToSeat, teams: 12, shape: SNAKE }),
    ).toBeNull();
    expect(
      startupPickNoFor({ round: NaN, originalRosterId: 7, rosterToSeat, teams: 12, shape: SNAKE }),
    ).toBeNull();
  });
});

describe("slotLabel", () => {
  it("pads the seat to two digits", () => {
    expect(slotLabel(1, 4)).toBe("1.04");
    expect(slotLabel(12, 11)).toBe("12.11");
  });
});

describe("classifyTradeTiming", () => {
  const started = 1_000_000;
  const lastPicked = 2_000_000;

  it("places a trade before, during, and after the window", () => {
    const at = (createdAtMs: number) =>
      classifyTradeTiming({ createdAtMs, startedAtMs: started, lastPickedAtMs: lastPicked });
    expect(at(started - 1)).toBe("before-draft");
    expect(at(started)).toBe("during-draft");
    expect(at(lastPicked)).toBe("during-draft");
    expect(at(lastPicked + 1)).toBe("after-draft");
  });

  it("treats a draft with no last pick as still open", () => {
    expect(
      classifyTradeTiming({
        createdAtMs: started + 500,
        startedAtMs: started,
        lastPickedAtMs: null,
      }),
    ).toBe("during-draft");
  });

  it("says unknown rather than guessing when a timestamp is missing", () => {
    expect(
      classifyTradeTiming({ createdAtMs: null, startedAtMs: started, lastPickedAtMs: lastPicked }),
    ).toBe("unknown");
    expect(
      classifyTradeTiming({ createdAtMs: started, startedAtMs: null, lastPickedAtMs: lastPicked }),
    ).toBe("unknown");
    expect(
      classifyTradeTiming({ createdAtMs: NaN, startedAtMs: started, lastPickedAtMs: lastPicked }),
    ).toBe("unknown");
  });

  it("has chip text for every real timing and none for unknown", () => {
    expect(describeTiming("before-draft")).toBeTruthy();
    expect(describeTiming("during-draft")).toBeTruthy();
    expect(describeTiming("after-draft")).toBeTruthy();
    expect(describeTiming("unknown")).toBeNull();
  });
});
