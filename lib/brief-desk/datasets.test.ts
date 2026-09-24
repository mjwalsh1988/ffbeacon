import { describe, expect, it } from "vitest";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import { figureColumns, formatColumnsFor } from "./dataset-read";
import {
  buildAllDatasets,
  buildBoxScoreLinesDataset,
  buildInjuryTimelineDataset,
  buildTopScorersDataset,
  buildValueMoversByFormatDataset,
  buildValueMoversDataset,
  buildWaiverTargetsDataset,
  buildWeekStatTilesDataset,
  parseReturnTimeline,
  rankTrendRows,
  type DatasetPlayer,
  type DatasetRelay,
  type FormatTrend,
  type WeekLine,
} from "./datasets";

const AT = "2026-09-15T13:05:00.000Z";

const P = (id: string, name: string, position: string, team = "PHI"): DatasetPlayer => ({
  id,
  name,
  slug: name.toLowerCase().replace(/ /g, "-"),
  position,
  team,
});

const players = new Map<string, DatasetPlayer>([
  ["p1", P("p1", "Alpha Back", "RB")],
  ["p2", P("p2", "Bravo Wide", "WR")],
  ["p3", P("p3", "Charlie Pass", "QB")],
  ["p4", P("p4", "Delta End", "TE")],
  ["p5", P("p5", "Echo Kick", "K")],
  ["p6", P("p6", "Foxtrot Deep", "WR")],
]);

function trend(formatSlug: string, rows: Array<[string, number, number | null]>): FormatTrend {
  return {
    formatSlug,
    formatDisplay: formatSlug === "dynasty-ppr-sflex" ? "Dynasty Superflex PPR" : "Redraft PPR (1QB)",
    sourceSlug: "ktc",
    sourceDisplay: "KeepTradeCut",
    rows: rankTrendRows(rows.map(([player_id, current_value, change_7d]) => ({ player_id, current_value, change_7d, change_30d: null }))),
  };
}

const dynasty = trend("dynasty-ppr-sflex", [
  ["p1", 9000, 400],
  ["p2", 8000, -600],
  ["p3", 7000, 50],
  ["p4", 3000, null],
  ["p6", 1000, 900],
]);

const line = (player_id: string, pts: number, extra: Partial<WeekLine> = {}): WeekLine => ({
  player_id,
  opponent: "DAL",
  pts_ppr: pts,
  pts_half_ppr: pts - 1,
  pts_std: pts - 2,
  pass_att: 0,
  pass_cmp: 0,
  pass_yd: 0,
  pass_td: 0,
  pass_int: 0,
  rush_att: 0,
  rush_yd: 0,
  rush_td: 0,
  rec_tgt: null,
  rec: 0,
  rec_yd: 0,
  rec_td: 0,
  fum_lost: 0,
  snap_pct: null,
  ...extra,
});

const relay = (id: string, over: Partial<DatasetRelay>): DatasetRelay => ({
  id,
  slug: `relay-${id}`,
  kind: "injury",
  headline: "Something happened to a player this week",
  availability: null,
  timeline: null,
  source_posted_at: "2026-09-10T12:00:00.000Z",
  players: [],
  teams: [],
  ...over,
});

describe("rankTrendRows", () => {
  it("ranks by current value, highest first", () => {
    expect(dynasty.rows.map((r) => [r.player_id, r.rank_in_format])).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["p3", 3],
      ["p4", 4],
      ["p6", 5],
    ]);
  });
});

