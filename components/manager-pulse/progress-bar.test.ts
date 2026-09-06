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

  it("names the in-progress count in the text when processing is above zero", () => {
    const state = progressState(31, 0, 87, 3);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.text).toBe("31 of 87 leagues read, 3 in progress");
    }
  });

  it("names both in-progress and failed counts when both are above zero", () => {
    const state = progressState(31, 2, 87, 3);
    if (state.kind === "determinate") {
      expect(state.text).toContain("3 in progress");
      expect(state.text).toContain("2 failed");
    }
  });

  it("omits the in-progress phrase entirely when processing is zero", () => {
    const state = progressState(31, 0, 87, 0);
    if (state.kind === "determinate") {
      expect(state.text).not.toContain("in progress");
    }
  });

  it("the processing fraction never pushes the total shown past 1.0", () => {
    const state = progressState(80, 0, 100, 40);
    expect(state.kind).toBe("determinate");
    if (state.kind === "determinate") {
      expect(state.fraction + state.processingFraction).toBeLessThanOrEqual(1);
      expect(state.fraction + state.processingFraction).toBeCloseTo(1, 5);
    }
  });

  it("the processing fraction is zero when nothing is processing", () => {
    const state = progressState(31, 0, 87, 0);
    if (state.kind === "determinate") {
      expect(state.processingFraction).toBe(0);
    }
  });

  it("a negative processing count contributes nothing", () => {
    const state = progressState(31, 0, 87, -5);
    if (state.kind === "determinate") {
      expect(state.processingFraction).toBe(0);
      expect(state.text).not.toContain("in progress");
    }
  });

  it("the indeterminate branch ignores processing entirely", () => {
    const state = progressState(6, 0, null, 40);
    expect(state.kind).toBe("indeterminate");
    if (state.kind === "indeterminate") {
      expect(state.text).not.toContain("in progress");
      expect("processingFraction" in state).toBe(false);
    }
  });
});
