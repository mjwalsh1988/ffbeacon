import { describe, expect, it } from "vitest";
import {
  agreementShare,
  biggestDisagreements,
  comparableRanks,
  gapSentence,
  gapShortText,
  ordinal,
  rankGap,
} from "./compare";

const board = [
  { playerId: "a", position: "RB" },
  { playerId: "lb", position: "LB" },
  { playerId: "b", position: "WR" },
  { playerId: "c", position: "RB" },
];

describe("comparableRanks", () => {
  it("counts only offensive players on an overall board", () => {
    const r = comparableRanks(board, "overall");
    expect(r.get("a")).toBe(1);
    expect(r.get("b")).toBe(2);
    expect(r.get("c")).toBe(3);
    expect(r.has("lb")).toBe(false);
  });

  it("uses the positional rank on the position basis", () => {
    const r = comparableRanks(board, "position");
    expect(r.get("c")).toBe(2);
    expect(r.get("b")).toBe(1);
  });
});

describe("rankGap", () => {
  const comparison = {
    basis: "overall" as const,
    ranks: { a: { overall: 5, position: 3 }, b: { overall: 2, position: 1 }, c: { overall: 3, position: 2 } },
  };

  it("reads the plan's example: placed 14th, FF Beacon 18th, 4 spots higher", () => {
    const gap = rankGap(
      { basis: "overall", ranks: { w: { overall: 18, position: 9 } } },
      { playerId: "w", position: "WR" },
      14,
    );
    expect(gap).toEqual({ kind: "gap", direction: "higher", spots: 4, theirRank: 18 });
    expect(gapShortText(gap, "FF Beacon")).toBe("4 higher");
    expect(gapSentence(gap, "FF Beacon")).toBe(
      "4 spots higher than FF Beacon, who has him 18th.",
    );
  });

  it("lower and same", () => {
    expect(rankGap(comparison, board[2], 5)).toMatchObject({ direction: "lower", spots: 3 });
    const same = rankGap(comparison, board[3], 3);
    expect(gapShortText(same, "FF Beacon")).toBe("Same");
  });

  it("says defenders and unranked players in words", () => {
    const d = rankGap(comparison, board[1], 2);
    expect(d.kind).toBe("defender");
    expect(gapShortText(d, "FF Beacon")).toBe("Not ranked by FF Beacon");
    const u = rankGap(comparison, { playerId: "zz", position: "TE" }, 9);
    expect(gapShortText(u, "FF Beacon")).toBe("Not in FF Beacon's rankings");
  });
});

describe("agreementShare", () => {
  it("leaves uncomparable players out of both halves", () => {
    const share = agreementShare([
      { kind: "gap", direction: "same", spots: 0, theirRank: 1 },
      { kind: "gap", direction: "higher", spots: 3, theirRank: 5 },
      { kind: "gap", direction: "lower", spots: 9, theirRank: 2 },
      { kind: "defender" },
      { kind: "unranked" },
    ]);
    expect(share).toEqual({ share: 2 / 3, compared: 3 });
    expect(agreementShare([{ kind: "defender" }])).toBeNull();
  });
});

describe("ordinal", () => {
  it("handles the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th",
    ]);
  });
});

describe("a ranking that ranks defenders", () => {
  it("compares a defender by his rank among the board's defenders", () => {
    const r = comparableRanks(board, "overall", { defendersSeparately: true });
    expect(r.get("lb")).toBe(1);
    expect(r.get("c")).toBe(3);
    const gap = rankGap(
      { basis: "overall", ranks: { lb: { overall: 4, position: 4 } }, ranksDefenders: true },
      board[1],
      1,
    );
    expect(gap).toMatchObject({ kind: "gap", direction: "higher", spots: 3 });
  });
});

describe("biggestDisagreements", () => {
  it("splits higher and lower, biggest first, and skips agreements", () => {
    const ordered = [
      { playerId: "a", name: "A", position: "RB" },
      { playerId: "b", name: "B", position: "WR" },
      { playerId: "c", name: "C", position: "WR" },
      { playerId: "d", name: "D", position: "TE" },
    ];
    const comparison = {
      basis: "overall" as const,
      ranks: {
        a: { overall: 9, position: 1 },
        b: { overall: 2, position: 1 },
        c: { overall: 1, position: 1 },
        d: { overall: 4, position: 1 },
      },
    };
    const out = biggestDisagreements(ordered, comparison);
    expect(out.higher.map((d) => [d.playerId, d.spots])).toEqual([["a", 8]]);
    expect(out.lower.map((d) => [d.playerId, d.spots])).toEqual([["c", -2]]);
  });
});
