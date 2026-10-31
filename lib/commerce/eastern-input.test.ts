import { describe, expect, it } from "vitest";
import { easternLocalToIso, isoToEasternLocal } from "./eastern-input";

describe("easternLocalToIso", () => {
  it("reads daylight time as four hours behind UTC", () => {
    expect(easternLocalToIso("2026-07-01T12:30")).toBe("2026-07-01T16:30:00.000Z");
  });

  it("reads standard time as five hours behind UTC", () => {
    expect(easternLocalToIso("2026-12-01T12:30")).toBe("2026-12-01T17:30:00.000Z");
  });

  it("is right on each side of the fall change", () => {
    expect(easternLocalToIso("2026-10-31T23:00")).toBe("2026-11-01T03:00:00.000Z");
    expect(easternLocalToIso("2026-11-01T12:00")).toBe("2026-11-01T17:00:00.000Z");
  });

  it("refuses what is not a date-time", () => {
    expect(easternLocalToIso("")).toBeNull();
    expect(easternLocalToIso("tomorrow")).toBeNull();
  });
});

describe("isoToEasternLocal", () => {
  it("writes the Eastern wall clock", () => {
    expect(isoToEasternLocal("2026-07-01T16:30:00Z")).toBe("2026-07-01T12:30");
    expect(isoToEasternLocal("2026-12-01T17:30:00Z")).toBe("2026-12-01T12:30");
  });

  it("round trips", () => {
    for (const iso of ["2026-03-20T10:15:00.000Z", "2026-11-20T23:59:00.000Z"]) {
      expect(easternLocalToIso(isoToEasternLocal(iso))).toBe(iso);
    }
  });

  it("is empty for nothing", () => {
    expect(isoToEasternLocal(null)).toBe("");
    expect(isoToEasternLocal("nope")).toBe("");
  });
});
