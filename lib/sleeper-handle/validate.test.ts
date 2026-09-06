import { describe, expect, it } from "vitest";
import { normalizeSleeperHandle } from "./validate";

describe("normalizeSleeperHandle", () => {
  it("trims and lowercases what a person typed", () => {
    expect(normalizeSleeperHandle("  BeaconMike  ")).toBe("beaconmike");
    expect(normalizeSleeperHandle("beacon_mike")).toBe("beacon_mike");
    expect(normalizeSleeperHandle("beacon99")).toBe("beacon99");
  });

  it("rejects a dot, a space, a slash and an at sign", () => {
    expect(normalizeSleeperHandle("beacon.mike")).toBeNull();
    expect(normalizeSleeperHandle("beacon mike")).toBeNull();
    expect(normalizeSleeperHandle("beacon/mike")).toBeNull();
    expect(normalizeSleeperHandle("@beacon")).toBeNull();
  });

  it("rejects an empty string and 33 characters", () => {
    expect(normalizeSleeperHandle("")).toBeNull();
    expect(normalizeSleeperHandle("   ")).toBeNull();
    expect(normalizeSleeperHandle("a".repeat(32))).toBe("a".repeat(32));
    expect(normalizeSleeperHandle("a".repeat(33))).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    expect(normalizeSleeperHandle(null)).toBeNull();
    expect(normalizeSleeperHandle(undefined)).toBeNull();
    expect(normalizeSleeperHandle(12345)).toBeNull();
    expect(normalizeSleeperHandle(["beacon"])).toBeNull();
  });
});