describe("value movers", () => {
  it("lists risers by change_7d and skips players with no change or no index entry", () => {
    const d = buildValueMoversDataset("up", dynasty, players, AT);
    expect(d.id).toBe("value_movers_up");
    expect(d.kind).toBe("value_movers_up");
    expect(d.rows.map((r) => r.player_id)).toEqual(["p6", "p1", "p3"]);
    expect(d.rows[0]).toMatchObject({ name: "Foxtrot Deep", current: 1000, change_7d: 900, rank_in_format: 5 });
    // The chart reads `current` and `change_7d` (dataset-read.ts header).
    expect(d.columns).toEqual(["player_id", "name", "slug", "position", "team", "current", "change_7d", "change_30d", "rank_in_format"]);
    expect(d.source_note).toContain("KeepTradeCut");
    expect(d.computed_at).toBe(AT);
  });

  it("lists fallers most negative first", () => {
    const d = buildValueMoversDataset("down", dynasty, players, AT);
    expect(d.rows.map((r) => r.player_id)).toEqual(["p2"]);
  });

  it("honours the limit", () => {
    expect(buildValueMoversDataset("up", dynasty, players, AT, 1).rows).toHaveLength(1);
  });

  it("puts both formats side by side under prefixed columns", () => {
    const redraft = trend("redraft-ppr-std", [
      ["p1", 5000, -100],
      ["p6", 200, 150],
    ]);
    const d = buildValueMoversByFormatDataset([dynasty, redraft], players, AT);
    // "{format_slug}.{figure}", which formatColumnsFor in dataset-read.ts splits on.
    expect(d.columns).toEqual([
      "player_id",
      "name",
      "slug",
      "position",
      "team",
      "dynasty-ppr-sflex.current",
      "dynasty-ppr-sflex.change_7d",
      "dynasty-ppr-sflex.rank_in_format",
      "redraft-ppr-std.current",
      "redraft-ppr-std.change_7d",
      "redraft-ppr-std.rank_in_format",
    ]);
    const p6 = d.rows.find((r) => r.player_id === "p6")!;
    expect(p6).toMatchObject({ "dynasty-ppr-sflex.change_7d": 900, "redraft-ppr-std.change_7d": 150, "redraft-ppr-std.rank_in_format": 2 });
    const p3 = d.rows.find((r) => r.player_id === "p3")!;
    expect(p3["redraft-ppr-std.current"]).toBeNull();
    expect(d.rows[0].player_id).toBe("p6");
    expect(formatColumnsFor(d.columns, "redraft-ppr-std").map((c) => c.figure)).toEqual(["current", "change_7d", "rank_in_format"]);
  });
});

describe("top scorers and box score lines", () => {
  const lines = [line("p1", 20.25), line("p2", 31.4, { rec_tgt: 12, rec: 9 }), line("p3", 18), line("p6", 8.1)];

  it("filters to one position and ranks by PPR points", () => {
    const d = buildTopScorersDataset("WR", lines, players, 2, AT);
    expect(d.id).toBe("top_scorers_wr");
    expect(d.kind).toBe("top_scorers");
    expect(d.rows.map((r) => r.player_id)).toEqual(["p2", "p6"]);
    expect(d.rows[0]).toMatchObject({ rank: 1, pts_ppr: 31.4, rec_tgt: 12, week: 2, opponent: "DAL" });
    expect(d.rows[1].rank).toBe(2);
    expect(d.title).toContain("week 2");
    // The table prints rank and the stat columns; week is context, not a figure.
    expect(d.columns.slice(0, 7)).toEqual(["rank", "player_id", "name", "slug", "position", "team", "week"]);
    expect(figureColumns(d.columns).slice(0, 3)).toEqual(["rank", "opponent", "pts_ppr"]);
    expect(figureColumns(d.columns)).not.toContain("week");
  });

  it("rounds points to one decimal", () => {
    const d = buildTopScorersDataset("RB", lines, players, 2, AT);
    expect(d.rows[0].pts_ppr).toBe(20.3);
  });

  it("box score lines keep only bundle players who have a line", () => {
    const d = buildBoxScoreLinesDataset(["p1", "p4", "p2"], lines, players, 2, AT);
    expect(d.rows.map((r) => r.player_id)).toEqual(["p2", "p1"]);
  });

  it("box score lines give a defender his defensive line and no offensive column (plan IDP-213)", () => {
    const withLb = new Map(players);
    withLb.set("lb", P("lb", "Golf Backer", "LB"));
    const lbLine = line("lb", 0, {
      idp_tkl: 15,
      idp_tkl_solo: 8,
      idp_tkl_ast: 7,
      idp_tkl_loss: 3,
      idp_qb_hit: 2,
      idp_fum_rec: 1,
      idp_def_td: 1,
      def_snap_pct: 0.93,
    });
    const d = buildBoxScoreLinesDataset(["p1", "lb"], [...lines, lbLine], withLb, 2, AT);
    const lbRow = d.rows.find((r) => r.player_id === "lb")!;
    expect(lbRow.pts_idp123).toBe(40);
    expect(lbRow.idp_tkl).toBe(15);
    expect(lbRow).not.toHaveProperty("rec_yd");
    expect(lbRow).not.toHaveProperty("pts_ppr");
    expect(d.columns).toContain("pts_idp123");
    expect(d.source_note).toContain("Sleeper default IDP scoring");
    // The source note no longer claims a missing row means no stat.
    expect(d.source_note).not.toContain("did not record a stat");
  });

  it("an offense-only table carries no IDP column", () => {
    const d = buildBoxScoreLinesDataset(["p1", "p2"], lines, players, 2, AT);
    expect(d.columns.some((c) => c.startsWith("idp_") || c === "pts_idp123")).toBe(false);
  });
});

