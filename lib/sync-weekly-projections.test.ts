import { describe, it, expect } from "vitest";
import { classifyRow } from "./sync-weekly-projections";
import type { SleeperWeeklyProjection } from "./sleeper";

/**
 * Every fixture below is a real shape taken from
 * https://api.sleeper.com/projections/nfl/2026/{week} on 2026-08-25. The four
 * cases arrive looking almost identical, which is the entire reason this
 * function exists and the reason it is tested rather than trusted.
 */
function row(partial: Partial<SleeperWeeklyProjection>): SleeperWeeklyProjection {
  return {
    player_id: "0",
    season: "2026",
    season_type: "regular",
    week: 10,
    stats: {},
    ...partial,
  } as SleeperWeeklyProjection;
}

describe("classifyRow", () => {
  it("stores a published projection as Sleeper's own opinion", () => {
    // Tank Dell, week 10: Questionable and still projected. The designation is
    // already priced into 6.28; it is not a reason to withhold the number.
    const dell = row({
      player_id: "9502",
      stats: { pts_ppr: 6.28, pts_half_ppr: 5.1, pts_std: 3.9 },
      game_id: "202611008",
      player: { first_name: "Tank", last_name: "Dell", injury_status: "Questionable" },
    });
    expect(classifyRow(dell)).toBe("projected");
  });

  it("counts a projection published in only one scoring base", () => {
    expect(classifyRow(row({ stats: { pts_std: 4.2 }, game_id: "202611008" }))).toBe("projected");
  });

  it("calls a designated player with a scheduled game out", () => {
    // Ricky Pearsall, every week of 2026. A game exists, no points are
    // published, and he is on season-ending IR. This is the case that read 8.9
    // points a week for 24 days.
    const pearsall = row({
      player_id: "11638",
      stats: { adp_dd_ppr: 1000 },
      game_id: "202611009",
      player: {
        first_name: "Ricky",
        last_name: "Pearsall",
        injury_status: "IR",
        injury_body_part: "Knee - PCL",
      },
    });
    expect(classifyRow(pearsall)).toBe("out");
  });

  it("does NOT call a healthy backup quarterback out", () => {
    // Justin Fields, week 10. Byte-identical to Pearsall's row apart from the
    // missing designation: same empty stats, same scheduled game. He is healthy,
    // rostered in real leagues, and averaged 20.4 PPR across his projected weeks
    // in 2025. Sleeper does not project backups; that is silence, not zero.
    const fields = row({
      player_id: "3294",
      stats: { adp_dd_ppr: 1000 },
      game_id: "202611002",
      player: { first_name: "Justin", last_name: "Fields", injury_status: null },
    });
    expect(classifyRow(fields)).toBe("unprojected");
  });

  it("treats a blank designation as no designation", () => {
    const blank = row({
      stats: {},
      game_id: "202611002",
      player: { first_name: "Some", last_name: "Backup", injury_status: "   " },
    });
    expect(classifyRow(blank)).toBe("unprojected");
  });

  it("calls a player with no scheduled game a bye", () => {
    // Jalen Hurts, week 10. Healthy, no designation, and no game_id at all,
    // along with 68 other players whose teams are on bye that week. Writing a
    // zero here would zero out half the league every few weeks.
    const hurts = row({
      player_id: "6904",
      stats: { adp_dd_ppr: 1000 },
      game_id: null,
      player: { first_name: "Jalen", last_name: "Hurts", injury_status: null },
    });
    expect(classifyRow(hurts)).toBe("bye");
  });

  it("calls a designated player with no game a bye, not out", () => {
    // A bye outranks a designation. There is no game to miss.
    const injuredOnBye = row({
      stats: {},
      game_id: null,
      player: { first_name: "Hurt", last_name: "OnBye", injury_status: "IR" },
    });
    expect(classifyRow(injuredOnBye)).toBe("bye");
  });

  it("treats an empty-string game id as no game", () => {
    expect(classifyRow(row({ stats: {}, game_id: "   " }))).toBe("bye");
  });

  it("survives a row with no player object and no stats at all", () => {
    expect(classifyRow(row({ stats: null, game_id: null, player: null }))).toBe("bye");
    expect(classifyRow(row({ stats: null, game_id: "202611009", player: null }))).toBe(
      "unprojected",
    );
  });
});

describe("the short-term injury shape the whole change exists to reproduce", () => {
  // Sleeper publishes per-week availability, so a four-week injury really does
  // read as four missing weeks followed by normal ones. Verified live on
  // 2026-08-25 for Jordyn Tyson: no points weeks 1 and 4, 10.83 by week 10.
  const tyson = (week: number, pts: number | null) =>
    row({
      player_id: "13281",
      week,
      stats: pts === null ? { adp_dd_ppr: 1000 } : { pts_ppr: pts },
      game_id: `20261${String(week).padStart(2, "0")}22`,
      player: { first_name: "Jordyn", last_name: "Tyson", injury_status: "Doubtful" },
    });

  it("reads as out early and projected once he returns", () => {
    expect(classifyRow(tyson(1, null))).toBe("out");
    expect(classifyRow(tyson(4, null))).toBe("out");
    expect(classifyRow(tyson(10, 10.83))).toBe("projected");
  });
});
