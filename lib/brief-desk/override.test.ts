import { describe, expect, it } from "vitest";
import { easternDateOf, overrideForEdition, parseOverride } from "./override";

const q = (s: string) => new URLSearchParams(s);

describe("parseOverride", () => {
  it("is null with no query", () => {
    expect(parseOverride(q(""))).toEqual({ ok: true, override: null });
  });

  it("reads a season and week", () => {
    expect(parseOverride(q("season=2026&week=1"))).toEqual({ ok: true, override: { season: "2026", week: 1 } });
    expect(parseOverride(q("season=2026&week=22"))).toEqual({ ok: true, override: { season: "2026", week: 22 } });
  });

  it("reads a season and an off-season close date", () => {
    expect(parseOverride(q("season=2026&period_end=2026-07-16"))).toEqual({ ok: true, override: { season: "2026", periodEnd: "2026-07-16" } });
  });

  it("refuses anything malformed rather than guessing", () => {
    expect(parseOverride(q("week=1")).ok).toBe(false);
    expect(parseOverride(q("season=26&week=1")).ok).toBe(false);
    expect(parseOverride(q("season=2026")).ok).toBe(false);
    expect(parseOverride(q("season=2026&week=0")).ok).toBe(false);
    expect(parseOverride(q("season=2026&week=23")).ok).toBe(false);
    expect(parseOverride(q("season=2026&week=abc")).ok).toBe(false);
    expect(parseOverride(q("season=2026&period_end=July")).ok).toBe(false);
    expect(parseOverride(q("season=2026&week=1&period_end=2026-07-16")).ok).toBe(false);
  });
});

describe("easternDateOf and overrideForEdition", () => {
  it("reads the Eastern calendar date off an instant", () => {
    // 2026-07-16 13:00 UTC is 9 AM Eastern on the 16th.
    expect(easternDateOf("2026-07-16T13:00:00.000Z")).toBe("2026-07-16");
    // 2026-07-17 02:00 UTC is still the evening of the 16th in the East.
    expect(easternDateOf("2026-07-17T02:00:00.000Z")).toBe("2026-07-16");
  });

  it("names a week in season and a close date off-season", () => {
    expect(overrideForEdition({ season: "2026", week: 2, period_end: "2026-09-22T13:00:00.000Z" })).toEqual({ season: "2026", week: 2 });
    expect(overrideForEdition({ season: "2026", week: null, period_end: "2026-07-16T13:00:00.000Z" })).toEqual({ season: "2026", periodEnd: "2026-07-16" });
  });
});
