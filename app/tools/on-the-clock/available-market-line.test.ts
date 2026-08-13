import { describe, it, expect } from "vitest";
import { describeAvailableVsMarket } from "./available-list";
import type { RankedPlayer } from "@/lib/on-the-clock/board-types";

function player(overrides: Partial<RankedPlayer> = {}): RankedPlayer {
  return {
    playerId: "p1",
    sleeperId: "4046",
    name: "Test Player",
    position: "WR",
    team: "BUF",
    overallRank: 30,
    positionRank: 12,
    tier: 3,
    value: 5000,
    isRookie: false,
    adp: null,
    ...overrides,
  };
}

describe("describeAvailableVsMarket", () => {
  it("prefers the Beacon Steals pick over the raw overall rank", () => {
    // overallRank 30 and beaconPick 92 disagree hard. The steal read wins, and
    // the copy quotes the pick number rather than the rank.
    const result = describeAvailableVsMarket(
      player({ overallRank: 30, beaconPick: 92, adp: 120 }),
      6,
    );
    expect(result.lean).toBe("beacon-higher");
    expect(result.label).toBe("Lasts 28 picks past where our board takes him (92).");
  });

  it("reads a market-early player the other way", () => {
    const result = describeAvailableVsMarket(player({ beaconPick: 120, adp: 80 }), 6);
    expect(result.lean).toBe("market-higher");
    expect(result.label).toBe("Goes 40 picks before where our board takes him (120).");
  });

  it("calls a small difference even rather than a signal", () => {
    const result = describeAvailableVsMarket(player({ beaconPick: 100, adp: 103 }), 6);
    expect(result.lean).toBe("even");
    expect(result.label).toBe("Near where our board takes him (100).");
  });

  it("uses the singular noun for a one-pick gap", () => {
    const result = describeAvailableVsMarket(player({ beaconPick: 100, adp: 101 }), 1);
    expect(result.label).toContain("1 pick past");
  });

  it("falls back to the rank comparison when the board has no row", () => {
    // No beaconPick: a format with no ADP market, a kicker, or a board built
    // before the first nightly run.
    const result = describeAvailableVsMarket(
      player({ overallRank: 30, beaconPick: null, adp: 42 }),
      6,
    );
    expect(result.lean).toBe("beacon-higher");
    expect(result.label).toContain("Sleeper ADP is 12 picks later");
  });

  it("falls back when the player has a steal row but no ADP", () => {
    const result = describeAvailableVsMarket(player({ beaconPick: 40, adp: null }), 6);
    expect(result.gap).toBeNull();
    expect(result.lean).toBe("none");
    expect(result.label).toBe("No ADP data");
  });

  it("never emits a banned typographic character", () => {
    // Escaped rather than literal: an em dash and a non-breaking space are hard
    // to tell apart from their plain neighbours in source, and a stray literal
    // space in this class makes the assertion match every string.
    const BANNED = /[—–‘’“”…· ]/;
    const cases = [
      describeAvailableVsMarket(player({ beaconPick: 92, adp: 120 }), 6),
      describeAvailableVsMarket(player({ beaconPick: 120, adp: 80 }), 6),
      describeAvailableVsMarket(player({ beaconPick: 100, adp: 103 }), 6),
      describeAvailableVsMarket(player({ beaconPick: null, adp: 42 }), 6),
    ];
    for (const c of cases) {
      expect(c.label).not.toMatch(BANNED);
    }
  });
});
