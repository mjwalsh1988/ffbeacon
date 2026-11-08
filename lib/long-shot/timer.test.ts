import { describe, expect, it } from "vitest";
import { isExpired, remainingMs } from "./timer";

const served = new Date("2026-11-08T12:00:00.000Z");
const at = (ms: number) => new Date(served.getTime() + ms);

describe("timer", () => {
  it("is not expired at the limit or at limit plus grace", () => {
    expect(isExpired(served, 30_000, 2_000, at(30_000))).toBe(false);
    expect(isExpired(served, 30_000, 2_000, at(32_000))).toBe(false);
  });

  it("is expired one millisecond past limit plus grace", () => {
    expect(isExpired(served, 30_000, 2_000, at(32_001))).toBe(true);
  });

  it("remainingMs excludes grace and clamps at 0", () => {
    expect(remainingMs(served, 30_000, at(6_000))).toBe(24_000);
    expect(remainingMs(served, 30_000, at(31_000))).toBe(0);
  });

  it("accepts an ISO string", () => {
    expect(remainingMs(served.toISOString(), 30_000, at(0))).toBe(30_000);
  });
});
