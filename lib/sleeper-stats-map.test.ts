import { describe, expect, it } from "vitest";
import { NULLABLE_IDP_COLUMNS, mapStatPayloadToRow } from "./sleeper-stats-map";

/** A defender's real-shaped weekly line: IDP keys plus Sleeper's offensive pts. */
const DEFENDER = {
  opponent: "PHI",
  game_id: "202509140",
  stats: {
    def_snp: 58,
    tm_def_snp: 64,
    idp_tkl: 15,
    idp_tkl_solo: 11,
    idp_tkl_ast: 4,
    idp_tkl_loss: 1,
    idp_sack: 0.5,
    idp_sack_yd: 3,
    idp_qb_hit: 1,
    idp_pass_def: 1,
    bonus_tkl_10p: 1,
    gp: 1,
    pts_ppr: 0,
  },
};

describe("mapStatPayloadToRow for a defender (IDP-109)", () => {
  it("maps every IDP key it was given and leaves the rest null", () => {
    const row = mapStatPayloadToRow(DEFENDER);
    expect(row.def_snp).toBe(58);
    expect(row.idp_tkl).toBe(15);
    expect(row.idp_tkl_solo).toBe(11);
    expect(row.idp_tkl_ast).toBe(4);
    expect(row.idp_sack).toBe(0.5);
    expect(row.bonus_tkl_10p).toBe(1);
    expect(row.idp_int).toBeNull();
    expect(row.idp_def_td).toBeNull();
  });

  it("derives def_snap_pct from snaps over team snaps", () => {
    expect(mapStatPayloadToRow(DEFENDER).def_snap_pct).toBeCloseTo(58 / 64, 10);
  });

  it("leaves the offensive columns exactly as the offensive rules set them", () => {
    const row = mapStatPayloadToRow(DEFENDER);
    expect(row.rec).toBe(0);
    expect(row.rush_att).toBe(0);
    expect(row.pts_ppr).toBe(0);
    expect(row.rec_tgt).toBeNull();
    expect(row.snap_pct).toBeNull();
  });

  it("leaves every IDP column null for an offensive player", () => {
    const row = mapStatPayloadToRow({ stats: { rec: 6, rec_yd: 71, off_snp: 50, tm_off_snp: 60, pts_ppr: 13.1 } });
    for (const col of NULLABLE_IDP_COLUMNS) expect(row[col]).toBeNull();
    expect(row.def_snap_pct).toBeNull();
    expect(row.rec).toBe(6);
  });

  it("gives a null def_snap_pct without team snaps, and never divides by zero", () => {
    expect(mapStatPayloadToRow({ stats: { def_snp: 40 } }).def_snap_pct).toBeNull();
    expect(mapStatPayloadToRow({ stats: { def_snp: 0, tm_def_snp: 0 } }).def_snap_pct).toBeNull();
  });
});
