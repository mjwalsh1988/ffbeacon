import { describe, expect, it } from "vitest";
import { deriveWeekResults, type DefenseLine } from "./week-results";

// Real week 2, 2026 defense lines (trimmed to the keys the formula reads),
// checked against ESPN's finals.
const line = (team: string, opponent: string, stats: Record<string, number>): DefenseLine => ({
  team,
  opponent,
  game_date: "2026-09-20",
  stats,
});

describe("deriveWeekResults", () => {
  it("scores a plain game straight from each side's points allowed", () => {
    const r = deriveWeekResults([line("DAL", "WAS", { pts_allow: 20 }), line("WAS", "DAL", { pts_allow: 37 })]);
    expect(r.get("DAL")).toMatchObject({ opponent: "WAS", points_for: 37, points_against: 20, outcome: "W" });
    expect(r.get("WAS")).toMatchObject({ points_for: 20, points_against: 37, outcome: "L" });
  });

  it("adds a defensive touchdown the other side's points allowed leaves out (Panthers 34, Falcons 3)", () => {
    const r = deriveWeekResults([line("CAR", "ATL", { pts_allow: 3, def_td: 1 }), line("ATL", "CAR", { pts_allow: 28 })]);
    expect(r.get("CAR")).toMatchObject({ points_for: 34, points_against: 3, outcome: "W" });
    expect(r.get("ATL")).toMatchObject({ points_for: 3, points_against: 34 });
  });

  it("adds a safety (Raiders 26, Chargers 14)", () => {
    const r = deriveWeekResults([line("LV", "LAC", { pts_allow: 14, safe: 1 }), line("LAC", "LV", { pts_allow: 24 })]);
    expect(r.get("LV")?.points_for).toBe(26);
  });

  it("does NOT add a special-teams touchdown, which the other side's points allowed already counts (Vikings 23, Buccaneers 16, week 3)", () => {
    // Myles Price's 86-yard punt return is inside Tampa Bay's pts_allow of 23.
    // Adding def_st_td on top reported 29 to 16.
    const r = deriveWeekResults([line("MIN", "TB", { pts_allow: 16, def_st_td: 1 }), line("TB", "MIN", { pts_allow: 23 })]);
    expect(r.get("MIN")).toMatchObject({ points_for: 23, points_against: 16, outcome: "W" });
    expect(r.get("TB")).toMatchObject({ points_for: 16, points_against: 23 });
  });

  it("leaves out a game with one line or no points allowed rather than guessing", () => {
    const r = deriveWeekResults([
      line("KC", "IND", { pts_allow: 30 }),
      line("NYG", "LAR", {}),
      line("LAR", "NYG", { pts_allow: 6 }),
    ]);
    expect(r.size).toBe(0);
  });

  it("calls an equal score a tie", () => {
    const r = deriveWeekResults([line("GB", "NYJ", { pts_allow: 17 }), line("NYJ", "GB", { pts_allow: 17 })]);
    expect(r.get("GB")?.outcome).toBe("T");
  });
});
