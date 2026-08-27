import { describe, it, expect } from "vitest";
import {
  closestScoringBase,
  describeLeagueScoring,
  isNonScoringKey,
  isUsableScoring,
  scoreStatMap,
  scoreWithFallback,
  tePremiumPerReception,
  type ScoringSettings,
} from "./league-scoring";
import { normalizedScoring } from "./positional-war/fingerprint";

// A real Sleeper scoring_settings map, trimmed to the keys that matter here.
// Taken from a live 2026 dynasty superflex TE-premium league.
const TEP_LEAGUE: ScoringSettings = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rush_yd: 0.1,
  rush_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -1,
  fum_lost: -2,
  bonus_rec_te: 0.5,
};

// A real TE projection stat line from player_weekly_projections.
const TE_PROJECTION = {
  gp: 1,
  rec: 6.28,
  rec_yd: 67.61,
  rec_td: 0.38,
  fum_lost: 0.02,
  bonus_rec_te: 6.28,
  pts_ppr: 15.31,
  pts_half_ppr: 12.17,
  pts_std: 9.03,
  adp_dd_ppr: 10,
  pos_adp_dd_ppr: 1,
};

describe("scoreStatMap", () => {
  it("reproduces Sleeper's own PPR number when the league is plain PPR", () => {
    const plainPpr: ScoringSettings = { ...TEP_LEAGUE, bonus_rec_te: 0 };
    const points = scoreStatMap(TE_PROJECTION, plainPpr);
    // 6.28 + 6.761 + 2.28 - 0.04 = 15.281, against Sleeper's 15.31.
    expect(points).toBeCloseTo(15.28, 1);
  });

  it("applies a TE premium natively, because Sleeper projects bonus_rec_te", () => {
    const plainPpr: ScoringSettings = { ...TEP_LEAGUE, bonus_rec_te: 0 };
    const base = scoreStatMap(TE_PROJECTION, plainPpr) as number;
    const premium = scoreStatMap(TE_PROJECTION, TEP_LEAGUE) as number;
    // 6.28 receptions at +0.5 each.
    expect(premium - base).toBeCloseTo(3.14, 2);
  });

  it("ignores adp and pts_ keys that ride along in the stat line", () => {
    const polluted: ScoringSettings = { ...TEP_LEAGUE, pts_ppr: 1, adp_dd_ppr: 1 };
    expect(scoreStatMap(TE_PROJECTION, polluted)).toBeCloseTo(
      scoreStatMap(TE_PROJECTION, TEP_LEAGUE) as number,
      6,
    );
  });

  it("scores keys the league defines but Sleeper does not project as zero", () => {
    const withIdp: ScoringSettings = { ...TEP_LEAGUE, idp_tkl: 1, idp_sack: 4 };
    expect(scoreStatMap(TE_PROJECTION, withIdp)).toBeCloseTo(
      scoreStatMap(TE_PROJECTION, TEP_LEAGUE) as number,
      6,
    );
  });

  it("handles a six-point passing touchdown league", () => {
    const qbLine = { pass_yd: 229.63, pass_td: 1.71, pass_int: 0.66, rush_yd: 30.55, rush_td: 0.59 };
    const fourPoint = scoreStatMap(qbLine, TEP_LEAGUE) as number;
    const sixPoint = scoreStatMap(qbLine, { ...TEP_LEAGUE, pass_td: 6 }) as number;
    expect(sixPoint - fourPoint).toBeCloseTo(1.71 * 2, 5);
  });

  it("scores a team defense through its points-allowed bucket", () => {
    const defLine = { sack: 2.83, int: 0.96, def_td: 0.24, pts_allow_14_20: 1 };
    const defScoring: ScoringSettings = {
      ...TEP_LEAGUE,
      sack: 1,
      int: 2,
      def_td: 6,
      pts_allow_14_20: 1,
    };
    // 2.83 + 1.92 + 1.44 + 1 = 7.19
    expect(scoreStatMap(defLine, defScoring)).toBeCloseTo(7.19, 2);
  });

  it("returns null rather than a misleading zero when scoring is unusable", () => {
    expect(scoreStatMap(TE_PROJECTION, {})).toBeNull();
    expect(scoreStatMap(TE_PROJECTION, null)).toBeNull();
    expect(scoreStatMap(TE_PROJECTION, { rec: 1 })).toBeNull();
    expect(scoreStatMap(null, TEP_LEAGUE)).toBeNull();
  });
});

describe("isUsableScoring", () => {
  it("requires both a yardage key and a touchdown key", () => {
    expect(isUsableScoring({ rec_yd: 0.1 })).toBe(false);
    expect(isUsableScoring({ rec_td: 6 })).toBe(false);
    expect(isUsableScoring({ rec_yd: 0.1, rec_td: 6 })).toBe(true);
  });
});

describe("closestScoringBase", () => {
  it("maps reception scoring onto the stored column we keep", () => {
    expect(closestScoringBase({ rec: 1 })).toBe("pts_ppr");
    expect(closestScoringBase({ rec: 0.5 })).toBe("pts_half_ppr");
    expect(closestScoringBase({ rec: 0 })).toBe("pts_std");
    expect(closestScoringBase(null)).toBe("pts_std");
  });
});