describe("parseReturnTimeline", () => {
  it("reads a range of weeks from the current week, later bound expected", () => {
    expect(parseReturnTimeline("4 to 6 weeks", 2)).toMatchObject({
      timeline_class: "weeks",
      weeks_min: 4,
      weeks_max: 6,
      earliest_return_week: 6,
      expected_return_week: 8,
      season_ending: false,
      no_timeline: false,
    });
    expect(parseReturnTimeline("four-to-six weeks", 2).expected_return_week).toBe(8);
    expect(parseReturnTimeline("Expected to miss 2 or 3 games", 5)).toMatchObject({ weeks_min: 2, weeks_max: 3, expected_return_week: 8 });
  });

  it("reads a named week", () => {
    expect(parseReturnTimeline("could return in Week 8", 3)).toMatchObject({ timeline_class: "week", expected_return_week: 8, earliest_return_week: 8 });
  });

  it("reads season-ending phrases", () => {
    for (const text of ["season-ending ACL tear", "out for the season", "will miss the rest of the year", "torn Achilles"]) {
      expect(parseReturnTimeline(text, 4)).toMatchObject({ timeline_class: "season_ending", season_ending: true, expected_return_week: null, no_timeline: false });
    }
  });

  it("reads day to day as back next week and week to week as no week", () => {
    expect(parseReturnTimeline("day-to-day", 6)).toMatchObject({ timeline_class: "day_to_day", expected_return_week: 7 });
    expect(parseReturnTimeline("week to week", 6)).toMatchObject({ timeline_class: "week_to_week", expected_return_week: null, no_timeline: false });
  });

  it("counts months as four weeks and rounds days up", () => {
    expect(parseReturnTimeline("about 2 months", 1)).toMatchObject({ weeks_min: 8, weeks_max: 8, expected_return_week: 9 });
    expect(parseReturnTimeline("10 days", 1)).toMatchObject({ weeks_min: 2, expected_return_week: 3 });
  });

  it("flags no timeline and does not invent one from vague words", () => {
    expect(parseReturnTimeline(null, 3)).toMatchObject({ timeline_class: "none", no_timeline: true, expected_return_week: null });
    expect(parseReturnTimeline("  ", 3).no_timeline).toBe(true);
    expect(parseReturnTimeline("multiple weeks", 3)).toMatchObject({ timeline_class: "indefinite", expected_return_week: null, no_timeline: false });
    expect(parseReturnTimeline("a few weeks", 3).expected_return_week).toBeNull();
    expect(parseReturnTimeline("indefinitely", 3).timeline_class).toBe("indefinite");
  });

  it("marks a return past week 18 as season ending, and caps the later bound", () => {
    expect(parseReturnTimeline("6 weeks", 15)).toMatchObject({ season_ending: true, earliest_return_week: null, expected_return_week: null });
    expect(parseReturnTimeline("2 to 5 weeks", 15)).toMatchObject({ season_ending: false, earliest_return_week: 17, expected_return_week: 18 });
  });

  it("carries the week count but no week off-season", () => {
    expect(parseReturnTimeline("6 weeks", null)).toMatchObject({ weeks_min: 6, earliest_return_week: null, expected_return_week: null });
  });
});

