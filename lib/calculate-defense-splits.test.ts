import { describe, expect, it } from "vitest";
import {
  computeSeasonSplits,
  groupPerformances,
  idp123FromColumns,
  pointsFor,
} from "./calculate-defense-splits";

type Row = Parameters<typeof groupPerformances>[0][number];

function row(partial: Partial<Row>): Row {
  return {
    player_id: "p",
    season: 2025,
    week: 4,
    opponent: "DAL",
    offense_team: "PHI",
    gp: 1,
    pts_ppr: null,
    pts_half_ppr: null,
    pts_std: null,
    idp123: null,
    position: "WR",
    ...partial,
  };
}

describe("pointsFor across the IDP line (IDP-118)", () => {
  it("scores a defender on idp123 only", () => {
    const dl = row({ position: "DL", idp123: 9, pts_ppr: 0.4 });
    expect(pointsFor(dl, "idp123")).toBe(9);
    expect(pointsFor(dl, "pts_ppr")).toBeNull();
    expect(pointsFor(dl, "pts_std")).toBeNull();
  });

  it("never scores an offensive player on idp123", () => {
    const wr = row({ pts_ppr: 14.2, idp123: 2 });
    expect(pointsFor(wr, "pts_ppr")).toBe(14.2);
    expect(pointsFor(wr, "idp123")).toBeNull();
  });
});

describe("groupPerformances", () => {
  it("puts a DL row in the bucket keyed by the offense he faced", () => {
    const groups = groupPerformances(
      [row({ position: "DL", opponent: "NYG", offense_team: "CLE", week: 3, idp123: 11 })],
      "idp123",
    );
    expect([...groups.keys()]).toEqual(["NYG|3|DL"]);
    expect(groups.get("NYG|3|DL")?.points).toEqual([11]);
  });

  it("leaves defenders out of every PPR bucket", () => {
    const groups = groupPerformances([row({ position: "LB", idp123: 8, pts_ppr: 1 })], "pts_ppr");
    expect(groups.size).toBe(0);
  });
});

describe("idp123FromColumns", () => {
  it("scores Roquan Smith's typed week at 40 and a row with no IDP columns as null", () => {
    expect(
      idp123FromColumns({ idp_tkl_solo: 8, idp_tkl_ast: 7, idp_tkl_loss: 3, idp_qb_hit: 2, idp_fum_rec: 1, idp_def_td: 1 }),
    ).toBe(40);
    expect(idp123FromColumns({ pts_ppr: 12 })).toBeNull();
  });
});

describe("computeSeasonSplits (IDP-403 calibration reads this)", () => {
  // Each week, one linebacker room faces NYG and another faces DAL. NYG gives
  // up 30 a game to the top three linebackers, DAL 10, so the average is 20.
  function lbWeek(defense: string, offense: string, week: number, top: number[]): Row[] {
    return top.map((points, i) =>
      row({ player_id: `${offense}-${i}`, position: "LB", opponent: defense, offense_team: offense, week, idp123: points }),
    );
  }
  const rows: Row[] = [];
  for (let week = 1; week <= 4; week += 1) {
    // A fourth linebacker past the cap of three must not count.
    rows.push(...lbWeek("NYG", week % 2 ? "CLE" : "PIT", week, [12, 10, 8, 7]));
    rows.push(...lbWeek("DAL", week % 2 ? "PIT" : "CLE", week, [4, 3, 3]));
  }
  // A defense seen in only three games is below MIN_GAMES and is not published.
  for (let week = 1; week <= 3; week += 1) rows.push(...lbWeek("MIA", "BUF", week, [9, 9, 9]));

  it("sums the startable cap per game and clamps the raw multiplier", () => {
    const splits = computeSeasonSplits(rows, "idp123");
    const byTeam = new Map(splits.map((s) => [s.team, s]));
    expect(byTeam.has("MIA")).toBe(false);
    expect(byTeam.get("NYG")?.perGame).toBe(30);
    expect(byTeam.get("DAL")?.perGame).toBe(10);
    expect(byTeam.get("NYG")?.average).toBe(20);
    expect(byTeam.get("NYG")?.multiplier).toBe(1.25);
    expect(byTeam.get("DAL")?.multiplier).toBe(0.8);
    expect(byTeam.get("NYG")?.games).toBe(4);
  });

  it("publishes nothing for a defender under a PPR base", () => {
    expect(computeSeasonSplits(rows, "pts_ppr")).toEqual([]);
  });
});
