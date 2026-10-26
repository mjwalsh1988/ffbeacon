import { describe, expect, it } from "vitest";
import { scoreActualLine } from "./league-scoring";

const LEAGUE = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 };
const IDP_LEAGUE = { ...LEAGUE, idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_sack: 4 };

describe("scoreActualLine", () => {
  it("is the same dot product Sleeper runs, TE premium included", () => {
    expect(scoreActualLine({ rec: 6, rec_yd: 70, rec_td: 1, bonus_rec_te: 6 }, LEAGUE, "TE")).toBeCloseTo(6 + 7 + 6 + 3);
  });

  it("ignores Sleeper's own derived figures on the line", () => {
    expect(scoreActualLine({ rush_yd: 100, pts_ppr: 55, gp: 1 }, LEAGUE, "RB")).toBeCloseTo(10);
  });

  it("scores a defender's actual line only when the league scores defenders", () => {
    const line = { idp_tkl_solo: 6, idp_tkl_ast: 2, idp_sack: 1, pts_idp: 40 };
    expect(scoreActualLine(line, IDP_LEAGUE, "LB")).toBeCloseTo(6 + 1 + 4);
    expect(scoreActualLine(line, LEAGUE, "LB")).toBeNull();
  });

  it("scores a team defense's points-allowed bucket", () => {
    const withDefense = { ...LEAGUE, pts_allow_0: 10, def_int: 2, sack: 1 };
    expect(scoreActualLine({ pts_allow_0: 1, def_int: 1, sack: 3 }, withDefense, "DEF")).toBeCloseTo(10 + 2 + 3);
  });

  it("returns null for unusable scoring rather than a zero", () => {
    expect(scoreActualLine({ rush_yd: 100 }, {}, "RB")).toBeNull();
    expect(scoreActualLine(null, LEAGUE, "RB")).toBeNull();
  });
});
