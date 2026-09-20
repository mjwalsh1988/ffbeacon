import { describe, expect, it } from "vitest";

import { activePlayerCount, activeRosterLimit, rosterIsFull } from "./roster";

const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN", "BN"];

function roster(players: string[], reserve: string[] = [], taxi: string[] = []) {
  return {
    playerSleeperIds: players,
    reserveSleeperIds: reserve,
    taxiSleeperIds: taxi,
  };
}

function ids(count: number, prefix = "p"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

describe("activeRosterLimit", () => {
  it("counts every startable and bench slot", () => {
    expect(activeRosterLimit(SLOTS)).toBe(10);
  });

  it("ignores IR and taxi slots if a league shape ever carries them", () => {
    expect(activeRosterLimit([...SLOTS, "IR", "IR", "TAXI"])).toBe(10);
  });
});

describe("activePlayerCount", () => {
  it("drops reserve and taxi players", () => {
    const r = roster([...ids(10), "ir1", "ir2", "tx1"], ["ir1", "ir2"], ["tx1"]);
    expect(activePlayerCount(r)).toBe(10);
  });
});

describe("rosterIsFull", () => {
  it("is false when two injured reserve players hide an open bench spot", () => {
    // Nine active players, two on IR, in a ten-slot league: one spot is open.
    const r = roster([...ids(9), "ir1", "ir2"], ["ir1", "ir2"]);
    expect(rosterIsFull(r, SLOTS)).toBe(false);
  });

  it("ignores taxi players the same way", () => {
    const r = roster([...ids(9), "tx1", "tx2", "tx3"], [], ["tx1", "tx2", "tx3"]);
    expect(rosterIsFull(r, SLOTS)).toBe(false);
  });

  it("is true when every active slot is taken", () => {
    const r = roster([...ids(10), "ir1"], ["ir1"]);
    expect(rosterIsFull(r, SLOTS)).toBe(true);
  });

  it("is true past the limit", () => {
    expect(rosterIsFull(roster(ids(11)), SLOTS)).toBe(true);
  });

  it("never forces a cut when the league shape is unreadable", () => {
    expect(rosterIsFull(roster(ids(11)), [])).toBe(false);
  });
});
