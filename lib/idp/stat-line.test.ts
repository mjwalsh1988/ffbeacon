import { describe, expect, it } from "vitest";
import { IDP_PRESETS, IDP_SCORING_KEYS } from "./scoring-presets";
import {
  hasIdpStats,
  normalizeActualIdpLine,
  normalizeProjectedIdpLine,
  scoreIdpLine,
} from "./stat-line";

/**
 * Roquan Smith, 2025 week 2, exactly as player_stats.metadata.stats stores it
 * (read on 2026-09-24). Sleeper's own pts_idp for the week is 40.
 */
const ROQUAN_2025_W2 = {
  gp: 1,
  gs: 1,
  def_snp: 66,
  idp_tkl: 15,
  pts_idp: 40,
  pts_ppr: 8,
  pts_std: 8,
  tm_st_snp: 33,
  gms_active: 1,
  idp_def_td: 1,
  idp_qb_hit: 2,
  tm_def_snp: 73,
  tm_off_snp: 56,
  anytime_tds: 1,
  idp_fum_rec: 1,
  idp_tkl_ast: 7,
  idp_tkl_loss: 3,
  idp_tkl_solo: 8,
  pos_rank_ppr: 999,
  pos_rank_std: 999,
  pts_half_ppr: 8,
  bonus_tkl_10p: 1,
  idp_fum_ret_yd: 63,
  pos_rank_half_ppr: 999,
  bonus_def_fum_td_50p: 1,
};

describe("scoreIdpLine", () => {
  it("scores Roquan Smith's 15-tackle week at 40 under Sleeper's default, matching Sleeper", () => {
    expect(scoreIdpLine(normalizeActualIdpLine(ROQUAN_2025_W2), IDP_PRESETS.idp123)).toBe(40);
  });

  it("scores the same week differently under Big 3", () => {
    // solo 8x1.25 + ast 7x0.75 + qb hit 2x2 + tfl 3x3 + fr 3 + td 6
    expect(scoreIdpLine(normalizeActualIdpLine(ROQUAN_2025_W2), IDP_PRESETS.big3)).toBeCloseTo(37.25, 10);
  });
});

describe("normalizeActualIdpLine", () => {
  it("drops Sleeper's derived figures and games counters, keeps what was credited", () => {
    const line = normalizeActualIdpLine(ROQUAN_2025_W2);
    expect(line.pts_ppr).toBeUndefined();
    expect(line.pts_idp).toBeUndefined();
    expect(line.pos_rank_ppr).toBeUndefined();
    expect(line.gp).toBeUndefined();
    expect(line.bonus_tkl_10p).toBe(1);
    expect(line.idp_fum_ret_yd).toBe(63);
  });
});

describe("normalizeProjectedIdpLine", () => {
  it("drops team-defense and ADP keys from a projected line", () => {
    const line = normalizeProjectedIdpLine({
      idp_tkl: 7.1,
      idp_tkl_solo: 5,
      def_pr_yd: 4.2,
      def_pr_td: 0.01,
      pass_int_td: 0.02,
      adp_idp: 120,
      pts_ppr: 1.3,
    });
    expect(line).toEqual({ idp_tkl: 7.1, idp_tkl_solo: 5 });
  });

  it("derives combined tackles when only solo and assisted are projected", () => {
    expect(normalizeProjectedIdpLine({ idp_tkl_solo: 5, idp_tkl_ast: 3 }).idp_tkl).toBe(8);
  });

  it("keeps a projected combined figure rather than recomputing it", () => {
    expect(normalizeProjectedIdpLine({ idp_tkl: 9, idp_tkl_solo: 5, idp_tkl_ast: 3 }).idp_tkl).toBe(9);
  });

  it("returns an empty line for nothing", () => {
    expect(normalizeProjectedIdpLine(null)).toEqual({});
    expect(hasIdpStats({ pts_ppr: 2 })).toBe(false);
    expect(hasIdpStats({ idp_sack: 0.4 })).toBe(true);
  });
});

describe("IDP_PRESETS", () => {
  it("carries only idp keys plus the two zeroed bonuses in every preset", () => {
    for (const map of Object.values(IDP_PRESETS)) {
      for (const [key, weight] of Object.entries(map)) {
        const allowed = key.startsWith("idp_") || key === "bonus_tkl_10p" || key === "bonus_sack_2p";
        expect(allowed).toBe(true);
        if (key.startsWith("bonus_")) expect(weight).toBe(0);
      }
      for (const key of IDP_SCORING_KEYS) expect(map[key]).toBeDefined();
    }
  });

  it("holds Sleeper's default exactly as decision D-1 recorded it", () => {
    const d = IDP_PRESETS.idp123;
    expect([d.idp_tkl_solo, d.idp_tkl_ast, d.idp_tkl_loss, d.idp_sack, d.idp_qb_hit]).toEqual([2, 1, 2, 6, 1]);
    expect([d.idp_pass_def, d.idp_ff, d.idp_fum_rec, d.idp_safe, d.idp_blk_kick]).toEqual([3, 3, 3, 3, 3]);
    expect([d.idp_int, d.idp_def_td, d.idp_tkl, d.idp_sack_yd]).toEqual([6, 6, 0, 0]);
  });
});
