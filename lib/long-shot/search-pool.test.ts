import { describe, expect, it } from "vitest";
import { intersectPool } from "./search-pool";

describe("intersectPool", () => {
  it("drops an id the pool does not contain and keeps order", () => {
    expect(intersectPool(["a", "b", "c"], new Set(["c", "a"]))).toEqual(["a", "c"]);
  });
});
