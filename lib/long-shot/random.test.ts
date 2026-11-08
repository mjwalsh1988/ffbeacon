import { describe, expect, it } from "vitest";
import { mulberry32, pick, seedFor, shuffle } from "./random";

const take = (rng: () => number, n: number) => Array.from({ length: n }, () => rng());

describe("random", () => {
  it("same seed, same sequence", () => {
    expect(take(mulberry32(seedFor("2026-11-08", 0)), 10)).toEqual(
      take(mulberry32(seedFor("2026-11-08", 0)), 10),
    );
  });

  it("different salt, different sequence", () => {
    expect(take(mulberry32(seedFor("2026-11-08", 0)), 5)).not.toEqual(
      take(mulberry32(seedFor("2026-11-08", 1)), 5),
    );
  });

  it("values stay in [0, 1)", () => {
    for (const v of take(mulberry32(42), 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seedFor is yyyymmdd * 31 + salt", () => {
    expect(seedFor("2026-11-08", 3)).toBe(20261108 * 31 + 3);
  });

  it("shuffle is a permutation and does not mutate", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, mulberry32(7));
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("pick returns a member and throws on empty", () => {
    expect(["a", "b"]).toContain(pick(["a", "b"], mulberry32(1)));
    expect(() => pick([], mulberry32(1))).toThrow();
  });
});
