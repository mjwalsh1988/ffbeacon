import { describe, expect, it } from "vitest";
import { groupPerformances, idp123FromColumns, pointsFor } from "./calculate-defense-splits";

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
