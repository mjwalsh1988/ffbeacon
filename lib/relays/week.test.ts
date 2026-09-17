import { describe, expect, it } from "vitest";
import { assignRelayWeek, seasonForInstant, seasonWeekOneOpen, seasonWeekOpen } from "./week";
import { easternEpoch, easternParts } from "./eastern-time";

// The 2026 season kicks off Thursday 2026-09-10 (Sleeper season_start_date).
const STATE_2026 = {
  season: "2026",
  season_type: "regular",
  week: 2,
  season_start_date: "2026-09-10",
};

describe("easternEpoch", () => {
  it("lands on the requested Eastern wall-clock time in daylight time", () => {
    const at = easternEpoch(2026, 9, 8, 9, 0);
    const p = easternParts(at);
    expect([p.month, p.day, p.hour, p.minute]).toEqual([9, 8, 9, 0]);
    // 9 AM EDT is 13:00 UTC.
    expect(new Date(at).getUTCHours()).toBe(13);
  });

  it("lands on the requested Eastern wall-clock time in standard time", () => {
    const at = easternEpoch(2026, 12, 1, 9, 0);
    const p = easternParts(at);
    expect([p.month, p.day, p.hour]).toEqual([12, 1, 9]);
    // 9 AM EST is 14:00 UTC.
    expect(new Date(at).getUTCHours()).toBe(14);
  });
});

describe("seasonWeekOneOpen", () => {
  it("opens week 1 on the Tuesday before kickoff at 9 AM Eastern", () => {
    const open = seasonWeekOneOpen("2026-09-10");
    expect(open).not.toBeNull();
    const p = easternParts(open!);
    expect([p.month, p.day, p.hour, p.weekday]).toEqual([9, 8, 9, 2]);
  });

  it("returns null for an unparseable date", () => {
    expect(seasonWeekOneOpen("soon")).toBeNull();
  });
});

describe("assignRelayWeek from the post's own timestamp", () => {
  it("puts a post the Wednesday before kickoff in week 1", () => {
    const posted = easternEpoch(2026, 9, 9, 15, 0);
    expect(assignRelayWeek(STATE_2026, posted)).toEqual({
      season: "2026",
      week: 1,
      phase: "regular",
      preSeasonWeek: null,
    });
  });

  it("closes week 1 at Tuesday 9 AM Eastern and opens week 2", () => {
    const beforeClose = easternEpoch(2026, 9, 15, 8, 59);
    const afterClose = easternEpoch(2026, 9, 15, 9, 0);
    expect(assignRelayWeek(STATE_2026, beforeClose).week).toBe(1);
    expect(assignRelayWeek(STATE_2026, afterClose).week).toBe(2);
  });

  it("holds the boundary at 9 AM Eastern across the November clock change", () => {
    // Week 9 closes on 2026-11-10, the first Tuesday after daylight saving
    // ends. A fixed seven-day millisecond step lands on 8 AM Eastern here.
    const beforeClose = easternEpoch(2026, 11, 10, 8, 59);
    const afterClose = easternEpoch(2026, 11, 10, 9, 0);
    expect(assignRelayWeek(STATE_2026, beforeClose).week).toBe(9);
    expect(assignRelayWeek(STATE_2026, afterClose).week).toBe(10);
    // The hour between the old grid and the wall clock belongs to week 9.
    const insideTheDriftedHour = easternEpoch(2026, 11, 10, 8, 30);
    expect(assignRelayWeek(STATE_2026, insideTheDriftedHour).week).toBe(9);
  });

  it("opens every week at the same Eastern wall-clock time all season", () => {
    for (let n = 1; n <= 22; n += 1) {
      const p = easternParts(seasonWeekOpen("2026-09-10", n)!);
      expect([n, p.hour, p.minute, p.weekday]).toEqual([n, 9, 0, 2]);
    }
  });

  it("gives a Monday night post to the week that is still open", () => {
    const monday = easternEpoch(2026, 9, 21, 23, 30);
    expect(assignRelayWeek(STATE_2026, monday).week).toBe(2);
  });

  it("marks an August post as pre-season with no stored week", () => {
    const august = easternEpoch(2026, 8, 12, 12, 0);
    const out = assignRelayWeek(STATE_2026, august);
    expect(out.phase).toBe("pre");
    expect(out.week).toBeNull();
    expect(out.preSeasonWeek).toBe(4);
    expect(out.season).toBe("2026");
  });

  it("marks a July post as off-season in the same season", () => {
    const july = easternEpoch(2026, 7, 4, 12, 0);
    expect(assignRelayWeek(STATE_2026, july)).toEqual({
      season: "2026",
      week: null,
      phase: "off",
      preSeasonWeek: null,
    });
  });

  it("counts the playoffs as weeks 19 to 22 and then goes off-season", () => {
    const wildCard = easternEpoch(2027, 1, 13, 12, 0);
    expect(assignRelayWeek(STATE_2026, wildCard)).toMatchObject({ week: 19, phase: "post" });
    const march = easternEpoch(2027, 3, 20, 12, 0);
    expect(assignRelayWeek(STATE_2026, march).phase).toBe("off");
  });

  it("rolls the season label over in March when no state season applies", () => {
    expect(seasonForInstant(easternEpoch(2027, 2, 20, 12))).toBe("2026");
    expect(seasonForInstant(easternEpoch(2027, 3, 2, 12))).toBe("2027");
  });
});

describe("assignRelayWeek without a start date", () => {
  it("trusts the live regular-season week", () => {
    const out = assignRelayWeek(
      { season: "2026", season_type: "regular", week: 7 },
      "2026-10-20T12:00:00Z",
    );
    expect(out).toMatchObject({ season: "2026", week: 7, phase: "regular" });
  });

  it("normalises a playoff week counted from 1 to the continuing count", () => {
    const out = assignRelayWeek(
      { season: "2026", season_type: "post", week: 2 },
      "2027-01-20T12:00:00Z",
    );
    expect(out).toMatchObject({ week: 20, phase: "post" });
  });

  it("stores no week off-season and pre-season", () => {
    expect(assignRelayWeek({ season: "2026", season_type: "off" }, "2026-05-01T12:00:00Z").week).toBeNull();
    const pre = assignRelayWeek({ season: "2026", season_type: "pre", week: 2 }, "2026-08-20T12:00:00Z");
    expect(pre.week).toBeNull();
    expect(pre.preSeasonWeek).toBe(2);
  });

  it("derives the season from the date when the state is missing entirely", () => {
    expect(assignRelayWeek(null, "2026-07-01T12:00:00Z").season).toBe("2026");
  });
});
