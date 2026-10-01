import { describe, expect, it } from "vitest";
import {
  aggregateBenchWeek,
  buildGamePlayerLinesDataset,
  buildProjectionReportDataset,
  buildWeekAwardsDataset,
  buildWeekGamesDataset,
  coverResult,
  spreadText,
  statLineText,
  totalResult,
  type GamePlayerInput,
} from "./games";
import type { BundleWeekResult } from "./types";

const AT = "2026-10-01T12:00:00.000Z";

// Week 3, 2026 lines and finals as stored (nfl_game_lines and the derived results).
const LINES = [
  { espn_event_id: "401872948", home_team: "GB", away_team: "ATL", kickoff_at: "2026-09-25T00:15:00Z", provider: "DraftKings", open_home_spread: -7.5, close_home_spread: -4.5, open_game_total: 46.5, close_game_total: 43.5, home_moneyline: -238, away_moneyline: 195 },
  { espn_event_id: "401872951", home_team: "DET", away_team: "NYJ", kickoff_at: "2026-09-27T17:00:00Z", provider: "DraftKings", open_home_spread: -9.5, close_home_spread: -7, open_game_total: 44.5, close_game_total: 49.5, home_moneyline: -355, away_moneyline: 280 },
];
const result = (opponent: string, pf: number, pa: number): BundleWeekResult => ({
  opponent,
  points_for: pf,
  points_against: pa,
  outcome: pf > pa ? "W" : pf < pa ? "L" : "T",
  game_date: null,
});
const RESULTS = new Map<string, BundleWeekResult>([
  ["ATL", result("GB", 35, 14)],
  ["GB", result("ATL", 14, 35)],
  ["NYJ", result("DET", 24, 31)],
  ["DET", result("NYJ", 31, 24)],
]);
const TEAMS = new Map([
  ["ATL", { abbreviation: "ATL", name: "Atlanta Falcons", primary_color: "#A71930" }],
  ["GB", { abbreviation: "GB", name: "Green Bay Packers", primary_color: "#203731" }],
]);

describe("line arithmetic", () => {
  it("quotes the favourite, home-relative in and favourite-relative out", () => {
    expect(spreadText("GB", "ATL", -4.5)).toBe("GB -4.5");
    expect(spreadText("CLE", "CAR", 2.5)).toBe("CAR -2.5");
    expect(spreadText("GB", "ATL", 0)).toBe("PK");
    expect(spreadText("GB", "ATL", null)).toBeNull();
  });

  it("says who covered, and calls a game decided by exactly the spread a push", () => {
    expect(coverResult("GB", "ATL", 14, 35, -4.5)).toEqual({ team: "ATL", text: "ATL covered +4.5" });
    expect(coverResult("DET", "NYJ", 31, 24, -7)).toEqual({ team: null, text: "Push against the spread" });
    expect(coverResult("BUF", "LAC", 24, 16, -7)).toEqual({ team: "BUF", text: "BUF covered -7" });
  });

  it("reads the total", () => {
    expect(totalResult(49, 43.5)).toBe("over");
    expect(totalResult(40, 50.5)).toBe("under");
    expect(totalResult(44, 44)).toBe("push");
    expect(totalResult(44, null)).toBeNull();
  });
});

describe("buildWeekGamesDataset", () => {
  it("cards a game with a line and both finals, and marks the underdog winner", () => {
    const d = buildWeekGamesDataset({ season: 2026, week: 3, lines: LINES, results: RESULTS, teams: TEAMS, computedAt: AT });
    expect(d.rows).toHaveLength(2);
    const atl = d.rows.find((r) => r.game_key === "ATL-GB")!;
    expect(atl).toMatchObject({
      away: "ATL",
      home: "GB",
      away_score: 35,
      home_score: 14,
      winner: "ATL",
      spread_text: "GB -4.5",
      open_spread_text: "GB -7.5",
      cover_text: "ATL covered +4.5",
      total_result: "over",
      home_implied: 24,
      away_implied: 19.5,
      upset: "yes",
      away_moneyline_text: "+195",
      recap_url: "https://www.espn.com/nfl/game/_/gameId/401872948",
    });
    expect(d.rows.find((r) => r.game_key === "NYJ-DET")?.upset).toBe("no");
  });

  it("leaves a game out rather than half-drawing it when a final is missing, and says so", () => {
    const partial = new Map(RESULTS);
    partial.delete("GB");
    const d = buildWeekGamesDataset({ season: 2026, week: 3, lines: LINES, results: partial, teams: TEAMS, computedAt: AT });
    expect(d.rows.map((r) => r.game_key)).toEqual(["NYJ-DET"]);
    expect(d.source_note).toContain("1 game is left out");
  });
});

