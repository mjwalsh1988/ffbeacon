import { describe, expect, it } from "vitest";
import { computeMovers, MOVERS_FALLBACK_NOTE, type RosterTrend } from "./movers";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";

const s = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.movers;

const row = (id: string, value: number, pct30: number | null, over: Partial<RosterTrend> = {}): RosterTrend => ({
  playerId: id,
  name: id,
  position: "WR",
  team: "KC",
  sleeperId: null,
  value,
  change7d: 10,
  change7dPct: 1,
  show7d: true,
  rankChange7d: 0,
  change30d: pct30 === null ? null : Math.round((value * pct30) / 100),
  change30dPct: pct30,
  show30d: pct30 !== null,
  rankChange30d: 2,
  ...over,
});

describe("computeMovers", () => {
  const rows = [
    row("a", 6000, 20),
    row("b", 5000, -15),
    row("c", 4000, 8),
    row("d", 3000, -4),
    row("e", 2500, 12),
    row("f", 2000, -30),
    row("g", 1500, 5),
    row("tiny", 200, 80),
  ];

  it("ranks risers and fallers over 30 days with the format top floor", () => {
    const out = computeMovers(rows, 10_000, s);
    expect(out.window).toBe("30d");
    expect(out.risers.map((m) => m.playerId)).toEqual(["a", "e", "c"]);
    expect(out.fallers.map((m) => m.playerId)).toEqual(["f", "b", "d"]);
  });

  it("excludes a player below 5% of the format top, not of the roster top", () => {
    // A 40,000 format top sets the floor at 2,000, which cuts g (1,500) even
    // though a floor from this roster's own top (6,000) would be 300.
    const out = computeMovers(rows, 40_000, s);
    expect(out.risers.map((m) => m.playerId)).not.toContain("g");
    expect(out.risers.map((m) => m.playerId)).not.toContain("tiny");
  });

  it("falls back to 7 days when fewer than 7 players pass the 30-day gate", () => {
    const thin = rows.slice(0, 6).map((r) => ({ ...r, show30d: false }));
    const out = computeMovers(thin, 10_000, s);
    expect(out.window).toBe("7d");
    expect(out.fallbackNote).toBe(MOVERS_FALLBACK_NOTE);
  });
});