describe("injury timeline", () => {
  const relays: DatasetRelay[] = [
    relay("r1", { availability: "out", timeline: "4 to 6 weeks", players: ["p1"], source_posted_at: "2026-09-09T12:00:00.000Z" }),
    relay("r2", { availability: "ir", timeline: null, players: ["p2"] }),
    relay("r3", { availability: "doubtful", timeline: "day to day", players: ["p3"], source_posted_at: "2026-09-10T12:00:00.000Z" }),
    // A later report clears p3.
    relay("r4", { availability: "active", timeline: null, players: ["p3"], source_posted_at: "2026-09-12T12:00:00.000Z" }),
    relay("r5", { kind: "transaction", availability: "signed", players: ["p6"] }),
    relay("r6", { availability: "questionable", players: ["p4"] }),
  ];

  it("keeps out, ir, pup and doubtful by the newest report per player", () => {
    const d = buildInjuryTimelineDataset(relays, players, 2, AT);
    expect(d.kind).toBe("injury_timeline");
    expect(d.rows.map((r) => r.player_id)).toEqual(["p1", "p2"]);
    expect(d.rows[0]).toMatchObject({ availability: "out", expected_return_week: 8, earliest_return_week: 6, no_timeline: "no", relay_slug: "relay-r1" });
    expect(d.rows[1]).toMatchObject({ availability: "ir", expected_return_week: null, no_timeline: "yes", timeline_class: "none" });
  });

  it("does no week arithmetic off-season", () => {
    const d = buildInjuryTimelineDataset(relays, players, null, AT);
    expect(d.rows[0]).toMatchObject({ weeks_max: 6, expected_return_week: null });
    expect(d.source_note).toContain("off-season");
  });
});

describe("waiver targets", () => {
  it("takes risers outside the default starter demand, skips the injured, and prices a bid band", () => {
    const rows: Array<[string, number, number | null]> = [];
    // 120 filler players above the target, so the demand line (108) is real.
    for (let i = 0; i < 120; i += 1) rows.push([`f${i}`, 9000 - i * 10, 0]);
    rows.push(["p6", 500, 300]); // riser, rank 122 (120 fillers plus p1 above him)
    rows.push(["p4", 400, 250]); // riser, but injured
    rows.push(["p1", 8999, 900]); // riser, but inside the starter demand (rank 2)
    const redraft = trend("redraft-ppr-std", rows);
    const d = buildWaiverTargetsDataset({
      redraft,
      dynasty,
      players,
      injuredPlayerIds: new Set(["p4"]),
      faabSettings: DEFAULT_FAAB_SETTINGS,
      computedAt: AT,
    });
    expect(d.kind).toBe("waiver_targets");
    expect(d.rows.map((r) => r.player_id)).toEqual(["p6"]);
    const r = d.rows[0];
    expect(r).toMatchObject({ redraft_change_7d: 300, redraft_rank: 122, dynasty_change_7d: 900, dynasty_rank: 5 });
    expect(typeof r.bid_low).toBe("number");
    expect(typeof r.bid_high).toBe("number");
    expect(Number(r.bid_low)).toBeLessThanOrEqual(Number(r.bid_high));
    expect(d.columns.slice(5, 9)).toEqual(["bid_low", "bid_high", "bid_tier", "bid_aggression"]);
    // No add-rate data is read, so no add_rate column is claimed.
    expect(d.columns).not.toContain("add_rate");
    expect(d.source_note).toContain("not a league-specific figure");
    expect(d.source_note).toContain("KeepTradeCut");
  });
});

