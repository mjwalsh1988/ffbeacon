import { describe, expect, it } from "vitest";
import { progressState } from "./progress-bar";

describe("progressState", () => {
  it("is indeterminate when the total is not known yet", () => {
    const state = progressState(0, 0, null);
    expect(state.kind).toBe("indeterminate");
  });

  it("names the count read so far while indeterminate, not a percentage", () => {
    const state = progressState(6, 0, null);
    expect(state.kind).toBe("indeterminate");
    if (state.kind === "indeterminate") {
      expect(state.text).toContain("6");
      expect(state.text).not.toContain("%");
    }
  });

  it("says nothing has started yet when indeterminate with zero done", () => {
    const state = progressState(0, 0, null);
    if (state.kind === "indeterminate") {
      expect(state.text.length).toBeGreaterThan(0);
      expect(state.text).not.toContain("%");
    }
  });

  it("is indeterminate when the total is zero, never a divide by zero and never 100%", () => {
    const state = progressState(0, 0, 0);
    expect(state.kind).toBe("indeterminate");
    if (state.kind === "indeterminate") {
      expect(state.text).not.toContain("100");
      expect(state.text).not.toContain("%");
      expect(Number.isFinite(state.text.length)).toBe(true);
    }
  });

  it("is indeterminate when the total is negative", () => {
    const state = progressState(0, 0, -3);
    expect(state.kind).toBe("indeterminate");
  });

  it("is determinate and complete when done plus failed equals total", () => {
    const state = progressState(40, 4, 44);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.fraction).toBe(1);
    }
  });

  it("is determinate and partial partway through", () => {
    const state = progressState(31, 0, 44);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.fraction).toBeCloseTo(31 / 44, 5);
      expect(state.text).toBe("31 of 44 leagues read");
    }
  });

  it("never exceeds a fraction of 1 even when done plus failed overshoots total", () => {
    const state = progressState(50, 10, 40);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.fraction).toBe(1);
    }
  });

  it("never goes negative even with a negative done count", () => {
    const state = progressState(-5, 0, 10);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.fraction).toBeGreaterThanOrEqual(0);
    }
  });

  it("names both the read count and the failed count in the text when something failed", () => {
    const state = progressState(31, 3, 44);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.text).toContain("31");
      expect(state.text).toContain("44");
      expect(state.text).toContain("3");
      expect(state.text).not.toContain("%");
    }
  });

  it("the determinate text never contains a percentage sign", () => {
    const state = progressState(5, 0, 20);
    if (state.kind === "determinate") {
      expect(state.text).not.toMatch(/%/);
    }
  });
});
