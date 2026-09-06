import { describe, expect, it } from "vitest";
import { estimateRemaining, formatElapsed } from "./progress-estimate";

describe("formatElapsed", () => {
  it("formats zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("formats 59 seconds as m:ss", () => {
    expect(formatElapsed(59_000)).toBe("0:59");
  });

  it("formats 61 seconds as m:ss", () => {
    expect(formatElapsed(61_000)).toBe("1:01");
  });

  it("formats an hour past as h:mm:ss", () => {
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });

  it("never goes negative", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

describe("estimateRemaining", () => {
  it("is null before the minimum done count is reached", () => {
    expect(
      estimateRemaining({ done: 2, total: 90, elapsedMs: 60_000 }),
    ).toBeNull();
  });

  it("is null before the minimum elapsed time is reached", () => {
    expect(
      estimateRemaining({ done: 30, total: 90, elapsedMs: 10_000 }),
    ).toBeNull();
  });

  it("is null when there is nothing left to do", () => {
    expect(
      estimateRemaining({ done: 90, total: 90, elapsedMs: 60_000 }),
    ).toBeNull();
  });

  it("is null when done has overshot total", () => {
    expect(
      estimateRemaining({ done: 95, total: 90, elapsedMs: 60_000 }),
    ).toBeNull();
  });

  it("says about 2 minutes left for 30 of 90 done in 60 seconds", () => {
    expect(
      estimateRemaining({ done: 30, total: 90, elapsedMs: 60_000 }),
    ).toBe("about 2 minutes left");
  });

  it("says about a minute left for 89 of 90 done in 60 seconds", () => {
    expect(
      estimateRemaining({ done: 89, total: 90, elapsedMs: 60_000 }),
    ).toBe("about a minute left");
  });

  it("states the estimate as an estimate", () => {
    const text = estimateRemaining({ done: 30, total: 90, elapsedMs: 60_000 });
    expect(text).toContain("about");
  });

  it("respects a custom minDone threshold", () => {
    expect(
      estimateRemaining({ done: 5, total: 90, elapsedMs: 60_000, minDone: 10 }),
    ).toBeNull();
  });

  it("respects a custom minElapsedMs threshold", () => {
    expect(
      estimateRemaining({
        done: 30,
        total: 90,
        elapsedMs: 5_000,
        minElapsedMs: 1_000,
      }),
    ).not.toBeNull();
  });
});
