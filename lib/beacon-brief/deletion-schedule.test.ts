import { describe, expect, it } from "vitest";
import { isDeletionCheckDue, sweepLookbackMs } from "./deletion";
import { parseCheckSchedule } from "./settings";
import { BEACON_BRIEF_DEFAULTS } from "./settings";

/**
 * The tapered deletion schedule.
 *
 * The property that matters is the one the old chained design did not have:
 * due-ness is a pure function of stored state, so a run that never happens (the
 * X credit outage on 2026-07-31 stopped every one of them for 16 hours) delays
 * the watch and never cancels it. Anything overdue is simply still overdue.
 */

const HOUR = 3_600_000;
/** The shipped schedule: one check an hour in, one at the seven-day mark. */
const SCHEDULE = [1, 168];
const CREATED = "2026-07-01T00:00:00.000Z";
const at = (hoursAfterCreation: number) =>
  new Date(CREATED).getTime() + hoursAfterCreation * HOUR;
const iso = (hoursAfterCreation: number) =>
  new Date(at(hoursAfterCreation)).toISOString();

describe("isDeletionCheckDue", () => {
  const due = (hoursNow: number, lastCheckedAt: string | null) =>
    isDeletionCheckDue({
      createdAt: CREATED,
      lastCheckedAt,
      scheduleHours: SCHEDULE,
      nowMs: at(hoursNow),
    });

  it("waits for the first checkpoint before checking anything", () => {
    expect(due(0.5, null)).toBe(false);
    expect(due(1, null)).toBe(true);
  });

  it("checks once per checkpoint, not once per sweep", () => {
    // The sweep runs hourly. Checked right at the 1h mark, it must not be re-read
    // on any of the 166 sweeps between then and the 7-day checkpoint. This is the
    // property that keeps the cost at two reads per article rather than one per
    // sweep, which matters most in season when article volume spikes.
    expect(due(2, iso(1))).toBe(false);
    expect(due(24, iso(1))).toBe(false);
    expect(due(167, iso(1))).toBe(false);
    expect(due(168, iso(1))).toBe(true);
  });

  it("stops watching once the final checkpoint is satisfied", () => {
    expect(due(169, iso(168))).toBe(false);
    expect(due(24 * 30, iso(168))).toBe(false);
  });

  it("still owes a missed checkpoint after an outage", () => {
    // No sweep ran during the post's first hours, so the 1h check never happened.
    // At hour 80 it is simply still owed. The chained design lost this entirely:
    // a failed check queued no successor, so the post fell off the watch for good.
    expect(due(80, null)).toBe(true);
    expect(due(24 * 6, null)).toBe(true);
  });

  it("collapses missed checkpoints into one catch-up read", () => {
    // Only reachable on a custom schedule, but the property has to hold whenever
    // one is set on the admin Settings page: an outage that spans several
    // checkpoints costs one read to recover, not one per checkpoint missed.
    const dense = (hoursNow: number, lastCheckedAt: string | null) =>
      isDeletionCheckDue({
        createdAt: CREATED,
        lastCheckedAt,
        scheduleHours: [1, 6, 24, 72, 168],
        nowMs: at(hoursNow),
      });
    expect(dense(80, iso(1))).toBe(true); // owed 6h, 24h and 72h at once
    expect(dense(80, iso(79))).toBe(false); // one read settles all three
  });

  it("checks a never-checked post exactly once when it is already ancient", () => {
    expect(due(24 * 30, null)).toBe(true);
    expect(due(24 * 30, iso(24 * 30 - 1))).toBe(false);
  });

  it("treats unparseable timestamps as not due rather than throwing", () => {
    expect(
      isDeletionCheckDue({
        createdAt: "not a date",
        lastCheckedAt: null,
        scheduleHours: SCHEDULE,
      }),
    ).toBe(false);
    // A junk last-checked value must not read as "recently checked", which would
    // silently drop the post off the watch.
    expect(
      isDeletionCheckDue({
        createdAt: CREATED,
        lastCheckedAt: "not a date",
        scheduleHours: SCHEDULE,
        nowMs: at(10),
      }),
    ).toBe(true);
  });

  it("does nothing when the schedule is empty", () => {
    expect(
      isDeletionCheckDue({
        createdAt: CREATED,
        lastCheckedAt: null,
        scheduleHours: [],
        nowMs: at(1000),
      }),
    ).toBe(false);
  });

  it("costs exactly two reads over the post's whole life", () => {
    // The regression this guards: the previous every-6-hours-for-7-days cadence
    // was 28 reads per article, and X bills per post read. Simulates the real
    // hourly sweep across 10 days and counts what it would actually spend.
    let lastChecked: string | null = null;
    const readAtHours: number[] = [];
    for (let hour = 0; hour <= 240; hour++) {
      if (
        isDeletionCheckDue({
          createdAt: CREATED,
          lastCheckedAt: lastChecked,
          scheduleHours: SCHEDULE,
          nowMs: at(hour),
        })
      ) {
        readAtHours.push(hour);
        lastChecked = iso(hour);
      }
    }
    expect(readAtHours).toEqual([1, 168]);
  });
});

describe("the shipped schedule", () => {
  it("is two checkpoints: one hour and seven days", () => {
    // Pinned deliberately. Every checkpoint added here is a recurring X charge
    // multiplied by article volume, so growing this list is a cost decision, not
    // a tuning tweak, and should be a conscious one.
    expect(BEACON_BRIEF_DEFAULTS.deletionCheckHours).toEqual([1, 168]);
  });
});

describe("sweepLookbackMs", () => {
  it("reaches past the final checkpoint so the last check is achievable", () => {
    // With a 7-day window and a 168-hour final checkpoint, a cutoff of exactly 7
    // days would make that check unreachable: any post old enough to be due for
    // it is already too old to be selected.
    const lookback = sweepLookbackMs(BEACON_BRIEF_DEFAULTS);
    const finalCheckpoint = 168 * HOUR;
    expect(lookback).toBeGreaterThan(finalCheckpoint);
  });

  it("follows the schedule when it runs past the configured window", () => {
    const lookback = sweepLookbackMs({
      ...BEACON_BRIEF_DEFAULTS,
      deletionWatchDays: 1,
      deletionCheckHours: [1, 336],
    });
    expect(lookback).toBeGreaterThan(336 * HOUR);
  });
});

describe("parseCheckSchedule", () => {
  const fallback = [1, 6, 24, 72, 168];

  it("reads the comma-separated setting", () => {
    expect(parseCheckSchedule("1,6,24", fallback)).toEqual([1, 6, 24]);
    expect(parseCheckSchedule(" 6 , 1 , 24 ", fallback)).toEqual([1, 6, 24]);
  });

  it("sorts and de-duplicates so callers can walk it in order", () => {
    expect(parseCheckSchedule("24,1,6,1,24", fallback)).toEqual([1, 6, 24]);
  });

  it("drops junk instead of throwing, so a typo cannot stop the watch", () => {
    expect(parseCheckSchedule("1,abc,6,-3,0,24", fallback)).toEqual([1, 6, 24]);
  });

  it("falls back when the value is empty, junk, or the wrong type", () => {
    expect(parseCheckSchedule("", fallback)).toEqual(fallback);
    expect(parseCheckSchedule("abc,,-1", fallback)).toEqual(fallback);
    expect(parseCheckSchedule(null, fallback)).toEqual(fallback);
    expect(parseCheckSchedule(42, fallback)).toEqual(fallback);
  });
});