describe("tePremiumPerReception", () => {
  it("reads a premium from bonus_rec_te or from an elevated rec_te", () => {
    expect(tePremiumPerReception({ rec: 1, bonus_rec_te: 0.5 })).toBe(0.5);
    expect(tePremiumPerReception({ rec: 1, rec_te: 1.5 })).toBe(0.5);
    expect(tePremiumPerReception({ rec: 1 })).toBe(0);
  });
});

describe("scoreWithFallback", () => {
  const stored = { ppr: 15.31, half_ppr: 12.17, std: 9.03 };

  it("prefers league scoring when it is usable", () => {
    const result = scoreWithFallback(TE_PROJECTION, stored, TEP_LEAGUE, "TE");
    expect(result.usedLeagueScoring).toBe(true);
    expect(result.points).toBeCloseTo(18.42, 1);
  });

  it("falls back to the stored column plus a TE premium", () => {
    const result = scoreWithFallback(TE_PROJECTION, stored, { rec: 1, bonus_rec_te: 0.5 }, "TE");
    expect(result.usedLeagueScoring).toBe(false);
    // 15.31 + 0.5 * 6.28
    expect(result.points).toBeCloseTo(18.45, 2);
  });

  it("does not apply the TE premium to a non-TE", () => {
    const result = scoreWithFallback(TE_PROJECTION, stored, { rec: 1, bonus_rec_te: 0.5 }, "WR");
    expect(result.points).toBeCloseTo(15.31, 5);
  });

  it("returns null when there is nothing at all to score", () => {
    const result = scoreWithFallback(
      TE_PROJECTION,
      { ppr: null, half_ppr: null, std: null },
      { rec: 1 },
      "TE",
    );
    expect(result.points).toBeNull();
  });
});

describe("describeLeagueScoring", () => {
  it("summarizes the rules a reader would want confirmed", () => {
    expect(describeLeagueScoring(TEP_LEAGUE)).toBe("Full PPR, TE premium +0.5");
    expect(describeLeagueScoring({ ...TEP_LEAGUE, pass_td: 6 })).toBe(
      "Full PPR, 6 point passing TDs, TE premium +0.5",
    );
    expect(describeLeagueScoring({})).toBe("Standard scoring (league settings unavailable)");
  });
});

describe("isNonScoringKey", () => {
  it("flags the literal non-scoring keys and every adp_/pos_rank_/rank_ prefix", () => {
    expect(isNonScoringKey("pts_ppr")).toBe(true);
    expect(isNonScoringKey("gp")).toBe(true);
    expect(isNonScoringKey("adp_ppr")).toBe(true);
    expect(isNonScoringKey("adp_dynasty_2qb")).toBe(true);
    expect(isNonScoringKey("pos_rank_ppr")).toBe(true);
    expect(isNonScoringKey("rank_ppr")).toBe(true);
  });

  it("does not flag a real scoring key", () => {
    expect(isNonScoringKey("rec")).toBe(false);
    expect(isNonScoringKey("pass_td")).toBe(false);
    expect(isNonScoringKey("bonus_rec_te")).toBe(false);
  });
});

// T-WAR-04: the Positional WAR fingerprint (lib/positional-war/fingerprint.ts)
// derives normalizedScoring from isNonScoringKey. This suite proves the key set
// normalizedScoring returns is exactly the key set scoreStatMap actually reads,
// as a property of scoreStatMap's own behavior rather than an assumption about
// its filtering. If scoreStatMap's filtering ever changes without a matching
// change here, one of the assertions below fails.
describe("normalizedScoring key-set parity with scoreStatMap (T-WAR-04)", () => {
  const FIXTURE: ScoringSettings = {
    rec: 1,
    rec_yd: 0.1,
    rec_td: 6,
    pass_yd: 0.04,
    pass_td: 4,
    rush_td: 0, // zero-valued: never scores, regardless of quantity
    bonus_rec_te: Number.NaN, // non-finite: never scores
    adp_ppr: 3, // excluded key, adp_ prefix
    pos_rank_ppr: 2, // excluded key, pos_rank prefix
    pts_ppr: 1, // excluded key, literal
  };

  const includedKeys = new Set(normalizedScoring(FIXTURE).map(([key]) => key));

  it("keeps exactly the keys that can affect a score, and drops the rest", () => {
    expect(includedKeys).toEqual(new Set(["pass_td", "pass_yd", "rec", "rec_td", "rec_yd"]));
  });

  const baseStats: Record<string, number> = {
    rec: 4,
    rec_yd: 40,
    rec_td: 1,
    pass_yd: 200,
    pass_td: 2,
    rush_td: 1,
    bonus_rec_te: 4,
    adp_ppr: 10,
    pos_rank_ppr: 5,
    pts_ppr: 99,
  };

  for (const key of Object.keys(FIXTURE)) {
    const isIncluded = includedKeys.has(key);

    it(`changing "${key}"'s stat quantity ${isIncluded ? "changes" : "never changes"} scoreStatMap's result`, () => {
      const before = scoreStatMap(baseStats, FIXTURE);
      const changed = { ...baseStats, [key]: (baseStats[key] ?? 0) + 10 };
      const after = scoreStatMap(changed, FIXTURE);

      if (isIncluded) {
        expect(after).not.toBe(before);
      } else {
        expect(after).toBe(before);
      }
    });
  }
});
