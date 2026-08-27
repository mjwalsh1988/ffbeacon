/**
 * Characterization tests for the ADP simulation.
 *
 * Written BEFORE the startup-pick refactor so the behavior On The Clock relies
 * on is pinned down independently of the change. The simulation is the source of
 * truth for "who would be taken at an unmade pick", and League Pulse is about to
 * read the same answer for startup trades, so a silent shift here would move two
 * features at once.
 */

import { describe, it, expect } from "vitest";
import {
  orderByAdp,
  simulateRemainingDraft,
  nextPickForRoster,
  goneBefore,
  survivorsAt,
} from "./adp-sim";
import type { RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";

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

function pick(overall: number, over: Partial<CurrentDraftPick> = {}): CurrentDraftPick {
  return {
    overall,
    round: Math.ceil(overall / 12),
    pickInRound: ((overall - 1) % 12) + 1,
    slot: ((overall - 1) % 12) + 1,
    originalRosterId: ((overall - 1) % 12) + 1,
    currentOwnerRosterId: ((overall - 1) % 12) + 1,
    ownershipKnown: true,
    made: false,
    madePick: null,
    ...over,
  };
}

describe("orderByAdp", () => {
  it("orders by real ADP ascending, not by board value", () => {
    const out = orderByAdp([
      player({ playerId: "a", value: 9000, overallRank: 1, adp: 12 }),
      player({ playerId: "b", value: 5000, overallRank: 30, adp: 2 }),
    ]);
    expect(out.map((o) => o.player.playerId)).toEqual(["b", "a"]);
    expect(out.every((o) => o.adpKnown)).toBe(true);
  });

  it("places a player with no ADP by overall rank and flags them", () => {
    const out = orderByAdp([
      player({ playerId: "withAdp", overallRank: 50, adp: 10 }),
      player({ playerId: "noAdp", overallRank: 5, adp: null }),
    ]);
    expect(out.map((o) => o.player.playerId)).toEqual(["noAdp", "withAdp"]);
    expect(out[0].adpKnown).toBe(false);
    expect(out[1].adpKnown).toBe(true);
  });

  it("treats a zero or negative ADP as missing", () => {
    const out = orderByAdp([player({ playerId: "z", overallRank: 3, adp: 0 })]);
    expect(out[0].adpKnown).toBe(false);
  });

  it("breaks ties on overall rank", () => {
    const out = orderByAdp([
      player({ playerId: "late", overallRank: 9, adp: 4 }),
      player({ playerId: "early", overallRank: 2, adp: 4 }),
    ]);
    expect(out.map((o) => o.player.playerId)).toEqual(["early", "late"]);
  });
});

describe("simulateRemainingDraft", () => {
  const available = [
    player({ playerId: "p1", overallRank: 1, adp: 1 }),
    player({ playerId: "p2", overallRank: 2, adp: 2 }),
    player({ playerId: "p3", overallRank: 3, adp: 3 }),
  ];

  it("assigns the ADP-ordered board to unmade picks in draft order", () => {
    const picks = [pick(1), pick(2), pick(3)];
    const out = simulateRemainingDraft({ available, currentPicks: picks, onTheClockPickNo: 1 });
    expect(out.get(1)?.player.playerId).toBe("p1");
    expect(out.get(2)?.player.playerId).toBe("p2");
    expect(out.get(3)?.player.playerId).toBe("p3");
  });

  it("skips made picks and picks before the clock", () => {
    const picks = [pick(1, { made: true }), pick(2), pick(3)];
    const out = simulateRemainingDraft({ available, currentPicks: picks, onTheClockPickNo: 2 });
    expect(out.has(1)).toBe(false);
    expect(out.get(2)?.player.playerId).toBe("p1");
    expect(out.get(3)?.player.playerId).toBe("p2");
  });

  it("leaves picks past the end of the board absent rather than filling them", () => {
    const picks = [pick(1), pick(2), pick(3), pick(4), pick(5)];
    const out = simulateRemainingDraft({ available, currentPicks: picks, onTheClockPickNo: 1 });
    expect(out.size).toBe(3);
    expect(out.has(4)).toBe(false);
  });

  it("returns an empty map when nothing is left to simulate", () => {
    const out = simulateRemainingDraft({
      available,
      currentPicks: [pick(1, { made: true })],
      onTheClockPickNo: 1,
    });
    expect(out.size).toBe(0);
  });

  it("treats a zero clock as pick 1", () => {
    const out = simulateRemainingDraft({
      available,
      currentPicks: [pick(1), pick(2)],
      onTheClockPickNo: 0,
    });
    expect(out.get(1)?.player.playerId).toBe("p1");
  });
});

describe("nextPickForRoster", () => {
  const picks = [
    pick(1, { currentOwnerRosterId: 5, made: true }),
    pick(2, { currentOwnerRosterId: 5 }),
    pick(9, { currentOwnerRosterId: 5 }),
    pick(3, { currentOwnerRosterId: 7 }),
  ];

  it("returns the earliest unmade pick a roster currently owns", () => {
    expect(nextPickForRoster(picks, 5, 1)?.overall).toBe(2);
  });

  it("respects the from-pick floor", () => {
    expect(nextPickForRoster(picks, 5, 3)?.overall).toBe(9);
  });

  it("returns null for an unknown roster", () => {
    expect(nextPickForRoster(picks, null, 1)).toBeNull();
    expect(nextPickForRoster(picks, 99, 1)).toBeNull();
  });
});

describe("goneBefore and survivorsAt", () => {
  const available = [
    player({ playerId: "p1", value: 900, overallRank: 1, adp: 1 }),
    player({ playerId: "p2", value: 800, overallRank: 2, adp: 2 }),
    player({ playerId: "p3", value: 700, overallRank: 3, adp: 3 }),
  ];
  const sim = simulateRemainingDraft({
    available,
    currentPicks: [pick(1), pick(2), pick(3)],
    onTheClockPickNo: 1,
  });

  it("lists who the simulation consumes before a pick, best first", () => {
    expect(goneBefore(sim, 3).map((p) => p.playerId)).toEqual(["p1", "p2"]);
  });

  it("returns whoever the simulation has not consumed yet", () => {
    expect(survivorsAt(available, sim, 3).map((p) => p.playerId)).toEqual(["p3"]);
  });
});
