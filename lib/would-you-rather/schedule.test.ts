import { describe, expect, it } from "vitest";
import {
  describePostHour,
  describeSchedule,
  easternSlot,
  isPostHour,
  pollClosesAt,
  shouldIngestNow,
  POLL_FINALIZE_GRACE_MS,
} from "./schedule";

describe("easternSlot", () => {
  it("reads the Eastern hour during daylight saving", () => {
    // 2026-08-28T12:00Z is 8am EDT.
    const slot = easternSlot(new Date("2026-08-28T12:00:00Z"));
    expect(slot).toEqual({ date: "2026-08-28", hour: 8, key: "2026-08-28-08" });
  });

  it("reads the Eastern hour during standard time", () => {
    // 2026-01-15T13:00Z is 8am EST. The SAME wall-clock hour as the case above
    // from a different UTC hour, which is the reason this module exists.
    const slot = easternSlot(new Date("2026-01-15T13:00:00Z"));
    expect(slot).toEqual({ date: "2026-01-15", hour: 8, key: "2026-01-15-08" });
  });

  it("keeps the Eastern calendar day when UTC has already rolled over", () => {
    // 2026-08-29T02:00Z is 10pm on the 28th in Eastern.
    const slot = easternSlot(new Date("2026-08-29T02:00:00Z"));
    expect(slot.date).toBe("2026-08-28");
    expect(slot.hour).toBe(22);
  });

  it("renders midnight as hour 0, not 24", () => {
    const slot = easternSlot(new Date("2026-08-28T04:00:00Z"));
    expect(slot.hour).toBe(0);
    expect(slot.key).toBe("2026-08-28-00");
  });
});

describe("isPostHour", () => {
  const noon = new Date("2026-08-28T12:00:00Z"); // 8am EDT

  it("fires on a selected hour", () => {
    expect(isPostHour(noon, [8, 15, 20])).toBe(true);
  });

  it("stays quiet on an hour nobody picked", () => {
    expect(isPostHour(noon, [15, 20])).toBe(false);
  });

  it("posts nothing when no hours are selected", () => {
    expect(isPostHour(noon, [])).toBe(false);
  });

  it("honours a once-a-day schedule at an arbitrary hour", () => {
    // The admin asked for 6pm only. 22:00Z is 6pm EDT.
    expect(isPostHour(new Date("2026-08-28T22:00:00Z"), [18])).toBe(true);
    expect(isPostHour(new Date("2026-08-28T12:00:00Z"), [18])).toBe(false);
  });
});

describe("describePostHour", () => {
  it("renders a 12-hour clock", () => {
    expect(describePostHour(0)).toBe("12:00 AM");
    expect(describePostHour(8)).toBe("8:00 AM");
    expect(describePostHour(12)).toBe("12:00 PM");
    expect(describePostHour(15)).toBe("3:00 PM");
    expect(describePostHour(20)).toBe("8:00 PM");
  });
});

describe("describeSchedule", () => {
  it("names the frequency before the times", () => {
    expect(describeSchedule([8, 15, 20])).toBe(
      "3 times a day, at 8:00 AM, 3:00 PM, 8:00 PM Eastern.",
    );
    expect(describeSchedule([18])).toBe("Once a day, at 6:00 PM Eastern.");
    expect(describeSchedule([8, 20])).toBe("Twice a day, at 8:00 AM, 8:00 PM Eastern.");
  });

  it("says plainly when nothing will post", () => {
    expect(describeSchedule([])).toBe("No times selected, so nothing will post.");
  });
});

describe("pollClosesAt", () => {
  it("adds the configured window", () => {
    const opened = new Date("2026-08-28T12:00:00Z");
    expect(pollClosesAt(opened, 72).toISOString()).toBe("2026-08-31T12:00:00.000Z");
  });
});

describe("shouldIngestNow", () => {
  const closes = new Date("2026-08-31T12:00:00Z");

  it("waits while the poll is still open", () => {
    expect(shouldIngestNow(new Date("2026-08-30T12:00:00Z"), closes, false)).toBe(false);
    expect(shouldIngestNow(new Date("2026-08-30T12:00:00Z"), closes, true)).toBe(false);
  });

  it("ingests as soon as Discord finalizes", () => {
    expect(shouldIngestNow(new Date("2026-08-31T13:00:00Z"), closes, true)).toBe(true);
  });

  it("waits out the grace window when Discord has not finalized", () => {
    expect(shouldIngestNow(new Date("2026-08-31T13:00:00Z"), closes, false)).toBe(false);
    const past = new Date(closes.getTime() + POLL_FINALIZE_GRACE_MS);
    expect(shouldIngestNow(past, closes, false)).toBe(true);
  });
});
