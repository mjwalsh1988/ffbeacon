import { describe, expect, it } from "vitest";
import { paginationItems } from "@/components/beacon-brief/brief-pagination";

/**
 * The windowing logic behind the Brief's numbered pagination.
 *
 * What matters for crawlability is the invariant these tests pin down: page 1 and the
 * last page are always linked from every page, so the archive never stretches into a
 * chain a crawler has to walk one hop at a time. That was the original problem.
 */
describe("paginationItems", () => {
  it("lists every page when they all fit", () => {
    expect(paginationItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the far side into a gap", () => {
    expect(paginationItems(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(paginationItems(20, 20)).toEqual([1, "gap", 19, 20]);
  });

  it("collapses both sides when the current page is in the middle", () => {
    expect(paginationItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
  });

  it("always links the first and last page, from any page", () => {
    for (const total of [1, 2, 5, 20, 137]) {
      for (const current of [1, 2, Math.ceil(total / 2), total]) {
        const items = paginationItems(current, total);
        expect(items).toContain(1);
        expect(items).toContain(total);
      }
    }
  });

  it("never emits a gap that hides only one page", () => {
    // A "..." standing in for a single number is worse than the number itself: it
    // costs a hop for nothing.
    for (let total = 1; total <= 30; total++) {
      for (let current = 1; current <= total; current++) {
        const items = paginationItems(current, total);
        for (let i = 1; i < items.length - 1; i++) {
          if (items[i] !== "gap") continue;
          const before = items[i - 1] as number;
          const after = items[i + 1] as number;
          expect(after - before).toBeGreaterThan(2);
        }
      }
    }
  });

  it("emits no duplicates and stays ascending", () => {
    for (const total of [1, 3, 7, 50]) {
      for (let current = 1; current <= total; current++) {
        const numbers = paginationItems(current, total).filter(
          (i): i is number => i !== "gap",
        );
        expect(new Set(numbers).size).toBe(numbers.length);
        expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      }
    }
  });

  it("handles a single page", () => {
    expect(paginationItems(1, 1)).toEqual([1]);
  });

  it("respects a wider window", () => {
    expect(paginationItems(10, 20, 2)).toEqual([
      1,
      "gap",
      8,
      9,
      10,
      11,
      12,
      "gap",
      20,
    ]);
  });
});