describe("week stat tiles", () => {
  const relays: DatasetRelay[] = [
    relay("r1", { kind: "injury", availability: "out", players: ["p1"], teams: ["PHI"] }),
    relay("r2", { kind: "injury", availability: "ir", players: ["p2"], teams: ["PHI"] }),
    relay("r3", { kind: "injury", availability: "questionable", players: ["p3"], teams: ["DAL"] }),
    relay("r4", { kind: "transaction", availability: "signed", players: ["p6"], teams: ["DAL"] }),
    relay("r5", { kind: "contract", availability: "none", players: ["p4"], teams: ["NYG"] }),
    relay("r6", { kind: "depth_chart", availability: null, players: [], teams: ["PHI"] }),
  ];
  const lines = [line("p1", 20), line("p2", 31.4)];

  it("in season: six tiles with the top riser and the top scorer as one string each", () => {
    const d = buildWeekStatTilesDataset({ relays, inSeason: true, dynasty, players, lines, week: 2, computedAt: AT });
    expect(d.kind).toBe("week_stat_tiles");
    expect(d.rows).toHaveLength(6);
    expect(d.rows.map((r) => r.value)).toEqual(["6", "3", "2", "2", "Foxtrot Deep, +900", "Bravo Wide, 31.4"]);
    expect(d.rows[4].label).toContain("Dynasty Superflex PPR");
    expect(d.rows[5].label).toBe("Top PPR scorer, week 2");
  });

  it("off-season: the last two are the top faller and the most-mentioned team", () => {
    const d = buildWeekStatTilesDataset({ relays, inSeason: false, dynasty, players, lines: null, week: null, computedAt: AT });
    expect(d.rows).toHaveLength(6);
    expect(d.rows[4]).toMatchObject({ id: "top_faller", value: "Bravo Wide, -600" });
    expect(d.rows[5]).toMatchObject({ id: "most_mentioned_team", value: "PHI, 3 reports" });
  });

  it("says no data rather than inventing a figure", () => {
    const d = buildWeekStatTilesDataset({ relays: [], inSeason: true, dynasty: null, players, lines: [], week: 1, computedAt: AT });
    expect(d.rows[4].value).toBe("no data");
    expect(d.rows[5].value).toBe("no data");
  });
});

describe("buildAllDatasets", () => {
  it("ships every kind in season, one top_scorers dataset per position", () => {
    const redraft = trend("redraft-ppr-std", [
      ["p1", 5000, -100],
      ["p6", 200, 150],
    ]);
    const out = buildAllDatasets({
      relays: [relay("r1", { availability: "out", timeline: "3 weeks", players: ["p1"] })],
      players,
      bundlePlayerIds: ["p1"],
      trends: [dynasty, redraft],
      dynasty,
      redraft,
      lines: [line("p1", 12), line("p3", 22)],
      week: 2,
      inSeason: true,
      faabSettings: DEFAULT_FAAB_SETTINGS,
      computedAt: AT,
    });
    const ids = Object.keys(out).sort();
    expect(ids).toEqual(
      [
        "box_score_lines",
        "injury_timeline",
        "top_scorers_def",
        "top_scorers_k",
        "top_scorers_qb",
        "top_scorers_rb",
        "top_scorers_te",
        "top_scorers_wr",
        "value_movers_by_format",
        "value_movers_down",
        "value_movers_up",
        "waiver_targets",
        "week_stat_tiles",
      ].sort(),
    );
    for (const d of Object.values(out)) {
      expect(d.computed_at).toBe(AT);
      expect(d.source_note.length).toBeGreaterThan(10);
    }
    // The injured player is not a waiver target even though he is a riser.
    expect(out.waiver_targets.rows.map((r) => r.player_id)).not.toContain("p1");
  });

  it("off-season: no scoreboard datasets", () => {
    const out = buildAllDatasets({
      relays: [],
      players,
      bundlePlayerIds: [],
      trends: [dynasty],
      dynasty,
      redraft: null,
      lines: null,
      week: null,
      inSeason: false,
      faabSettings: DEFAULT_FAAB_SETTINGS,
      computedAt: AT,
    });
    expect(Object.keys(out).sort()).toEqual(["injury_timeline", "value_movers_by_format", "value_movers_down", "value_movers_up", "week_stat_tiles"]);
  });
});
