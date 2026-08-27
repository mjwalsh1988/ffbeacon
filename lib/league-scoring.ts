/**
 * League-native fantasy scoring.
 *
 * Sleeper publishes projections and actual results as a flat stat map whose keys
 * are the SAME tokens a league's `scoring_settings` uses. A projection carries
 * `{ rec: 6.28, rec_yd: 67.61, bonus_rec_te: 6.28, ... }` and a league carries
 * `{ rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5, ... }`. Scoring a player is
 * therefore a dot product over the keys the two maps share.
 *
 * That single fact is what lets Power Pulse answer "what will this player score
 * for YOUR team" instead of "what would this player score in generic PPR". It
 * covers TE premium (Sleeper emits `bonus_rec_te` as the TE's reception count),
 * per-position reception bonuses (`bonus_rec_rb` / `bonus_rec_wr`), first-down
 * scoring, yardage and completion bonuses, kicker distance buckets, and team
 * defense points-allowed / yards-allowed buckets, all without special cases.
 *
 * The same function scores projections and actual results, so a beat rate is
 * always measured on the same scale as the projection it is judging.
 *
 * Fallback: a league with no usable scoring settings falls back to the stored
 * pts_ppr / pts_half_ppr / pts_std column plus an explicit TE premium. See
 * `scoreWithFallback`.
 */

/** A Sleeper scoring_settings map: stat key to points per unit. */
export type ScoringSettings = Record<string, number>;

/** A Sleeper stat or projection map: stat key to quantity. */
export type StatMap = Record<string, unknown>;

/** The three canonical scoring bases we store denormalized columns for. */
export type ScoringBase = "pts_ppr" | "pts_half_ppr" | "pts_std";

/**
 * Keys that can appear in a stat map but are never scorable quantities. We
 * iterate the SCORING map (not the stat map), and no real Sleeper scoring
 * setting uses these names, so this is belt and braces against a malformed
 * league object rather than an expected case.
 */
const NON_SCORING_KEYS = new Set([
  "pts_ppr",
  "pts_half_ppr",
  "pts_std",
  "pts_dd_ppr",
  "gp",
  "gs",
  "cmp_pct",
  "off_snp",
  "tm_off_snp",
  "snap_pct",
  "tm_def_snp",
  "def_snp",
  "st_snp",
  "tm_st_snp",
]);

/**
 * Exported because the Positional WAR fingerprint (lib/positional-war/fingerprint.ts)
 * derives its normalized scoring map from exactly the key set scoreStatMap
 * iterates below. If the filtering in scoreStatMap ever changes, this function
 * must change with it, and lib/league-scoring.test.ts asserts the two stay in
 * step.
 */
export function isNonScoringKey(key: string): boolean {
  if (NON_SCORING_KEYS.has(key)) return true;
  // adp_ppr, adp_dynasty_2qb, pos_adp_dd_ppr, pos_rank_ppr, rank_ppr ...
  return (
    key.startsWith("adp_") ||
    key.startsWith("pos_adp") ||
    key.startsWith("pos_rank") ||
    key.startsWith("rank_")
  );
}

/** Yardage keys. A league missing every one of these is not usable. */
const CORE_YARDAGE_KEYS = ["pass_yd", "rush_yd", "rec_yd"] as const;
/** Touchdown keys. Same idea. */
const CORE_TD_KEYS = ["pass_td", "rush_td", "rec_td"] as const;

/**
 * Whether a scoring map is complete enough to trust for a dot product. A league
 * object that arrived empty or truncated would otherwise silently produce tiny
 * scores that look like real, terrible teams.
 */
