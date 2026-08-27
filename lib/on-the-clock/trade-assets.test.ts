/**
 * Characterization tests for the draft-room asset resolver.
 *
 * Written BEFORE the startup-pick refactor. resolveDraftAsset holds the rule
 * League Pulse is about to share ("a made pick IS the player taken; an unmade
 * pick is the player the simulation expects there"), and the refactor moves that
 * decision into lib/startup-draft.ts. These tests pin On The Clock's observable
 * behavior so the move is provably behavior-preserving rather than assumed to be.
 *
 * Every case here describes the CURRENT contract. If one of these has to change
 * to make the shared module work, the shared module is wrong.
 */

import { describe, it, expect } from "vitest";
import { resolveDraftAsset, resolveSide, toSignalCheckAssets } from "./trade-assets";
import type { ResolveContext } from "./trade-assets";
import type { RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";
import type { ShapedPick } from "./types";
import type { SimulatedPick } from "./adp-sim";

function player(over: Partial<RankedPlayer> & { playerId: string }): RankedPlayer {
  return {
    sleeperId: `s-${over.playerId}`,
    name: `Player ${over.playerId}`,
    position: "RB",
    team: "ATL",
    overallRank: 1,
    positionRank: 1,
    tier: 1,
    value: 1000,
    isRookie: false,
    ...over,
  };
}

function shaped(over: Partial<ShapedPick> = {}): ShapedPick {
  return {
    pickNo: 1,
    round: 1,
    draftSlot: 1,
    rosterId: 3,
    pickedBy: "u3",
    sleeperPlayerId: "s-gibbs",
    playerId: "gibbs",
    isKeeper: false,
    firstName: "Jahmyr",
    lastName: "Gibbs",
    position: "RB",
    team: "DET",
    ...over,
  };
}

function draftPick(over: Partial<CurrentDraftPick> = {}): CurrentDraftPick {
  return {
    overall: 4,
    round: 1,
    pickInRound: 4,
    slot: 4,
    originalRosterId: 3,
    currentOwnerRosterId: 3,
    ownershipKnown: true,
    made: false,
    madePick: null,
    ...over,
  };
}

const GIBBS = player({ playerId: "gibbs", name: "Jahmyr Gibbs", value: 9347 });
const CHASE = player({ playerId: "chase", name: "Ja'Marr Chase", value: 9134, position: "WR" });

function ctx(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    currentPicks: [draftPick()],
    simulated: new Map<number, SimulatedPick>(),
    valueBoard: [GIBBS, CHASE],
    pickValueFor: () => null,
    teamNameByRosterId: { 3: "Team Three", 7: "Team Seven" },
    myRosterId: null,
    ...over,
  };
}

describe("resolveDraftAsset, player refs", () => {
  it("resolves a board player to himself", () => {
    const out = resolveDraftAsset({ kind: "player", playerId: "gibbs" }, ctx());
    expect(out).not.toBeNull();
    expect(out!.signalCheck).toEqual({ kind: "player", playerId: "gibbs" });
    expect(out!.value).toBe(9347);
    expect(out!.simulated).toBe(false);
    expect(out!.repeatable).toBe(false);
    expect(out!.id).toBe("pl-gibbs");
  });

  it("returns null for a player not on the board", () => {
    expect(resolveDraftAsset({ kind: "player", playerId: "ghost" }, ctx())).toBeNull();
  });
});

describe("resolveDraftAsset, made current picks", () => {
  it("becomes the player actually taken, not an estimate", () => {
    const made = draftPick({ overall: 4, made: true, madePick: shaped({ pickNo: 4 }) });
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx({ currentPicks: [made] }));
    expect(out!.signalCheck).toEqual({ kind: "player", playerId: "gibbs" });
    expect(out!.simulated).toBe(false);
    expect(out!.value).toBe(9347);
    expect(out!.label).toBe("1.04, Jahmyr Gibbs");
    expect(out!.id).toBe("made-4");
  });

  it("falls back to the sleeper id when the ff beacon id is absent", () => {
    const made = draftPick({
      overall: 4,
      made: true,
      madePick: shaped({ pickNo: 4, playerId: null, sleeperPlayerId: "s-chase" }),
    });
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx({ currentPicks: [made] }));
    expect(out!.signalCheck).toEqual({ kind: "player", playerId: "chase" });
  });

  it("yields no signal check asset when the drafted player is off the board", () => {
    const made = draftPick({
      overall: 4,
      made: true,
      madePick: shaped({ pickNo: 4, playerId: "unknown", sleeperPlayerId: "s-unknown" }),
    });
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx({ currentPicks: [made] }));
    expect(out!.signalCheck).toBeNull();
    expect(out!.value).toBe(0);
  });
});

