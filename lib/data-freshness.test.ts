import { describe, it, expect } from "vitest";
import {
  FRESHNESS_SPECS,
  gradeFreshness,
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
};

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
