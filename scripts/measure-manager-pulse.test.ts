import { describe, it, expect } from "vitest";
import {
  detectPollTransitions,
  computeDurationStats,
  percentile,
  parseArgs,
  extractProjectRef,
  evaluateColdGuard,
  COLD_ACKNOWLEDGE_FLAG,
  type ProgressSample,
} from "./measure-manager-pulse";

/* -------------------------------------------------------------------------- */
/* detectPollTransitions: the recorded-sequence contract from MPS-T053         */
/* -------------------------------------------------------------------------- */

function sample(overrides: Partial<ProgressSample>): ProgressSample {
  return {
    tSeconds: 0,
    status: "capturing",
    leaguesTotal: 10,
    leaguesFailed: 0,
    leaguesDone: 0,
    partialVersion: 0,
    ...overrides,
  };
}

describe("detectPollTransitions", () => {
  it("returns all-null transitions for an empty sequence", () => {
    expect(detectPollTransitions([])).toEqual({
      firstLeagueSeconds: null,
      firstLiveSeconds: null,
      computingSeconds: null,
      completeSeconds: null,
    });
  });

  it("walks a full recorded sequence: enqueue, first league, first live, computing, complete", () => {
    const sequence: ProgressSample[] = [
      // Enqueue. Two league-seasons were already fresh, so leaguesDone starts
      // at 2. This is the baseline "first league" is measured against.
      sample({ tSeconds: 1, status: "capturing", leaguesDone: 2, partialVersion: 0 }),
      sample({ tSeconds: 2, status: "capturing", leaguesDone: 2, partialVersion: 0 }),
      // A third league finishes: the first real progress past the baseline.
      sample({ tSeconds: 3, status: "capturing", leaguesDone: 3, partialVersion: 0 }),
      sample({ tSeconds: 4, status: "capturing", leaguesDone: 4, partialVersion: 0 }),
      // A live report checkpoint lands.
      sample({ tSeconds: 5, status: "capturing", leaguesDone: 5, partialVersion: 1 }),
      sample({ tSeconds: 6, status: "capturing", leaguesDone: 7, partialVersion: 1 }),
      // Capture finishes, computing starts.
      sample({ tSeconds: 7, status: "computing", leaguesDone: 10, partialVersion: 2 }),
      sample({ tSeconds: 8, status: "computing", leaguesDone: 10, partialVersion: 2 }),
      // Done.
      sample({ tSeconds: 9, status: "complete", leaguesDone: 10, partialVersion: 2 }),
    ];

    expect(detectPollTransitions(sequence)).toEqual({
      firstLeagueSeconds: 3,
      firstLiveSeconds: 5,
      computingSeconds: 7,
      completeSeconds: 9,
    });
  });

  it("never reports first league when leaguesDone never rises above the enqueue baseline", () => {
    // Every league-season was already fresh at enqueue: nothing new ever finishes.
    const sequence: ProgressSample[] = [
      sample({ tSeconds: 1, status: "computing", leaguesDone: 10, partialVersion: 0 }),
      sample({ tSeconds: 2, status: "complete", leaguesDone: 10, partialVersion: 0 }),
    ];

    const result = detectPollTransitions(sequence);
    expect(result.firstLeagueSeconds).toBeNull();
    expect(result.completeSeconds).toBe(2);
  });

  it("reports firstLive as null before Phase 3, when partialVersion is always 0", () => {
    const sequence: ProgressSample[] = [
      sample({ tSeconds: 1, status: "capturing", leaguesDone: 0, partialVersion: 0 }),
      sample({ tSeconds: 2, status: "capturing", leaguesDone: 5, partialVersion: 0 }),
      sample({ tSeconds: 3, status: "computing", leaguesDone: 10, partialVersion: 0 }),
      sample({ tSeconds: 4, status: "complete", leaguesDone: 10, partialVersion: 0 }),
    ];

    const result = detectPollTransitions(sequence);
    expect(result.firstLiveSeconds).toBeNull();
    expect(result.firstLeagueSeconds).toBe(2);
    expect(result.computingSeconds).toBe(3);
    expect(result.completeSeconds).toBe(4);
  });

  it("stops advancing complete once reached, even if later samples look stale", () => {
    const sequence: ProgressSample[] = [
      sample({ tSeconds: 1, status: "computing", leaguesDone: 10 }),
      sample({ tSeconds: 2, status: "complete", leaguesDone: 10 }),
      // A late, out-of-order poll should never move an already-observed transition.
      sample({ tSeconds: 3, status: "complete", leaguesDone: 10 }),
    ];

    expect(detectPollTransitions(sequence).completeSeconds).toBe(2);
  });

  it("handles a run that ends in error rather than complete", () => {
    const sequence: ProgressSample[] = [
      sample({ tSeconds: 1, status: "capturing", leaguesDone: 0 }),
      sample({ tSeconds: 2, status: "error", leaguesDone: 3, leaguesFailed: 7 }),
    ];

    const result = detectPollTransitions(sequence);
    expect(result.completeSeconds).toBeNull();
    expect(result.firstLeagueSeconds).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* percentile / computeDurationStats                                          */
/* -------------------------------------------------------------------------- */

describe("percentile", () => {
  it("returns null for an empty array", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("returns the only value for a single-element array at any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("uses nearest-rank on a sorted array", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // ceil(0.95 * 10) = 10th (last) element.
    expect(percentile(sorted, 95)).toBe(10);
    // ceil(0.5 * 10) = 5th element.
    expect(percentile(sorted, 50)).toBe(5);
  });
});

describe("computeDurationStats", () => {
  it("returns null max and p95 for no durations", () => {
    expect(computeDurationStats([])).toEqual({ max: null, p95: null });
  });

  it("computes max and p95 over an unsorted list", () => {
    const result = computeDurationStats([300, 100, 900, 200, 500, 400, 800, 700, 600, 1000]);
    expect(result.max).toBe(1000);
    expect(result.p95).toBe(1000);
  });
});

/* -------------------------------------------------------------------------- */
/* parseArgs                                                                  */
/* -------------------------------------------------------------------------- */

describe("parseArgs", () => {
  it("collects repeated --handle flags, lowercased", () => {
    const parsed = parseArgs(["--handle", "SomeHandle", "--handle", "other_one"]);
    expect(parsed.handles).toEqual(["somehandle", "other_one"]);
    expect(parsed.cold).toBe(false);
    expect(parsed.label).toBeNull();
    expect(parsed.acknowledgeDestructive).toBe(false);
    expect(parsed.confirmProjectRef).toBeNull();
    expect(parsed.measuringUserId).toBeNull();
    expect(parsed.legacyCookieFlagUsed).toBe(false);
  });

  it("reads --label, --cold and the cold-gating flags", () => {
    const parsed = parseArgs([
      "--handle",
      "abc",
      "--label",
      "baseline small",
      "--cold",
      COLD_ACKNOWLEDGE_FLAG,
      "--confirm-project",
      "cilvpyivysjxpxbudkfa",
      "--measuring-user-id",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(parsed.label).toBe("baseline small");
    expect(parsed.cold).toBe(true);
    expect(parsed.acknowledgeDestructive).toBe(true);
    expect(parsed.confirmProjectRef).toBe("cilvpyivysjxpxbudkfa");
    expect(parsed.measuringUserId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns no handles when none were passed", () => {
    expect(parseArgs(["--cold"]).handles).toEqual([]);
  });

  it("refuses to read a --cookie value: only the flag's presence is recorded", () => {
    const parsed = parseArgs(["--handle", "abc", "--cookie", "sb-access-token=secret"]);
    expect(parsed.legacyCookieFlagUsed).toBe(true);
    // No field on the parsed result carries the cookie value; the type
    // itself has no "cookie" property, and this asserts the object has
    // nothing under that key at runtime either.
    expect((parsed as Record<string, unknown>).cookie).toBeUndefined();
    // The value that followed --cookie is consumed as the flag's argument,
    // not reinterpreted as a second --handle.
    expect(parsed.handles).toEqual(["abc"]);
  });
});

/* -------------------------------------------------------------------------- */
/* extractProjectRef                                                          */
/* -------------------------------------------------------------------------- */

describe("extractProjectRef", () => {
  it("takes the subdomain off a Supabase project URL", () => {
    expect(extractProjectRef("https://cilvpyivysjxpxbudkfa.supabase.co")).toBe(
      "cilvpyivysjxpxbudkfa",
    );
  });

  it("falls back to the raw string when it does not parse as a URL", () => {
    expect(extractProjectRef("not-a-url")).toBe("not-a-url");
  });

  it("falls back to the raw string for an empty value", () => {
    expect(extractProjectRef("")).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* evaluateColdGuard: the --cold safety gate, from the reviewer's MEDIUM #1    */
/* -------------------------------------------------------------------------- */

describe("evaluateColdGuard", () => {
  const PROJECT_REF = "cilvpyivysjxpxbudkfa";
  const USER_ID = "11111111-1111-4111-8111-111111111111";

  it("is always ok when --cold was not requested, regardless of the other flags", () => {
    expect(
      evaluateColdGuard(
        { cold: false, acknowledgeDestructive: false, confirmProjectRef: null, measuringUserId: null },
        PROJECT_REF,
      ),
    ).toEqual({ ok: true });
  });

  it("refuses --cold with none of the gating flags present", () => {
    const result = evaluateColdGuard(
      { cold: true, acknowledgeDestructive: false, confirmProjectRef: null, measuringUserId: null },
      PROJECT_REF,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(COLD_ACKNOWLEDGE_FLAG);
  });

  it("refuses --cold missing --measuring-user-id even once acknowledged", () => {
    const result = evaluateColdGuard(
      { cold: true, acknowledgeDestructive: true, confirmProjectRef: PROJECT_REF, measuringUserId: null },
      PROJECT_REF,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("--measuring-user-id");
  });

  it("refuses --cold with a --measuring-user-id that is not a plausible uuid", () => {
    const result = evaluateColdGuard(
      {
        cold: true,
        acknowledgeDestructive: true,
        confirmProjectRef: PROJECT_REF,
        measuringUserId: "not-a-uuid",
      },
      PROJECT_REF,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses --cold with no --confirm-project at all", () => {
    const result = evaluateColdGuard(
      { cold: true, acknowledgeDestructive: true, confirmProjectRef: null, measuringUserId: USER_ID },
      PROJECT_REF,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(PROJECT_REF);
  });

  it("refuses --cold when --confirm-project does not match the resolved project ref", () => {
    const result = evaluateColdGuard(
      {
        cold: true,
        acknowledgeDestructive: true,
        confirmProjectRef: "some-other-project",
        measuringUserId: USER_ID,
      },
      PROJECT_REF,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("some-other-project");
      expect(result.reason).toContain(PROJECT_REF);
    }
  });

  it("allows --cold once every gating flag is present and the project ref matches", () => {
    const result = evaluateColdGuard(
      {
        cold: true,
        acknowledgeDestructive: true,
        confirmProjectRef: PROJECT_REF,
        measuringUserId: USER_ID,
      },
      PROJECT_REF,
    );
    expect(result).toEqual({ ok: true });
  });
});
