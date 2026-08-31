import { describe, it, expect } from "vitest";
import {
  FRESHNESS_SPECS,
  gradeFreshness,
  isBeforeKickoff,
  isInSeason,
  staleOnly,
  type FreshnessSpec,
} from "./data-freshness";

const HOUR = 60 * 60 * 1000;
/** A fixed instant in August, so the seasonal specs are in season. */
const AUGUST = Date.parse("2026-08-25T12:00:00Z");
/** A fixed instant in May, when the stats sync is idle by design. */
const MAY = Date.parse("2026-05-25T12:00:00Z");

const SPEC: FreshnessSpec = {
  table: "players",
  column: "updated_at",
  label: "Player dimension",
  maxAgeHours: 48,
  matters: "Injury designations live here.",
};

const SEASONAL: FreshnessSpec = {
  ...SPEC,
  table: "player_stats",
  label: "Player stats",
  months: [1, 2, 8, 9, 10, 11, 12],
  kickoffGated: true,
};

/** The state Sleeper actually returned in the gap that produced the false alarm. */
const REGULAR_BEFORE_KICKOFF = { season_type: "regular", season_start_date: "2026-09-09" };
const PRESEASON = { season_type: "pre", season_start_date: "2026-09-09" };

function hoursAgo(nowMs: number, hours: number): string {
  return new Date(nowMs - hours * HOUR).toISOString();
}

describe("gradeFreshness", () => {
  it("calls a table written this morning fresh", () => {
    const r = gradeFreshness(SPEC, hoursAgo(AUGUST, 6), AUGUST);
    expect(r.level).toBe("fresh");
    expect(r.ageHours).toBeCloseTo(6, 5);
  });

  it("forgives a single missed nightly window", () => {
    // 30 hours is one skipped run, not a broken pipeline. Alerting here would
    // fire on ordinary scheduler jitter and train everyone to ignore the panel.
    expect(gradeFreshness(SPEC, hoursAgo(AUGUST, 30), AUGUST).level).toBe("fresh");
    expect(gradeFreshness(SPEC, hoursAgo(AUGUST, 47.9), AUGUST).level).toBe("fresh");
  });

  it("calls two missed windows stale", () => {
    expect(gradeFreshness(SPEC, hoursAgo(AUGUST, 49), AUGUST).level).toBe("stale");
  });

  it("catches the three-month silence that started all this", () => {
    // players.updated_at sat at 2026-05-18 while the site kept serving from it.
    const r = gradeFreshness(SPEC, "2026-05-18T01:03:15.879Z", AUGUST);
    expect(r.level).toBe("stale");
    expect(r.ageHours).toBeGreaterThan(2000);
  });

  it("treats an empty table as unknown, never as stale", () => {
    // No rows is an absence of evidence. A red mark here would be a guess.
    const r = gradeFreshness(SPEC, null, AUGUST);
    expect(r.level).toBe("unknown");
    expect(r.ageHours).toBeNull();
  });

  it("treats an unparseable timestamp as unknown", () => {
    expect(gradeFreshness(SPEC, "not a date", AUGUST).level).toBe("unknown");
  });

  it("never reports a negative age when a row is stamped slightly ahead", () => {
    const r = gradeFreshness(SPEC, new Date(AUGUST + 5 * 60 * 1000).toISOString(), AUGUST);
    expect(r.ageHours).toBe(0);
    expect(r.level).toBe("fresh");
  });
});

describe("seasonal specs", () => {
  it("judges a seasonal table during its season", () => {
    expect(isInSeason(SEASONAL, AUGUST)).toBe(true);
    expect(gradeFreshness(SEASONAL, hoursAgo(AUGUST, 200), AUGUST).level).toBe("stale");
  });

  it("does not call a table stale for sitting still out of season", () => {
    expect(isInSeason(SEASONAL, MAY)).toBe(false);
    const r = gradeFreshness(SEASONAL, hoursAgo(MAY, 2000), MAY);
    expect(r.level).toBe("fresh");
    expect(r.outOfSeason).toBe(true);
  });
});

