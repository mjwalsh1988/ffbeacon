import { describe, expect, it } from "vitest";
import { snapshotPickVerdict } from "./draft-snapshot";

describe("snapshotPickVerdict (IDP-131)", () => {
  it("stores no verdict for a pick with no value behind it, and says it is ADP only", () => {
    expect(snapshotPickVerdict({ isKeeper: false, beaconValue: null, delta: 30, threshold: 12 })).toEqual({
      verdict: null,
      adpOnly: true,
    });
  });

  it("keeps the ADP verdict when a value exists", () => {
    expect(snapshotPickVerdict({ isKeeper: false, beaconValue: 4200, delta: 30, threshold: 12 })).toEqual({
      verdict: "value",
      adpOnly: false,
    });
  });

  it("never grades a keeper", () => {
    expect(snapshotPickVerdict({ isKeeper: true, beaconValue: 4200, delta: 30, threshold: 12 }).verdict).toBeNull();
  });
});
