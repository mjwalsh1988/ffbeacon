import { describe, expect, it } from "vitest";
import { leaguePositions } from "./positions";

const OFFENSE_SCORING = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6 };
const IDP_SCORING = { ...OFFENSE_SCORING, idp_tkl_solo: 1, idp_sack: 4 };

describe("leaguePositions", () => {
  it("counts dedicated slots only, never a flex", () => {
    const { positions, dedicatedSlots } = leaguePositions(
      ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", "BN", "BN"],
      false,
      OFFENSE_SCORING,
    );
    expect(positions).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(dedicatedSlots).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, K: 1, DEF: 1 });
  });

  it("leaves out a position the league never starts", () => {
    const { positions, dedicatedSlots } = leaguePositions(["QB", "RB", "WR", "TE", "FLEX", "BN"], false, OFFENSE_SCORING);
    expect(positions).not.toContain("K");
    expect(positions).not.toContain("DEF");
    expect(dedicatedSlots.K).toBeUndefined();
  });

  it("adds defenders only with the IDP switch on and a scoring rule for them", () => {
    const roster = ["QB", "RB", "WR", "TE", "DL", "LB", "LB", "DB", "IDP_FLEX", "BN"];
    expect(leaguePositions(roster, false, IDP_SCORING).positions).not.toContain("LB");
    expect(leaguePositions(roster, true, OFFENSE_SCORING).positions).not.toContain("LB");
    const on = leaguePositions(roster, true, IDP_SCORING);
    expect(on.positions).toEqual(["QB", "RB", "WR", "TE", "DL", "LB", "DB"]);
    expect(on.dedicatedSlots).toMatchObject({ DL: 1, LB: 2, DB: 1 });
  });
});