describe("staleOnly", () => {
  it("returns the stale tables worst-first and drops the rest", () => {
    const results = [
      gradeFreshness(SPEC, hoursAgo(AUGUST, 60), AUGUST),
      gradeFreshness({ ...SPEC, label: "Fine" }, hoursAgo(AUGUST, 2), AUGUST),
      gradeFreshness({ ...SPEC, label: "Worst" }, hoursAgo(AUGUST, 900), AUGUST),
      gradeFreshness({ ...SPEC, label: "Empty" }, null, AUGUST),
    ];
    const stale = staleOnly(results);
    expect(stale.map((r) => r.label)).toEqual(["Worst", "Player dimension"]);
  });
});

describe("FRESHNESS_SPECS registry", () => {
  it("watches the player dimension, which is what went stale unnoticed", () => {
    expect(FRESHNESS_SPECS.some((s) => s.table === "players")).toBe(true);
  });

  it("watches every table exactly once", () => {
    const tables = FRESHNESS_SPECS.map((s) => s.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("gives every spec a reason a reader can act on", () => {
    for (const spec of FRESHNESS_SPECS) {
      expect(spec.matters.length, `${spec.table} has no "matters" text`).toBeGreaterThan(20);
      expect(spec.maxAgeHours).toBeGreaterThan(0);
    }
  });
});

describe("isBeforeKickoff", () => {
  it("is true once Sleeper says regular and the opener has not been played", () => {
    // 2026-08-31, the day the false alarm went out. Sleeper had already moved to
    // regular season week 1, nine days early, and no stat line existed.
    expect(isBeforeKickoff(REGULAR_BEFORE_KICKOFF, Date.parse("2026-08-31T16:00:00Z"))).toBe(true);
  });

  it("is false from the opener onward", () => {
    expect(isBeforeKickoff(REGULAR_BEFORE_KICKOFF, Date.parse("2026-09-09T00:00:00Z"))).toBe(false);
    expect(isBeforeKickoff(REGULAR_BEFORE_KICKOFF, Date.parse("2026-10-01T00:00:00Z"))).toBe(false);
  });

  it("does not cover the preseason, which does produce stat lines", () => {
    expect(isBeforeKickoff(PRESEASON, Date.parse("2026-08-20T16:00:00Z"))).toBe(false);
  });

  it("is false when the state is missing or unparseable, so a Sleeper outage never mutes an alert", () => {
    expect(isBeforeKickoff(null, AUGUST)).toBe(false);
    expect(isBeforeKickoff({ season_type: "regular" }, AUGUST)).toBe(false);
    expect(isBeforeKickoff({ season_type: "regular", season_start_date: "soon" }, AUGUST)).toBe(
      false,
    );
  });
});

describe("the kickoff gate on player stats", () => {
  const BEFORE_OPENER = Date.parse("2026-08-31T16:00:00Z");

  it("does not call the stats table stale in the gap before week 1", () => {
    // 55 hours since the last write, which is over the 48-hour limit, and the
    // email that went out on this data was wrong.
    const r = gradeFreshness(SEASONAL, hoursAgo(BEFORE_OPENER, 55), BEFORE_OPENER, {
      ...REGULAR_BEFORE_KICKOFF,
    });
    expect(r.level).toBe("fresh");
    expect(r.idleReason).toContain("kicked off");
  });

  it("still reports a genuinely stale stats table during the preseason", () => {
    const r = gradeFreshness(SEASONAL, hoursAgo(BEFORE_OPENER, 55), BEFORE_OPENER, { ...PRESEASON });
    expect(r.level).toBe("stale");
    expect(r.idleReason).toBeNull();
  });

  it("resumes judging the moment the opener arrives", () => {
    const inSeason = Date.parse("2026-09-20T16:00:00Z");
    const r = gradeFreshness(SEASONAL, hoursAgo(inSeason, 55), inSeason, {
      ...REGULAR_BEFORE_KICKOFF,
    });
    expect(r.level).toBe("stale");
  });

  it("leaves ungated tables alone in the same window", () => {
    const r = gradeFreshness(SPEC, hoursAgo(BEFORE_OPENER, 55), BEFORE_OPENER, {
      ...REGULAR_BEFORE_KICKOFF,
    });
    expect(r.level).toBe("stale");
  });

  it("names the out-of-season reason ahead of the kickoff one", () => {
    const r = gradeFreshness(SEASONAL, hoursAgo(MAY, 2000), MAY, { ...REGULAR_BEFORE_KICKOFF });
    expect(r.outOfSeason).toBe(true);
    expect(r.idleReason).toContain("Out of season");
  });
});
