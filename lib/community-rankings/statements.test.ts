import { describe, expect, it } from "vitest";
import { addBoard, aggregateBoards, createAggregate, totalWeight } from "./statements";

const OPTS = { poolMargin: 1, withinBoardShare: 0.8 };
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const w = (agg: ReturnType<typeof createAggregate>, a: string, b: string) => agg.wins.get(a)?.get(b) ?? 0;

describe("within-board statements", () => {
  it("every player beats every player below him, weight split evenly", () => {
    const agg = aggregateBoards([{ playerIds: ["A", "B", "C"], leftOff: [], pool: [] }], OPTS);
    expect(w(agg, "A", "B")).toBeCloseTo(1 / 3);
    expect(w(agg, "A", "C")).toBeCloseTo(1 / 3);
    expect(w(agg, "B", "C")).toBeCloseTo(1 / 3);
    expect(w(agg, "B", "A")).toBe(0);
    expect(totalWeight(agg)).toBeCloseTo(1);
  });

  it("left-off players count as within statements", () => {
    const agg = aggregateBoards([{ playerIds: ["A", "B"], leftOff: ["X"], pool: [] }], OPTS);
    expect(w(agg, "A", "B")).toBeCloseTo(1 / 3);
    expect(w(agg, "A", "X")).toBeCloseTo(1 / 3);
    expect(w(agg, "B", "X")).toBeCloseTo(1 / 3);
    expect(agg.boardsCount.get("X")).toBeUndefined();
  });

  it("a left-off player in the pool is not also a pool statement", () => {
    const agg = aggregateBoards([{ playerIds: ["A", "B"], leftOff: ["C"], pool: ["A", "B", "C", "D"] }], OPTS);
    // within: A>B, A>C, B>C (3) share 0.8; pool: A>D, B>D (2) share 0.2
    expect(w(agg, "A", "C")).toBeCloseTo(0.8 / 3);
    expect(w(agg, "A", "D")).toBeCloseTo(0.1);
    expect(totalWeight(agg)).toBeCloseTo(1);
  });
});

describe("pool statements", () => {
  it("a 50 player board speaks about pool ranks 51 to 100 only", () => {
    const pool = ids("p", 150);
    const agg = aggregateBoards([{ playerIds: pool.slice(0, 50), leftOff: [], pool }], OPTS);
    const losers = new Set<string>();
    for (const row of agg.wins.values()) for (const loser of row.keys()) losers.add(loser);
    expect(losers.has("p51")).toBe(true);
    expect(losers.has("p100")).toBe(true);
    expect(losers.has("p101")).toBe(false);
    expect(losers.has("p150")).toBe(false);
  });

  it("splits the weight by withinBoardShare", () => {
    const agg = aggregateBoards([{ playerIds: ["A", "B"], leftOff: [], pool: ["A", "B", "C", "D"] }], OPTS);
    expect(w(agg, "A", "B")).toBeCloseTo(0.8);
    for (const [a, b] of [["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"]]) {
      expect(w(agg, a, b)).toBeCloseTo(0.05);
    }
    const half = aggregateBoards([{ playerIds: ["A", "B"], leftOff: [], pool: ["A", "B", "C", "D"] }], {
      poolMargin: 1,
      withinBoardShare: 0.5,
    });
    expect(w(half, "A", "B")).toBeCloseTo(0.5);
    expect(w(half, "A", "C")).toBeCloseTo(0.125);
  });

  it("two players both missing from a board get nothing", () => {
    const agg = aggregateBoards([{ playerIds: ["A"], leftOff: [], pool: ["A", "C", "D"] }], {
      poolMargin: 2,
      withinBoardShare: 0.8,
    });
    expect(w(agg, "C", "D")).toBe(0);
    expect(w(agg, "D", "C")).toBe(0);
    expect(agg.wins.has("C")).toBe(false);
  });

  it("a board with only pool statements gives them all the weight", () => {
    const agg = aggregateBoards([{ playerIds: ["A"], leftOff: [], pool: ["A", "B"] }], OPTS);
    expect(w(agg, "A", "B")).toBeCloseTo(1);
  });
});

describe("board weight", () => {
  it("a 12 player board and a 200 player board carry the same total weight", () => {
    const small = createAggregate();
    const pool = ids("q", 400);
    addBoard(small, { playerIds: pool.slice(0, 12), leftOff: [], pool }, OPTS);
    const big = createAggregate();
    addBoard(big, { playerIds: pool.slice(0, 200), leftOff: [], pool }, OPTS);
    expect(totalWeight(small)).toBeCloseTo(1);
    expect(totalWeight(big)).toBeCloseTo(1);
  });

  it("counts boards per player on the board only", () => {
    const agg = aggregateBoards(
      [
        { playerIds: ["A", "B"], leftOff: ["X"], pool: ["A", "B", "C"] },
        { playerIds: ["B", "A", "A"], leftOff: [], pool: [] },
      ],
      OPTS,
    );
    expect(agg.boardsCount.get("A")).toBe(2);
    expect(agg.boardsCount.get("B")).toBe(2);
    expect(agg.boardsCount.get("C")).toBeUndefined();
    expect(agg.boards).toBe(2);
  });
});
