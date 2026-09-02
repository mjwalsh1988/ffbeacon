import { describe, it, expect } from "vitest";
import { defenseSeasonsFor } from "./defense-seasons";

describe("defenseSeasonsFor", () => {
  it("returns the season itself first, then the two before it", () => {
    expect(defenseSeasonsFor(2026)).toEqual([2026, 2025, 2024]);
  });

  it("stays most-recent-first for any season", () => {
    expect(defenseSeasonsFor(2020)).toEqual([2020, 2019, 2018]);
  });

  it("returns exactly three candidates", () => {
    expect(defenseSeasonsFor(2026)).toHaveLength(3);
  });

  it("is pure: repeated calls with the same input return equal arrays", () => {
    expect(defenseSeasonsFor(2026)).toEqual(defenseSeasonsFor(2026));
  });
});
