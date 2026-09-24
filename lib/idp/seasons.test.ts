import { describe, expect, it } from "vitest";
import { aggregateIdpSeasons, type IdpWeekRow } from "./seasons";

function week(partial: Partial<IdpWeekRow>): IdpWeekRow {
  return {
    playerId: "p1",
    season: 2025,
    seasonType: "regular",
    position: "LB",
    eligiblePositions: ["LB"],
    defSnapPct: null,
    ...partial,
  };
}

describe("aggregateIdpSeasons (IDP-117)", () => {
  it("sums a season from three weeks and counts real-role games", () => {
    const out = aggregateIdpSeasons([
      week({ def_snp: 60, defSnapPct: 0.9, idp_tkl: 10, idp_tkl_solo: 6, idp_sack: 1 }),
      week({ def_snp: 15, defSnapPct: 0.2, idp_tkl: 2, idp_tkl_solo: 2 }),
      week({ def_snp: 55, defSnapPct: 0.85, idp_tkl: 8, idp_tkl_solo: 5, idp_int: 1 }),
    ]);
    expect(out).toHaveLength(1);
    const row = out[0];
    expect(row.games).toBe(3);
    expect(row.games_20_snaps).toBe(2);
    expect(row.idp_tkl).toBe(20);
    expect(row.idp_tkl_solo).toBe(13);
    expect(row.idp_sack).toBe(1);
    expect(row.idp_int).toBe(1);
    expect(row.idp_ff).toBeNull();
    expect(row.def_snp).toBe(130);
    expect(row.avg_def_snap_pct).toBeCloseTo(0.65, 4);
  });

  it("ignores weeks with no snap recorded and anyone who is not a defender", () => {
    const out = aggregateIdpSeasons([
      week({ def_snp: null, idp_tkl: 1 }),
      week({ playerId: "wr", position: "WR", def_snp: 3, idp_tkl: 1 }),
    ]);
    expect(out).toEqual([]);
  });

  it("keeps season types and players apart, and defaults eligibility to the primary", () => {
    const out = aggregateIdpSeasons([
      week({ def_snp: 40, eligiblePositions: [] }),
      week({ def_snp: 40, seasonType: "post" }),
      week({ playerId: "p2", position: "DL", eligiblePositions: ["DL", "LB"], def_snp: 30 }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.player_id === "p1" && r.season_type === "regular")?.eligible_positions).toEqual(["LB"]);
    expect(out.find((r) => r.player_id === "p2")?.eligible_positions).toEqual(["DL", "LB"]);
  });
});
