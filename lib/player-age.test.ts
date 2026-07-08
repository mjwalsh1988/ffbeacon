import { describe, it, expect } from "vitest";
import {
  computeAgeYears,
  computeAgeDecimal,
  formatAge,
  formatAgeNumber,
} from "./player-age";

describe("computeAgeYears", () => {
  it("returns whole years and respects the birthday boundary", () => {
    expect(computeAgeYears("2000-06-15", new Date("2026-06-15"))).toBe(26);
    expect(computeAgeYears("2000-06-15", new Date("2026-06-14"))).toBe(25);
    expect(computeAgeYears("2000-12-31", new Date("2026-06-27"))).toBe(25);
  });

  it("rejects bad input and implausible ages", () => {
    expect(computeAgeYears(null, new Date("2026-06-15"))).toBeNull();
    expect(computeAgeYears("garbage", new Date("2026-06-15"))).toBeNull();
    expect(computeAgeYears("1900-01-01", new Date("2026-06-15"))).toBeNull();
  });
});

describe("computeAgeDecimal", () => {
  it("is exactly the whole number on a birthday", () => {
    expect(computeAgeDecimal("2000-06-15", new Date("2026-06-15"))).toBe(26);
  });

  it("grows through the year toward the next birthday", () => {
    // ~half a year past a Jan 1 birthday.
    const age = computeAgeDecimal("2000-01-01", new Date("2026-07-02"));
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThan(26.4);
    expect(age as number).toBeLessThan(26.6);
  });

  it("rejects bad input, future dates, and implausible ages", () => {
    expect(computeAgeDecimal(null, new Date("2026-06-15"))).toBeNull();
    expect(computeAgeDecimal("2000-13-40", new Date("2026-06-15"))).toBeNull();
    expect(computeAgeDecimal("2030-01-01", new Date("2026-06-15"))).toBeNull();
  });
});

describe("formatAge", () => {
  it("carries exactly one decimal place", () => {
    expect(formatAge("2000-06-15", new Date("2026-06-15"))).toBe("26.0");
    expect(formatAge("2000-01-01", new Date("2026-07-02"))).toBe("26.5");
  });

  it("returns null when there is no usable birth date", () => {
    expect(formatAge(null, new Date("2026-06-15"))).toBeNull();
    expect(formatAge("nope", new Date("2026-06-15"))).toBeNull();
  });
});

describe("formatAgeNumber", () => {
  it("formats a numeric age to one decimal", () => {
    expect(formatAgeNumber(24)).toBe("24.0");
    expect(formatAgeNumber(23.44)).toBe("23.4");
  });

  it("returns null for null/non-finite input", () => {
    expect(formatAgeNumber(null)).toBeNull();
    expect(formatAgeNumber(undefined)).toBeNull();
    expect(formatAgeNumber(Number.NaN)).toBeNull();
  });
});