export function isUsableScoring(scoring: ScoringSettings | null | undefined): boolean {
  if (!scoring || typeof scoring !== "object") return false;
  const hasYardage = CORE_YARDAGE_KEYS.some((k) => typeof scoring[k] === "number");
  const hasTd = CORE_TD_KEYS.some((k) => typeof scoring[k] === "number");
  return hasYardage && hasTd;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Score one stat map under one league's rules. Returns null when the scoring map
 * is unusable, so callers can decide between falling back and skipping.
 *
 * Keys the league scores but Sleeper does not project (individual defensive
 * player stats, special teams keys on a skill player) contribute zero, which is
 * the correct answer: we have no expectation for them.
 */
export function scoreStatMap(
  stats: StatMap | null | undefined,
  scoring: ScoringSettings | null | undefined,
): number | null {
  if (!isUsableScoring(scoring)) return null;
  if (!stats || typeof stats !== "object") return null;

  let total = 0;
  for (const [key, perUnit] of Object.entries(scoring as ScoringSettings)) {
    if (typeof perUnit !== "number" || !Number.isFinite(perUnit) || perUnit === 0) continue;
    if (isNonScoringKey(key)) continue;
    const quantity = numeric((stats as Record<string, unknown>)[key]);
    if (quantity === null || quantity === 0) continue;
    total += quantity * perUnit;
  }
  return Number.isFinite(total) ? total : null;
}

/**
 * The canonical base whose stored column is closest to a league's real rules.
 * Used to look up the derived tables that are keyed by base rather than by
 * league (player_projection_accuracy, nfl_defense_vs_position), and as the
 * fallback column when a league's scoring settings are unusable.
 */
export function closestScoringBase(scoring: ScoringSettings | null | undefined): ScoringBase {
  const rec = numeric(scoring?.rec) ?? 0;
  if (rec >= 0.75) return "pts_ppr";
  if (rec >= 0.25) return "pts_half_ppr";
  return "pts_std";
}

/**
 * Extra points a tight end earns per reception beyond the base scoring. Sleeper
 * expresses a TE premium either as `bonus_rec_te` (the common case) or by
 * raising `rec_te` above the league's `rec`. Only used by the fallback path;
 * the dot product picks both up natively.
 */
export function tePremiumPerReception(scoring: ScoringSettings | null | undefined): number {
  const bonus = numeric(scoring?.bonus_rec_te) ?? 0;
  const recTe = numeric(scoring?.rec_te);
  const rec = numeric(scoring?.rec) ?? 0;
  const fromRecTe = recTe !== null && recTe > rec ? recTe - rec : 0;
  return Math.max(bonus, fromRecTe);
}

/** The stored point columns for a projection or stat row. */
export type StoredPoints = {
  ppr: number | null;
  half_ppr: number | null;
  std: number | null;
};

/**
 * Score a row under the league's rules, falling back to the stored canonical
 * column when the league's scoring settings are unusable.
 *
 * `position` drives the fallback TE premium only. On the primary path the stat
 * map already carries `bonus_rec_te`, so position is not consulted.
 */
export function scoreWithFallback(
  stats: StatMap | null | undefined,
  stored: StoredPoints,
  scoring: ScoringSettings | null | undefined,
  position: string | null | undefined,
): { points: number | null; usedLeagueScoring: boolean } {
  const exact = scoreStatMap(stats, scoring);
  if (exact !== null) return { points: exact, usedLeagueScoring: true };

  const base = closestScoringBase(scoring);
  const fallback =
    base === "pts_half_ppr" ? stored.half_ppr : base === "pts_std" ? stored.std : stored.ppr;
  if (fallback === null || fallback === undefined) {
    return { points: null, usedLeagueScoring: false };
  }

  let points = fallback;
  const pos = (position ?? "").toUpperCase();
  if (pos === "TE") {
    const premium = tePremiumPerReception(scoring);
    if (premium > 0) {
      const receptions = numeric((stats as Record<string, unknown> | null)?.rec) ?? 0;
      points += premium * receptions;
    }
  }
  return { points, usedLeagueScoring: false };
}

/**
 * Human-readable summary of how a league scores, for the "how this was
 * calculated" disclosure. Deliberately short: the reader wants confirmation we
 * read their settings, not a rules dump.
 */
export function describeLeagueScoring(scoring: ScoringSettings | null | undefined): string {
  if (!isUsableScoring(scoring)) return "Standard scoring (league settings unavailable)";
  const rec = numeric(scoring?.rec) ?? 0;
  const parts: string[] = [];
  if (rec >= 0.75) parts.push("Full PPR");
  else if (rec >= 0.25) parts.push(`${rec} PPR`);
  else parts.push("Standard (no PPR)");

  const passTd = numeric(scoring?.pass_td);
  if (passTd !== null && passTd !== 4) parts.push(`${passTd} point passing TDs`);

  const premium = tePremiumPerReception(scoring);
  if (premium > 0) parts.push(`TE premium +${premium}`);

  const passYd = numeric(scoring?.pass_yd);
  if (passYd !== null && passYd !== 0.04) parts.push(`${passYd} per passing yard`);

  const firstDowns = numeric(scoring?.rec_fd) ?? 0;
  if (firstDowns > 0) parts.push("first downs score");

  return parts.join(", ");
}