const baseLine = {
  opponent: null, pts_half_ppr: null, pts_std: null, pass_att: 0, pass_cmp: 0, pass_yd: 0, pass_td: 0, pass_int: 0,
  rush_att: 0, rush_yd: 0, rush_td: 0, rec_tgt: 0, rec: 0, rec_yd: 0, rec_td: 0, fum_lost: 0, snap_pct: null,
};
function player(id: string, name: string, position: string, team: string, pts: number, projected: number | null, extra: Partial<GamePlayerInput["line"]> = {}, dynasty: [number, number] | null = null): GamePlayerInput {
  return {
    player_id: id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    position,
    team,
    sleeper_id: "123",
    line: { player_id: id, pts_ppr: pts, ...baseLine, ...extra },
    projected,
    values: dynasty ? { "dynasty-ppr-sflex": { start: dynasty[0], end: dynasty[1] } } : {},
  };
}

describe("statLineText", () => {
  it("reads a back's line rushing first, and keeps lateral yards with no catch", () => {
    expect(statLineText("RB", { player_id: "x", pts_ppr: 1, ...baseLine, rush_att: 29, rush_yd: 194, rush_td: 2, rec: 2, rec_tgt: 2, rec_yd: 19 })).toBe(
      "29 carries, 194 rushing yards, 2 TD; 2 catches on 2 targets, 19 receiving yards",
    );
    expect(statLineText("WR", { player_id: "x", pts_ppr: 1, ...baseLine, rec_yd: 80, rec_td: 1 })).toBe("0 catches, 80 receiving yards, 1 TD");
    expect(statLineText("WR", { player_id: "x", pts_ppr: 0, ...baseLine })).toBe("No touches");
  });
});

describe("buildGamePlayerLinesDataset and the awards", () => {
  const gameByTeam = new Map([["ATL", "ATL-GB"], ["GB", "ATL-GB"]]);
  const players = [
    player("p1", "Bijan Robinson", "RB", "ATL", 35.3, 20.1, { rush_att: 29, rush_yd: 194, rush_td: 2 }, [9000, 9037]),
    player("p2", "Drake London", "WR", "ATL", 28.4, 13.5, { rec: 9, rec_tgt: 10, rec_yd: 194 }, [7000, 7433]),
    player("p3", "Jordan Love", "QB", "GB", 19.5, 16.5, {}, [6000, 5300]),
    player("p4", "Backup Nobody", "WR", "GB", 1.2, 2.0),
    player("p5", "A Linebacker", "LB", "GB", 12, null),
    player("p6", "Wrong Week Team", "WR", "KC", 20, 10),
  ];
  const lines = buildGamePlayerLinesDataset({
    week: 3,
    gameByTeam,
    players,
    formats: [{ slug: "dynasty-ppr-sflex", display: "Dynasty PPR SF", sourceDisplay: "FF Beacon" }],
    projectionDisplay: "Sleeper",
    periodStart: "2026-09-22T13:00:00Z",
    periodEnd: "2026-09-29T13:00:00Z",
    computedAt: AT,
  });

  it("keeps offense from the carded game only, skips the fringe, and measures the value move", () => {
    expect(lines.rows.map((r) => r.name)).toEqual(["Bijan Robinson", "Drake London", "Jordan Love"]);
    expect(lines.rows[0]).toMatchObject({ vs_projection: 15.2, beat_projection: "yes", "dynasty-ppr-sflex.change": 37, "dynasty-ppr-sflex.value": 9037 });
    expect(lines.source_note).toContain("Sleeper projection published for week 3");
  });

  it("builds the awards from the same rows, and hides the bench tiles under the team floor", () => {
    const games = buildWeekGamesDataset({ season: 2026, week: 3, lines: LINES.slice(0, 1), results: RESULTS, teams: TEAMS, computedAt: AT });
    const small = aggregateBenchWeek([{ leagueId: "l1", pointsLeft: 20, outcome: "loss", bestLineupOutcome: "win", biggestMiss: null }]);
    const awards = buildWeekAwardsDataset({ week: 3, games, playerLines: lines, dynastySlug: "dynasty-ppr-sflex", dynastyDisplay: "Dynasty PPR SF", bench: small, projectionDisplay: "Sleeper", computedAt: AT });
    const ids = awards.rows.map((r) => r.id);
    expect(ids).toContain("top_scorer");
    expect(ids).toContain("projection_beat");
    expect(ids).toContain("value_riser");
    expect(ids).toContain("value_faller");
    expect(ids).toContain("upset");
    expect(ids).not.toContain("bench_points");
    expect(awards.rows.find((r) => r.id === "value_faller")?.value).toBe("Jordan Love, -700");
  });
});

