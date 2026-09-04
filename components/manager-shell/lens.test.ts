import { describe, it, expect } from "vitest";
import {
  underLens,
  perTypeUnderLens,
  perTypeSlice,
  defaultLens,
  lensLabel,
} from "./lens";
import type { PerTypeStat, PoolableStat } from "@/lib/manager-pulse/types";

describe("underLens", () => {
  const stat: PoolableStat<number> = { all: 10, dynasty: 7, redraft: 3 };

  it("reads the matching slice for each lens", () => {
    expect(underLens(stat, "all")).toBe(10);
    expect(underLens(stat, "dynasty")).toBe(7);
    expect(underLens(stat, "redraft")).toBe(3);
  });

  it("returns null for a null or undefined stat", () => {
    expect(underLens(null, "all")).toBeNull();
    expect(underLens(undefined, "dynasty")).toBeNull();
  });

  it("returns null when the slice itself is null", () => {
    const partial: PoolableStat<number> = { all: null, dynasty: 4, redraft: null };
    expect(underLens(partial, "all")).toBeNull();
    expect(underLens(partial, "redraft")).toBeNull();
    expect(underLens(partial, "dynasty")).toBe(4);
  });
});

describe("perTypeUnderLens", () => {
  it("returns both types under the all lens", () => {
    expect(perTypeUnderLens("all")).toEqual(["dynasty", "redraft"]);
  });

  it("returns only dynasty under the dynasty lens", () => {
    expect(perTypeUnderLens("dynasty")).toEqual(["dynasty"]);
  });

  it("returns only redraft under the redraft lens", () => {
    expect(perTypeUnderLens("redraft")).toEqual(["redraft"]);
  });
});

describe("perTypeSlice", () => {
  const stat: PerTypeStat<number> = { dynasty: 5, redraft: null };

  it("reads the named slice", () => {
    expect(perTypeSlice(stat, "dynasty")).toBe(5);
    expect(perTypeSlice(stat, "redraft")).toBeNull();
  });
});

describe("defaultLens", () => {
  it("prefers dynasty when it holds more league-seasons", () => {
    expect(defaultLens({ dynasty: 19, redraft: 12 })).toBe("dynasty");
  });

  it("prefers redraft when it holds more league-seasons", () => {
    expect(defaultLens({ dynasty: 3, redraft: 8 })).toBe("redraft");
  });

  it("falls back to all on a tie", () => {
    expect(defaultLens({ dynasty: 5, redraft: 5 })).toBe("all");
  });

  it("falls back to all when both are zero", () => {
    expect(defaultLens({ dynasty: 0, redraft: 0 })).toBe("all");
  });
});

describe("lensLabel", () => {
  it("labels every lens in plain words", () => {
    expect(lensLabel("all")).toBe("All");
    expect(lensLabel("dynasty")).toBe("Dynasty");
    expect(lensLabel("redraft")).toBe("Redraft");
  });
});
