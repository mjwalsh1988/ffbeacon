import { describe, expect, it } from "vitest";
import { applyOrder, isPermutationOf, moveEntry, normalizeOrder, packRows } from "./order";

describe("normalizeOrder", () => {
  const known = ["a", "b", "c"] as const;

  it("returns known when nothing is stored", () => {
    expect(normalizeOrder(null, known)).toEqual(["a", "b", "c"]);
    expect(normalizeOrder(undefined, known)).toEqual(["a", "b", "c"]);
  });

  it("keeps a complete stored order as it is", () => {
    expect(normalizeOrder(["c", "a", "b"], known)).toEqual(["c", "a", "b"]);
  });

  it("drops unknown entries, non-strings and repeats", () => {
    expect(normalizeOrder(["c", "zz", 4, "c", "a"], known)).toEqual(["c", "a", "b"]);
  });

  it("appends anything missing in known order", () => {
    expect(normalizeOrder(["b"], known)).toEqual(["b", "a", "c"]);
  });
});

describe("isPermutationOf", () => {
  it("accepts a rearrangement", () => {
    expect(isPermutationOf(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("refuses a short list, a repeat or a stranger", () => {
    expect(isPermutationOf(["a"], ["a", "b"])).toBe(false);
    expect(isPermutationOf(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutationOf(["a", "x"], ["a", "b"])).toBe(false);
  });
});

describe("applyOrder", () => {
  it("sorts items by key and leaves unnamed items at the end in their own order", () => {
    const items = [{ k: "a" }, { k: "b" }, { k: "c" }, { k: "d" }];
    expect(applyOrder(items, ["c", "a"], (i) => i.k).map((i) => i.k)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });
});

describe("packRows", () => {
  const widths = (list: number[]) => list;
  const pack = (list: number[], columns: number) =>
    packRows(widths(list), (w) => w, columns).map((row) => ({ items: row.items, empty: row.empty }));

  it("fills three single cards per row", () => {
    expect(pack([1, 1, 1, 1], 3)).toEqual([
      { items: [1, 1, 1], empty: 0 },
      { items: [1], empty: 2 },
    ]);
  });

  it("starts a new row when a wide card does not fit, leaving the gap empty", () => {
    expect(pack([1, 1, 2, 1], 3)).toEqual([
      { items: [1, 1], empty: 1 },
      { items: [2, 1], empty: 0 },
    ]);
  });

  it("caps a full-row card at the columns there are", () => {
    expect(pack([3, 1], 2)).toEqual([
      { items: [3], empty: 0 },
      { items: [1], empty: 1 },
    ]);
  });
});

describe("moveEntry", () => {
  it("swaps with the neighbour", () => {
    expect(moveEntry(["a", "b", "c"], 1, "up")).toEqual(["b", "a", "c"]);
    expect(moveEntry(["a", "b", "c"], 1, "down")).toEqual(["a", "c", "b"]);
  });

  it("does nothing at the ends", () => {
    const list = ["a", "b"];
    expect(moveEntry(list, 0, "up")).toBe(list);
    expect(moveEntry(list, 1, "down")).toBe(list);
  });
});
