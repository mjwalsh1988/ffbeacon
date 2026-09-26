import { describe, expect, it } from "vitest";
import { rankCommunity } from "./rank";

const fit = new Map([
  ["a", { strength: 2, group: "offense" }],
  ["b", { strength: 1, group: "offense" }],
  ["c", { strength: 1, group: "offense" }],
  ["d", { strength: 0.5, group: "offense" }],
  ["e", { strength: -3, group: "offense" }],
  ["l1", { strength: 1, group: "defense" }],
  ["l2", { strength: -1, group: "defense" }],
]);
const positions = new Map([
  ["a", "QB"], ["b", "RB"], ["c", "QB"], ["d", "RB"], ["e", "QB"], ["l1", "LB"], ["l2", "LB"],
]);
const boards = new Map([
  ["a", 9], ["b", 5], ["c", 7], ["d", 4], ["e", 6], ["l1", 5], ["l2", 5],
]);

describe("rankCommunity", () => {
  const rows = rankCommunity({
    fit,
    positions,
    boardsCount: boards,
    minBoardsPerPlayer: 5,
    previousRanks: new Map([["a", 2]]),
  });

  it("drops players below minBoardsPerPlayer", () => {
    expect(rows.find((r) => r.playerId === "d")).toBeUndefined();
    expect(rows).toHaveLength(6);
  });

  it("ranks within each group, ties by player id", () => {
    const offense = rows.filter((r) => r.group === "offense");
    expect(offense.map((r) => r.playerId)).toEqual(["a", "b", "c", "e"]);
    expect(offense.map((r) => r.overallRank)).toEqual([1, 2, 3, 4]);
    const defense = rows.filter((r) => r.group === "defense");
    expect(defense.map((r) => [r.playerId, r.overallRank])).toEqual([["l1", 1], ["l2", 2]]);
  });

  it("gives position ranks within group and position", () => {
    const byId = new Map(rows.map((r) => [r.playerId, r]));
    expect(byId.get("a")?.positionRank).toBe(1);
    expect(byId.get("c")?.positionRank).toBe(2);
    expect(byId.get("e")?.positionRank).toBe(3);
    expect(byId.get("b")?.positionRank).toBe(1);
    expect(byId.get("l2")?.positionRank).toBe(2);
  });

  it("carries previous rank and boards count", () => {
    const a = rows.find((r) => r.playerId === "a");
    expect(a?.previousRank).toBe(2);
    expect(a?.boardsCount).toBe(9);
    expect(rows.find((r) => r.playerId === "b")?.previousRank).toBeNull();
  });
});
