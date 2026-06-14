/**
 * Stat scoring for FF Beacon's stat_value signal. B3 scope: kicking and team
 * defense (the positions no external source values). Skill re-scoring for custom
 * formats arrives in a later phase; the shape here is built to extend to it.
 *
 * Point values and recency weights are tunable: they come from
 * beacon_signal_weights.params for the stat_value row (admin-editable). The
 * DEFAULT_STAT_SCORING here is a fallback used only when a key is absent.
 */

export interface StatScoringConfig {
  kicker: Record<string, number>;
  defense: Record<string, number>;
  /** Weights for the latest N seasons, most-recent first. */
  recencyWeights: number[];
}

export const DEFAULT_STAT_SCORING: StatScoringConfig = {
  kicker: {
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5,
    xpm: 1, fgmiss: -1, xpmiss: -1,
  },
  defense: {
    sack: 1, interceptions: 2, fum_rec: 2, def_td: 6, safety: 2, blk_kick: 2,
    pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
    pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
  },
  recencyWeights: [0.65, 0.35],
};

/** Columns the stat_value producer must pull, derived from the scoring config. */
export const KICKER_STAT_COLUMNS = Object.keys(DEFAULT_STAT_SCORING.kicker);
export const DEFENSE_STAT_COLUMNS = Object.keys(DEFAULT_STAT_SCORING.defense);

// --- Skill scoring (B4: stat_performance trajectory; B5: custom-format compute) ---

export interface SkillScoringConfig {
  ppr: number;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  pass_2pt: number;
  rush_yd: number;
  rush_td: number;
  rush_2pt: number;
  rec_yd: number;
  rec_td: number;
  rec_2pt: number;
  fum_lost: number;
  /** Bonus points per reception for tight ends (TE premium). */
  te_premium: number;
}

export const DEFAULT_SKILL_SCORING: SkillScoringConfig = {
  ppr: 1, pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, te_premium: 0,
};

export const SKILL_STAT_COLUMNS = [
  "pass_yd", "pass_td", "pass_int", "pass_2pt",
  "rush_yd", "rush_td", "rush_2pt",
  "rec", "rec_yd", "rec_td", "rec_2pt", "fum_lost",
];

/** Every scorable column a stat profile stores (skill + kicker + defense). */
export const PROFILE_COLUMNS = Array.from(
  new Set([...SKILL_STAT_COLUMNS, ...KICKER_STAT_COLUMNS, ...DEFENSE_STAT_COLUMNS]),
);

/** Score one summed skill stat line under a scoring config. */
export function scoreSkillLine(
  line: Record<string, number>,
  config: SkillScoringConfig,
  position: string,
): number {
  let p = 0;
  p += (line.pass_yd ?? 0) * config.pass_yd;
  p += (line.pass_td ?? 0) * config.pass_td;
  p += (line.pass_int ?? 0) * config.pass_int;
  p += (line.pass_2pt ?? 0) * config.pass_2pt;
  p += (line.rush_yd ?? 0) * config.rush_yd;
  p += (line.rush_td ?? 0) * config.rush_td;
  p += (line.rush_2pt ?? 0) * config.rush_2pt;
  p += (line.rec ?? 0) * config.ppr;
  p += (line.rec_yd ?? 0) * config.rec_yd;
  p += (line.rec_td ?? 0) * config.rec_td;
  p += (line.rec_2pt ?? 0) * config.rec_2pt;
  p += (line.fum_lost ?? 0) * config.fum_lost;
  if (position === "TE") p += (line.rec ?? 0) * config.te_premium;
  return p;
}

/** Merge admin params over the code defaults (params win where present). */
export function mergeScoringConfig(params: unknown): StatScoringConfig {
  const p = (params ?? {}) as Partial<{
    kicker: Record<string, number>;
    defense: Record<string, number>;
    recency_weights: number[];
  }>;
  return {
    kicker: { ...DEFAULT_STAT_SCORING.kicker, ...(p.kicker ?? {}) },
    defense: { ...DEFAULT_STAT_SCORING.defense, ...(p.defense ?? {}) },
    recencyWeights:
      Array.isArray(p.recency_weights) && p.recency_weights.length > 0
        ? p.recency_weights
        : DEFAULT_STAT_SCORING.recencyWeights,
  };
}

/** Score one season's summed stat line for a position. */
export function scoreSeasonLine(
  position: "K" | "DEF",
  line: Record<string, number>,
  config: StatScoringConfig,
): number {
  const weights = position === "K" ? config.kicker : config.defense;
  let pts = 0;
  for (const [key, w] of Object.entries(weights)) {
    pts += (line[key] ?? 0) * w;
  }
  return pts;
}

/**
 * Recency-weighted total across seasons (most-recent first). Weights are
 * renormalized over the seasons actually present, so a player with only one
 * season is scored on that season alone rather than penalized for missing data.
 */
export function recencyWeightedScore(
  seasonPointsDesc: number[],
  weights: number[],
): number {
  if (seasonPointsDesc.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (let i = 0; i < seasonPointsDesc.length; i += 1) {
    const w = weights[i] ?? 0;
    if (w === 0) continue;
    num += w * seasonPointsDesc[i];
    den += w;
  }
  if (den <= 0) return seasonPointsDesc[0];
  return num / den;
}
