import { describe, expect, it } from "vitest";
import { easternEpoch, easternParts } from "@/lib/relays/eastern-time";
import { periodForOffSeasonClose, periodForWeek, resolveCadence } from "./cadence";

const SETTINGS = { enabled: true, offSeasonMonthly: false, runWeekday: 2, runHourEt: 9 };
const STATE = { season: "2026", season_type: "regular", week: 2, season_start_date: "2026-09-10" };

describe("resolveCadence in season", () => {
  it("says week 1 is due from Tuesday 9 AM Eastern after Monday night", () => {
    const out = resolveCadence(STATE, SETTINGS, easternEpoch(2026, 9, 15, 9, 5));
    expect(out.period).toMatchObject({ week: 1, phase: "regular", cadence: "weekly" });
    expect(easternParts(out.period!.periodStart)).toMatchObject({ month: 9, day: 8, hour: 9 });
    expect(easternParts(out.period!.periodEnd)).toMatchObject({ month: 9, day: 15, hour: 9 });
    expect(out.period!.suggestedSlug).toBe("week-1-fantasy-football-news-injuries-2026");
  });

  it("before the close it still reports the previous period and the next close", () => {
    const out = resolveCadence(STATE, SETTINGS, easternEpoch(2026, 9, 21, 12));
    expect(out.period?.week).toBe(1);
    expect(easternParts(out.nextClose!)).toMatchObject({ month: 9, day: 22, hour: 9 });
  });

  it("counts the playoffs as post-season weeks", () => {
    const out = resolveCadence(STATE, SETTINGS, easternEpoch(2027, 1, 20, 12));
    expect(out.period).toMatchObject({ week: 19, phase: "post" });
  });

  it("never reports a period whose end is still in the future, across the November change", () => {
    // 2026-11-10 is the first Tuesday after daylight saving ends, and the cron
    // fires at 13:00 UTC, which is 8 AM Eastern that morning. A fixed seven-day
    // millisecond grid called week 9 closed an hour before it closed.
    const beforeClose = easternEpoch(2026, 11, 10, 8, 0);
    const before = resolveCadence(STATE, SETTINGS, beforeClose);
    expect(before.period?.week).toBe(8);
    expect(Date.parse(before.period!.periodEnd)).toBeLessThanOrEqual(beforeClose);
    expect(easternParts(before.nextClose!)).toMatchObject({ month: 11, day: 10, hour: 9 });

    const after = resolveCadence(STATE, SETTINGS, easternEpoch(2026, 11, 10, 9, 5));
    expect(after.period?.week).toBe(9);
    expect(easternParts(after.period!.periodEnd)).toMatchObject({ month: 11, day: 10, hour: 9 });
  });

  it("honours a different close weekday and hour", () => {
    const out = resolveCadence(STATE, { ...SETTINGS, runWeekday: 3, runHourEt: 6 }, easternEpoch(2026, 9, 16, 7));
    expect(out.period?.week).toBe(1);
    expect(easternParts(out.period!.periodEnd)).toMatchObject({ weekday: 3, hour: 6 });
  });
});

describe("resolveCadence around the season", () => {
  it("gives pre-season periods counted in weeks to kickoff", () => {
    const out = resolveCadence({ ...STATE, season_type: "pre" }, SETTINGS, easternEpoch(2026, 8, 26, 12));
    expect(out.period?.phase).toBe("pre");
    expect(out.period?.preSeasonWeek).toBe(3);
  });

  it("closes off-season periods on the 1st and 16th, or the 1st only when monthly", () => {
    const off = { ...STATE, season_type: "off" };
    const bi = resolveCadence(off, SETTINGS, easternEpoch(2026, 5, 20, 12));
    expect(bi.period).toMatchObject({ phase: "off", cadence: "biweekly" });
    expect(easternParts(bi.period!.periodStart)).toMatchObject({ month: 5, day: 1, hour: 9 });
    expect(easternParts(bi.period!.periodEnd)).toMatchObject({ month: 5, day: 16, hour: 9 });
    const monthly = resolveCadence(off, { ...SETTINGS, offSeasonMonthly: true }, easternEpoch(2026, 5, 20, 12));
    expect(monthly.period).toMatchObject({ cadence: "monthly" });
    expect(easternParts(monthly.period!.periodStart)).toMatchObject({ month: 4, day: 1 });
    expect(easternParts(monthly.period!.periodEnd)).toMatchObject({ month: 5, day: 1 });
  });

  it("hands over from the off-season to the pre-season with no uncovered days", () => {
    const off = { ...STATE, season_type: "off" };
    // Mid-July: the last close was the 16th.
    const july = resolveCadence(off, SETTINGS, easternEpoch(2026, 7, 25, 12));
    expect(easternParts(july.period!.periodEnd)).toMatchObject({ month: 7, day: 16, hour: 9 });
    // Early August, inside the first pre-season week: the August 1 close is
    // reported rather than the stale July one.
    const august = resolveCadence(off, SETTINGS, easternEpoch(2026, 8, 2, 12));
    expect(august.period?.phase).toBe("off");
    expect(easternParts(august.period!.periodStart)).toMatchObject({ month: 7, day: 16 });
    expect(easternParts(august.period!.periodEnd)).toMatchObject({ month: 8, day: 1, hour: 9 });
    // The first pre-season period picks up exactly where that one ended.
    const pre = resolveCadence({ ...STATE, season_type: "pre" }, SETTINGS, easternEpoch(2026, 8, 5, 12));
    expect(pre.period?.phase).toBe("pre");
    expect(pre.period!.periodStart).toBe(august.period!.periodEnd);
    expect(easternParts(pre.period!.periodEnd)).toMatchObject({ month: 8, day: 4, hour: 9 });
  });

  it("declares nothing when Sleeper is unreachable or the desk is off", () => {
    expect(resolveCadence(null, SETTINGS, Date.now()).period).toBeNull();
    expect(resolveCadence(STATE, { ...SETTINGS, enabled: false }, Date.now()).period).toBeNull();
  });
});

describe("overrides", () => {
  it("names a past week's exact window", () => {
    const p = periodForWeek(STATE, SETTINGS, 1)!;
    expect(easternParts(p.periodStart)).toMatchObject({ month: 9, day: 8, hour: 9 });
    expect(easternParts(p.periodEnd)).toMatchObject({ month: 9, day: 15, hour: 9 });
    expect(periodForWeek(STATE, SETTINGS, 40)).toBeNull();
  });

  it("names an off-season close and rejects a date that is not one", () => {
    expect(periodForOffSeasonClose(STATE, SETTINGS, "2026-07-16")).toMatchObject({ phase: "off" });
    expect(periodForOffSeasonClose(STATE, SETTINGS, "2026-07-10")).toBeNull();
  });
});
