import { describe, it, expect } from "vitest";
import { deriveSnapshotConfidence } from "./history-lookup";

const COMPLETED = Date.parse("2026-08-31T03:21:40Z");
const HOUR = 60 * 60 * 1000;

const base = {
  valueSource: "exact" as const,
  valueDateMs: COMPLETED - 18 * HOUR,
  adpSource: "exact" as const,
  adpDateMs: COMPLETED - 18 * HOUR,
  completedAtMs: COMPLETED,
};

describe("deriveSnapshotConfidence and the projection vintage", () => {
  it("still reports high when the projections are as fresh as the draft", () => {
    expect(
      deriveSnapshotConfidence({ ...base, projectionDateMs: COMPLETED - HOUR }),
    ).toBe("high");
  });

  it("stops claiming high on the sweep that produced this rule", () => {
    // The real snapshot: draft finished 03:21, finalized 03:23, and froze a
    // projection sweep computed at 01:23. By 06:00 five of its players were on
    // IR, DNR or PUP, and by 12:01 388 of 603 had new numbers. It called itself
    // high confidence the whole time.
    //
    // Two hours is inside the six-hour window, so this one specifically is not
    // the failure; a sweep from the previous cycle is.
    expect(
      deriveSnapshotConfidence({ ...base, projectionDateMs: COMPLETED - 2 * HOUR }),
    ).toBe("high");
    expect(
      deriveSnapshotConfidence({ ...base, projectionDateMs: COMPLETED - 9 * HOUR }),
    ).toBe("medium");
  });

  it("does not penalise a snapshot that has no projections at all", () => {
    // A projection outage freezes an empty pulse on purpose, and the awards that
    // depend on it stay honestly pending. That is a different thing from stale
    // projections and must not be graded as though it were.
    expect(deriveSnapshotConfidence({ ...base, projectionDateMs: null })).toBe("high");
    expect(deriveSnapshotConfidence(base)).toBe("high");
  });

  it("leaves the value and ADP rules exactly where they were", () => {
    expect(
      deriveSnapshotConfidence({
        ...base,
        valueSource: "current_fallback",
        projectionDateMs: COMPLETED,
      }),
    ).toBe("low");
    expect(
      deriveSnapshotConfidence({
        ...base,
        adpSource: "next_available",
        projectionDateMs: COMPLETED,
      }),
    ).toBe("medium");
  });
});
