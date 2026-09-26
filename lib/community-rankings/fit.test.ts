import { describe, expect, it } from "vitest";
import { aggregateBoards, type StatementBoard } from "./statements";
import { fitBradleyTerry } from "./fit";

const OPTS = { poolMargin: 1, withinBoardShare: 0.8 };

function order(fit: ReturnType<typeof fitBradleyTerry>, group?: string): string[] {
  return [...fit.players.entries()]
    .filter(([, v]) => group === undefined || v.group === group)
    .sort((a, b) => b[1].strength - a[1].strength || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

function repeat(board: StatementBoard, times: number): StatementBoard[] {
  return Array.from({ length: times }, () => board);
}

const POS = new Map<string, string>([
  ["Q1", "QB"], ["Q2", "QB"], ["Q3", "QB"], ["Q4", "QB"],
  ["R1", "RB"], ["R2", "RB"], ["R3", "RB"],
  ["W1", "WR"], ["W2", "WR"],
  ["L1", "LB"], ["L2", "LB"], ["D1", "DL"], ["D2", "DL"],
  ["A", "WR"], ["B", "WR"], ["C", "WR"], ["D", "WR"], ["E", "WR"], ["X", "WR"],
]);

describe("fitBradleyTerry", () => {
  it("quarterback boards and overall boards reinforce each other", () => {
    const qbPool = ["Q1", "Q2", "Q3", "Q4"];
    const boards = [
      // Quarterback boards settle Q2 over Q3, which overall boards never compare.
      ...repeat({ playerIds: ["Q1", "Q2", "Q3"], leftOff: [], pool: qbPool }, 6),
      // Overall boards place quarterbacks against running backs.
      ...repeat({ playerIds: ["R1", "Q1", "R2", "Q3"], leftOff: [], pool: [] }, 6),
      ...repeat({ playerIds: ["R1", "Q2", "R2"], leftOff: [], pool: [] }, 6),
    ];
    const agg = aggregateBoards(boards, OPTS);
    const fit = fitBradleyTerry(agg.wins, POS, { shrinkage: 1 });
    const ranked = order(fit);
    expect(ranked.indexOf("R1")).toBeLessThan(ranked.indexOf("Q1"));
    expect(ranked.indexOf("Q1")).toBeLessThan(ranked.indexOf("Q2"));
    expect(ranked.indexOf("Q2")).toBeLessThan(ranked.indexOf("Q3"));
    // Q2 never met R2 on a quarterback board; the overall boards place him.
    expect(ranked.indexOf("Q2")).toBeLessThan(ranked.indexOf("R2"));
    // Q4 is only a pool statement, so he stays below every quarterback who beat
    // him and his thin record is pulled toward the middle rather than the bottom.
    expect(fit.players.get("Q4")?.strength ?? 0).toBeLessThan(fit.players.get("Q2")?.strength ?? 0);
    expect(fit.groups).toEqual(["offense"]);
  });

  it("fits unconnected offense and defense apart, each normalised", () => {
    const boards = [
      ...repeat({ playerIds: ["R1", "W1", "R2", "W2", "R3"], leftOff: [], pool: [] }, 3),
      ...repeat({ playerIds: ["L1", "D1", "L2"], leftOff: [], pool: ["L1", "D1", "L2", "D2"] }, 3),
    ];
    const fit = fitBradleyTerry(aggregateBoards(boards, OPTS).wins, POS, { shrinkage: 1 });
    expect(fit.groups).toEqual(["offense", "defense"]);
    expect(fit.players.get("L1")?.group).toBe("defense");
    expect(fit.players.get("R1")?.group).toBe("offense");
    for (const group of fit.groups) {
      const logs = [...fit.players.values()].filter((v) => v.group === group).map((v) => v.strength);
      expect(logs.reduce((a, b) => a + b, 0) / logs.length).toBeCloseTo(0, 10);
    }
    expect(order(fit, "defense").filter((id) => id !== "D2")).toEqual(["L1", "D1", "L2"]);
    expect(order(fit, "offense")).toEqual(["R1", "W1", "R2", "W2", "R3"]);
  });

  it("names a mixed component all and suffixes repeated names by size", () => {
    const mixed = fitBradleyTerry(
      aggregateBoards([{ playerIds: ["R1", "L1"], leftOff: [], pool: [] }], OPTS).wins,
      POS,
      { shrinkage: 1 },
    );
    expect(mixed.groups).toEqual(["all"]);
    const two = fitBradleyTerry(
      aggregateBoards(
        [
          { playerIds: ["R1", "R2", "R3"], leftOff: [], pool: [] },
          { playerIds: ["W1", "W2"], leftOff: [], pool: [] },
        ],
        OPTS,
      ).wins,
      POS,
      { shrinkage: 1 },
    );
    expect(two.groups).toEqual(["offense", "offense-2"]);
    expect(two.players.get("W1")?.group).toBe("offense-2");
  });

  it("shrinkage keeps a player seen on two boards from topping the list", () => {
    const boards = [
      ...repeat({ playerIds: ["A", "B", "C", "D", "E"], leftOff: [], pool: [] }, 20),
      ...repeat({ playerIds: ["B", "A", "C", "D", "E"], leftOff: [], pool: [] }, 5),
      ...repeat({ playerIds: ["X", "B"], leftOff: [], pool: [] }, 2),
    ];
    const wins = aggregateBoards(boards, OPTS).wins;
    const shrunk = order(fitBradleyTerry(wins, POS, { shrinkage: 1 }));
    expect(shrunk[0]).toBe("A");
    expect(shrunk[0]).not.toBe("X");
    // Without the pull, an undefeated two-board player runs away with it.
    const raw = order(fitBradleyTerry(wins, POS, { shrinkage: 0 }));
    expect(raw[0]).toBe("X");
  });

  it("is deterministic and independent of insertion order", () => {
    const boards: StatementBoard[] = [
      { playerIds: ["A", "B", "C"], leftOff: ["E"], pool: ["A", "B", "C", "D", "E", "X"] },
      { playerIds: ["B", "C", "A"], leftOff: [], pool: ["A", "B", "C", "D", "E", "X"] },
      { playerIds: ["C", "A"], leftOff: [], pool: [] },
    ];
    const a = fitBradleyTerry(aggregateBoards(boards, OPTS).wins, POS, { shrinkage: 1 });
    const b = fitBradleyTerry(aggregateBoards([...boards].reverse(), OPTS).wins, POS, { shrinkage: 1 });
    const again = fitBradleyTerry(aggregateBoards(boards, OPTS).wins, POS, { shrinkage: 1 });
    for (const [id, v] of a.players) {
      expect(b.players.get(id)?.strength).toBeCloseTo(v.strength, 9);
      expect(again.players.get(id)).toEqual(v);
    }
    expect(a.iterations).toBeLessThanOrEqual(500);
  });
});
