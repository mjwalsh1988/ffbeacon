import { describe, it, expect } from "vitest";
import {
  normalizeTradedPicks,
  resolveCurrentDraftPicks,
  resolveTradedFuturePicks,
} from "./pick-ownership";
import { draftShapeFromMeta } from "./draft-derive";
import type { ShapedDraftCache, ShapedPick } from "./types";

const SNAKE = draftShapeFromMeta({
  draftType: "snake",
  settings: { teams: 12, rounds: 15 },
} as unknown as ShapedDraftCache["draft"]);

const LINEAR = draftShapeFromMeta({
  draftType: "linear",
  settings: { teams: 12, rounds: 15 },
} as unknown as ShapedDraftCache["draft"]);

const SLOT_TO_ROSTER: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), i + 1]),
);

function made(pickNo: number, over: Partial<ShapedPick> = {}): ShapedPick {
  return {
    pickNo,
    round: Math.ceil(pickNo / 12),
    draftSlot: null,
    rosterId: pickNo,
    pickedBy: `u${pickNo}`,
    sleeperPlayerId: null,
    playerId: null,
    isKeeper: false,
    firstName: "First",
    lastName: `Last${pickNo}`,
    position: "RB",
    team: "ATL",
    ...over,
  };
}

describe("normalizeTradedPicks", () => {
  it("parses well-formed rows and coerces a string season", () => {
    const out = normalizeTradedPicks([
      { season: "2027", round: 1, roster_id: 3, owner_id: 5, previous_owner_id: 3 },
    ]);
    expect(out).toEqual([{ season: 2027, round: 1, originalRosterId: 3, currentOwnerRosterId: 5 }]);
  });
  it("skips rows missing required fields and never throws", () => {
    expect(normalizeTradedPicks([{ season: 2027 }, null, "x", { round: 1 }])).toEqual([]);
    expect(normalizeTradedPicks(undefined)).toEqual([]);
    expect(normalizeTradedPicks("nope")).toEqual([]);
  });
});

describe("resolveCurrentDraftPicks - ownership from the original draft order", () => {
  it("defaults every pick's owner to the seat's roster when nothing is traded/made", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 2,
      shape: SNAKE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [],
      tradedPicks: [],
      currentSeason: 2026,
    });
    expect(picks).toHaveLength(24);
    // Pick 1 (round 1, seat 1) belongs to roster 1.
    const p1 = picks.find((p) => p.overall === 1)!;
    expect(p1.slot).toBe(1);
    expect(p1.currentOwnerRosterId).toBe(1);
    expect(p1.made).toBe(false);
    // Pick 13 (round 2, snake-reversed) is seat 12 -> roster 12.
    const p13 = picks.find((p) => p.overall === 13)!;
    expect(p13.round).toBe(2);
    expect(p13.slot).toBe(12);
    expect(p13.currentOwnerRosterId).toBe(12);
  });

  it("linear keeps seat order every round", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 2,
      shape: LINEAR,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [],
      tradedPicks: [],
      currentSeason: 2026,
    });
    const p13 = picks.find((p) => p.overall === 13)!; // round 2 pick 1
    expect(p13.slot).toBe(1);
    expect(p13.currentOwnerRosterId).toBe(1);
  });

  it("a made pick is authoritative for its owner", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 2,
      shape: SNAKE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [made(1, { rosterId: 7, playerId: "x" })],
      tradedPicks: [],
      currentSeason: 2026,
    });
    const p1 = picks.find((p) => p.overall === 1)!;
    expect(p1.made).toBe(true);
    expect(p1.currentOwnerRosterId).toBe(7);
    expect(p1.madePick?.playerId).toBe("x");
  });

  it("updates ownership when a traded pick changes hands", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 2,
      shape: SNAKE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [],
      // Roster 1's round-1 pick now belongs to roster 9.
      tradedPicks: [{ season: 2026, round: 1, originalRosterId: 1, currentOwnerRosterId: 9 }],
      currentSeason: 2026,
    });
    const p1 = picks.find((p) => p.overall === 1)!;
    expect(p1.originalRosterId).toBe(1);
    expect(p1.currentOwnerRosterId).toBe(9);
  });

  it("does not apply a future-season trade to the current draft", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 2,
      shape: SNAKE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [],
      tradedPicks: [{ season: 2027, round: 1, originalRosterId: 1, currentOwnerRosterId: 9 }],
      currentSeason: 2026,
    });
    expect(picks.find((p) => p.overall === 1)!.currentOwnerRosterId).toBe(1);
  });

  it("leaves ownership unknown (not guessed) when the seat mapping is missing", () => {
    const picks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 1,
      shape: SNAKE,
      slotToRosterId: {},
      madePicks: [],
      tradedPicks: [],
      currentSeason: 2026,
    });
    const p1 = picks.find((p) => p.overall === 1)!;
    expect(p1.ownershipKnown).toBe(false);
    expect(p1.currentOwnerRosterId).toBeNull();
  });

  it("returns [] when teams/rounds are unknown (no crash)", () => {
    expect(
      resolveCurrentDraftPicks({
        teams: 0,
        rounds: 0,
        shape: SNAKE,
        slotToRosterId: {},
        madePicks: [],
        tradedPicks: [],
        currentSeason: 2026,
      }),
    ).toEqual([]);
  });
});

describe("resolveTradedFuturePicks", () => {
  it("returns only future-season picks that changed hands", () => {
    const out = resolveTradedFuturePicks(
      [
        { season: 2026, round: 1, originalRosterId: 1, currentOwnerRosterId: 9 }, // current, ignored
        { season: 2027, round: 1, originalRosterId: 3, currentOwnerRosterId: 5 }, // future, kept
        { season: 2027, round: 2, originalRosterId: 4, currentOwnerRosterId: 4 }, // unchanged, ignored
      ],
      2026,
    );
    expect(out).toEqual([{ season: 2027, round: 1, originalRosterId: 3, currentOwnerRosterId: 5 }]);
  });
});
