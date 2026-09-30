import { describe, expect, it } from "vitest";
import { projectionSyncWindow } from "./game-day-sync";

const at = (iso: string) => Date.parse(iso);
const REGULAR_WEEK_4 = { season_type: "regular", week: 4 };

describe("projectionSyncWindow", () => {
  it("refreshes the whole slate on the daily 12:00 UTC run", () => {
    expect(projectionSyncWindow(at("2026-10-04T12:00:30Z"), REGULAR_WEEK_4)).toEqual({ scope: "full" });
  });

  it("refreshes only the live week and the next on a game-day run", () => {
    expect(projectionSyncWindow(at("2026-10-04T16:45:10Z"), REGULAR_WEEK_4)).toEqual({
      scope: "near",
      fromWeek: 4,
      toWeek: 5,
    });
  });

  it("never reaches past week 18", () => {
    expect(projectionSyncWindow(at("2027-01-03T16:45:00Z"), { season_type: "regular", week: 18 })).toEqual({
      scope: "near",
      fromWeek: 18,
      toWeek: 18,
    });
  });

  it("falls back to the full slate when the live week is unknown or not regular season", () => {
    expect(projectionSyncWindow(at("2026-10-04T16:45:00Z"), null)).toEqual({ scope: "full" });
    expect(projectionSyncWindow(at("2026-08-20T16:45:00Z"), { season_type: "pre", week: 3 })).toEqual({
      scope: "full",
    });
    expect(projectionSyncWindow(at("2026-10-04T16:45:00Z"), { season_type: "regular", week: 0 })).toEqual({
      scope: "full",
    });
  });
});
