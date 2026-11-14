import { describe, expect, it } from "vitest";
import { frozenSeasonNote, isFrozenSeason, leagueKindOf } from "./league-kind";

describe("leagueKindOf", () => {
  it("reads Sleeper's settings.type, keeper kept apart from redraft", () => {
    expect(leagueKindOf({ settings: { type: 0 } }).kind).toBe("redraft");
    expect(leagueKindOf({ settings: { type: 1 } }).kind).toBe("keeper");
    expect(leagueKindOf({ settings: { type: 2 } }).kind).toBe("dynasty");
    expect(leagueKindOf({ settings: { type: 3 } }).kind).toBe("chopped");
    expect(leagueKindOf(null).kind).toBe("redraft");
  });

  it("reads best ball", () => {
    expect(leagueKindOf({ settings: { type: 2, best_ball: 1 } }).isBestBall).toBe(true);
    expect(leagueKindOf({ settings: { type: 2 } }).isBestBall).toBe(false);
  });
});

describe("frozen seasons", () => {
  it("freezes a season before the current one only", () => {
    expect(isFrozenSeason("2025", "2026")).toBe(true);
    expect(isFrozenSeason("2026", "2026")).toBe(false);
    expect(frozenSeasonNote("2025", "2026")).toBe("Final roster from the 2025 season.");
    expect(frozenSeasonNote("2026", "2026")).toBeNull();
  });
});