describe("resolveDraftAsset, unmade current picks", () => {
  it("becomes the simulated player and is flagged simulated", () => {
    const sim = new Map<number, SimulatedPick>([
      [4, { overall: 4, player: CHASE, adpKnown: true }],
    ]);
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx({ simulated: sim }));
    expect(out!.signalCheck).toEqual({ kind: "player", playerId: "chase" });
    expect(out!.simulated).toBe(true);
    expect(out!.value).toBe(9134);
    expect(out!.label).toBe("1.04, Ja'Marr Chase");
    expect(out!.detail).toContain("Projected by Sleeper ADP");
  });

  it("says so when the projected player carried no real ADP", () => {
    const sim = new Map<number, SimulatedPick>([
      [4, { overall: 4, player: CHASE, adpKnown: false }],
    ]);
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx({ simulated: sim }));
    expect(out!.detail).toContain("no ADP for this player");
  });

  it("resolves to nothing when the board runs out before the pick", () => {
    const out = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx());
    expect(out!.signalCheck).toBeNull();
    expect(out!.value).toBe(0);
    expect(out!.simulated).toBe(true);
    expect(out!.label).toBe("1.04, not yet made");
  });

  it("returns null for a pick that is not in this draft", () => {
    expect(resolveDraftAsset({ kind: "current-pick", overall: 999 }, ctx())).toBeNull();
  });
});

describe("resolveDraftAsset, future picks", () => {
  const withValues = ctx({ pickValueFor: (season, round) => (season === 2028 && round === 1 ? 5196 : null) });

  it("stays a pick asset rather than naming an invented player", () => {
    const out = resolveDraftAsset(
      { kind: "future-pick", season: 2028, round: 1, bucket: "mid" },
      withValues,
    );
    expect(out!.signalCheck).toEqual({
      kind: "pick",
      season: 2028,
      round: 1,
      pickPosition: "mid",
    });
    expect(out!.simulated).toBe(false);
    expect(out!.repeatable).toBe(true);
    expect(out!.value).toBe(5196);
  });

  it("is not repeatable and is named by origin when it is a concrete traded pick", () => {
    const out = resolveDraftAsset(
      { kind: "future-pick", season: 2028, round: 1, bucket: "mid", originalRosterId: 7 },
      withValues,
    );
    expect(out!.repeatable).toBe(false);
    expect(out!.id).toBe("tfut-2028-1-7");
    expect(out!.label).toBe("2028 1st, originally Team Seven");
  });

  it("returns null for a bucket with no published value", () => {
    expect(
      resolveDraftAsset({ kind: "future-pick", season: 2030, round: 9, bucket: "late" }, withValues),
    ).toBeNull();
  });
});

describe("resolveSide and toSignalCheckAssets", () => {
  it("drops refs that no longer exist", () => {
    const out = resolveSide(
      [
        { kind: "player", playerId: "gibbs" },
        { kind: "player", playerId: "ghost" },
      ],
      ctx(),
    );
    expect(out).toHaveLength(1);
  });

  it("counts assets that could not become a signal check asset", () => {
    const unresolvable = resolveDraftAsset({ kind: "current-pick", overall: 4 }, ctx())!;
    const resolvable = resolveDraftAsset({ kind: "player", playerId: "gibbs" }, ctx())!;
    const { assets, dropped } = toSignalCheckAssets([resolvable, unresolvable]);
    expect(assets).toEqual([{ kind: "player", playerId: "gibbs" }]);
    expect(dropped).toBe(1);
  });
});