describe("aggregateBenchWeek", () => {
  it("averages, counts the losses a better lineup would have won, and keeps the costliest real swap", () => {
    const out = aggregateBenchWeek([
      { leagueId: "a", pointsLeft: 10, outcome: "loss", bestLineupOutcome: "win", biggestMiss: { gain: 5, inName: "X", outName: "Y", inPoints: 9, outPoints: 4 } },
      { leagueId: "a", pointsLeft: 30, outcome: "win", bestLineupOutcome: "win", biggestMiss: { gain: 35.1, inName: "Brock Bowers", outName: "Kyle Pitts", inPoints: 37.6, outPoints: 2.5 } },
      { leagueId: "b", pointsLeft: 20, outcome: "loss", bestLineupOutcome: "loss", biggestMiss: null },
    ]);
    expect(out).toMatchObject({ teams: 3, leagues: 2, avgPointsLeft: 20, flipped: 1 });
    expect(out.costliest?.inName).toBe("Brock Bowers");
  });
});

describe("buildProjectionReportDataset", () => {
  it("grades the week by position and lists the season's reliable and unreliable players", () => {
    const d = buildProjectionReportDataset({
      week: 3,
      weekRows: [
        { position: "TE", projected: 10, actual: 14 },
        { position: "TE", projected: 10, actual: 8 },
        { position: "RB", projected: 15, actual: 5 },
      ],
      season: [
        { player_id: "a", name: "Always Over", slug: "a", position: "WR", team: "SEA", sleeper_id: null, weeks: [{ week: 1, projected: 12, actual: 20 }, { week: 2, projected: 12, actual: 18 }] },
        { player_id: "b", name: "Always Under", slug: "b", position: "RB", team: "MIA", sleeper_id: null, weeks: [{ week: 1, projected: 16, actual: 6 }, { week: 2, projected: 16, actual: 8 }] },
        { player_id: "c", name: "Tiny Projection", slug: "c", position: "WR", team: "CHI", sleeper_id: null, weeks: [{ week: 1, projected: 2, actual: 9 }, { week: 2, projected: 2, actual: 9 }] },
      ],
      projectionDisplay: "Sleeper",
      computedAt: AT,
    });
    expect(d.rows.find((r) => r.position === "TE" && r.row_type === "position")).toMatchObject({ graded: 2, beat: 1, beat_pct: 50, mean_abs_error: 3, mean_error: 1 });
    expect(d.rows.find((r) => r.position === "ALL")).toMatchObject({ graded: 3, beat: 1 });
    expect(d.rows.filter((r) => r.row_type === "leader").map((r) => r.name)).toEqual(["Always Over"]);
    expect(d.rows.filter((r) => r.row_type === "laggard").map((r) => r.name)).toEqual(["Always Under"]);
  });
});
