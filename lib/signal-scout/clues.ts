/**
 * Clue taxonomy, gating, display rendering, and starter selection for Signal
 * Scout (plan sections 10, 11, 12, 14, 18).
 *
 * CLUE_DEFINITIONS is the single catalog of every clue TYPE: its tier, category,
 * starter eligibility, and specificity. generateClueCandidates turns one
 * player's facts into the concrete GeneratedClue rows for a round (every gate
 * from plan section 10 lives here); it never invents a tier, category, or
 * specificity outside CLUE_DEFINITIONS, it only decides whether a clue's data
 * exists and renders the display string. selectStarterClues then picks the
 * free-reveal starter set under the section 12 rules. computeClueCoverage and
 * applyDisabledKeys are the seams eligibility.ts and the admin settings screen
 * consume.
 *
 * Specificity scale (1 to 5, higher = more identifying):
 *   1 = broad, shared by most of the pool (conference, position group, a wide
 *       experience bucket)
 *   2 = a real narrowing fact but still shared by many players (age/points/
 *       value range buckets, height, 30-day movement direction)
 *   3 = a specific number that meaningfully narrows the field (weight, exact
 *       experience, college, one named-season stat, division, overall rank
 *       range, ADP range)
 *   4 = strongly narrowing (exact age, career highs)
 *   5 = near-unique or answer-adjacent (exact position, current team,
 *       last-name initial, the full stat line)
 * These numbers are the actual per-clue judgment call; they are documented
 * inline on each CLUE_DEFINITIONS entry below.
 *
 * Snap share and red zone usage (mentioned in plan section 10) are NOT
 * implemented: StatsBundle (stats-bundle.ts) aggregates SeasonAgg.line, which
 * has no snap_pct or red-zone-attempt fields, and this module must not modify
 * stats-bundle.ts. They can be added once that aggregation is extended.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClueSettings, SignalTier } from "./types";
import type { ClueCoverageInput } from "./eligibility";
import type { StatsBundle } from "./stats-bundle";
import { computeAgeYears, formatAge } from "@/lib/player-age";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type ClueCategory = "bio" | "team" | "stat" | "value";

export interface ClueDefinition {
  key: string;
  category: ClueCategory;
  tier: SignalTier;
  /** Whether this clue type is eligible to be chosen as a free starter reveal. */
  starterEligible: boolean;
  /** 1 (broad) to 5 (near-unique). See the module doc comment for the scale. */
  specificity: number;
  label: string;
}

export const CLUE_DEFINITIONS: ClueDefinition[] = [
  // --- Bio ---------------------------------------------------------------
  {
    key: "age_range",
    category: "bio",
    tier: "weak",
    starterEligible: true,
    specificity: 2,
    label: "Age range",
  },
  {
    key: "exact_age",
    category: "bio",
    tier: "clear",
    starterEligible: false,
    specificity: 4,
    label: "Exact age",
  },
  {
    key: "experience_range",
    category: "bio",
    tier: "weak",
    starterEligible: true,
    specificity: 1,
    label: "Experience range",
  },
  {
    key: "exact_experience",
    category: "bio",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Exact experience",
  },
  {
    key: "height",
    category: "bio",
    tier: "weak",
    starterEligible: true,
    specificity: 2,
    label: "Height",
  },
  {
    key: "weight",
    category: "bio",
    tier: "weak",
    starterEligible: true,
    // Weight is a finer-grained number than height (many more distinct
    // values in the pool), so it narrows further; kept out of the exact-age
    // territory since many players still share a weight.
    specificity: 3,
    label: "Weight",
  },
  {
    key: "college",
    category: "bio",
    tier: "clear",
    starterEligible: false,
    specificity: 4,
    label: "College",
  },
  {
    key: "high_school",
    category: "bio",
    tier: "weak",
    starterEligible: false,
    specificity: 3,
    label: "High school",
  },
  {
    key: "jersey_number",
    category: "bio",
    tier: "weak",
    starterEligible: false,
    specificity: 3,
    label: "Jersey number",
  },
  {
    key: "last_name_initial",
    category: "bio",
    tier: "scan",
    starterEligible: false,
    specificity: 5,
    label: "Last name initial",
  },

  // --- Team and position ---------------------------------------------------
  {
    key: "conference",
    category: "team",
    tier: "weak",
    starterEligible: true,
    specificity: 1,
    label: "Conference",
  },
  {
    key: "division",
    category: "team",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Division",
  },
  {
    key: "position_group",
    category: "team",
    tier: "weak",
    starterEligible: true,
    // Plan section 10 offers QB rounds two options: render as "offensive
    // skill player" or skip. A constant string true of every pool player
    // carries zero information (wastes a starter slot / weak purchase), and
    // a QB-distinct string would itself be a meta-leak (its mere presence
    // would announce "not QB"). So generateClueCandidates takes the skip
    // branch for QB targets and never emits this key for them; RB/WR/TE
    // targets get displayValue "Not a quarterback", which is genuinely
    // informative (rules out one of the four pool positions) at low
    // specificity.
    specificity: 1,
    label: "Position group",
  },
  {
    key: "exact_position",
    category: "team",
    tier: "ping",
    starterEligible: false,
    specificity: 5,
    label: "Exact position",
  },
  {
    key: "current_team",
    category: "team",
    tier: "scan",
    starterEligible: false,
    specificity: 5,
    label: "Current team",
  },

  // --- Stats, 2020+ regular seasons -----------------------------------------
  {
    key: "last_season_points_range",
    category: "stat",
    tier: "weak",
    starterEligible: true,
    specificity: 2,
    label: "Last season PPR points range",
  },
  {
    key: "season_points_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season PPR points",
  },
  {
    key: "season_games_played",
    category: "stat",
    tier: "weak",
    starterEligible: false,
    specificity: 1,
    label: "Season games played",
  },
  {
    key: "season_total_yards_range",
    category: "stat",
    tier: "weak",
    starterEligible: false,
    specificity: 2,
    label: "Season total yards range",
  },
  {
    key: "season_passing_yards_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season passing yards",
  },
  {
    key: "season_passing_tds_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season passing touchdowns",
  },
  {
    key: "season_rushing_yards_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season rushing yards",
  },
  {
    key: "season_rushing_tds_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season rushing touchdowns",
  },
  {
    key: "season_receiving_yards_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season receiving yards",
  },
  {
    key: "season_receiving_tds_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season receiving touchdowns",
  },
  {
    key: "season_receptions_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season receptions",
  },
  {
    key: "season_targets_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season targets",
  },
  {
    key: "season_carries_exact",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Season carries",
  },
  {
    key: "career_high_points",
    category: "stat",
    tier: "ping",
    starterEligible: false,
    specificity: 4,
    label: "Career high PPR points since 2020",
  },
  {
    key: "career_high_yards",
    category: "stat",
    tier: "clear",
    starterEligible: false,
    specificity: 4,
    label: "Career high total yards since 2020",
  },
  {
    key: "positional_finish",
    category: "stat",
    tier: "ping",
    starterEligible: false,
    specificity: 4,
    label: "Positional finish",
  },
  {
    key: "best_positional_finish",
    category: "stat",
    tier: "ping",
    starterEligible: false,
    specificity: 4,
    label: "Best positional finish since 2020",
  },
  {
    key: "season_stat_line",
    category: "stat",
    tier: "scan",
    starterEligible: false,
    specificity: 5,
    label: "Full season stat line",
  },

  // --- Value and market ------------------------------------------------------
  {
    key: "value_range",
    category: "value",
    tier: "weak",
    starterEligible: true,
    specificity: 2,
    label: "FF Beacon value range",
  },
  {
    key: "overall_rank_range",
    category: "value",
    tier: "clear",
    starterEligible: false,
    specificity: 3,
    label: "Overall rank range",
  },
  {
    key: "value_movement_30d",
    category: "value",
    tier: "ping",
    starterEligible: false,
    // Direction plus a rounded percent is flavorful but weakly identifying;
    // many players share a movement direction and rough magnitude.
    specificity: 2,
    label: "30-day value movement",
  },
  {
    key: "sleeper_adp_range",
    category: "value",
    tier: "ping",
    starterEligible: false,
    specificity: 3,
    label: "Sleeper ADP range",
  },
];

const DEF_BY_KEY = new Map(CLUE_DEFINITIONS.map((d) => [d.key, d]));

// ---------------------------------------------------------------------------
// Generated clue shape
// ---------------------------------------------------------------------------

export type GeneratedClue = {
  clueKey: string;
  tier: SignalTier;
  category: ClueCategory;
  label: string;
  /** Pre-rendered, plain-ASCII display string, frozen at generation time. */
  displayValue: string;
  specificity: number;
};

function emit(out: GeneratedClue[], key: string, displayValue: string): void {
  const def = DEF_BY_KEY.get(key);
  if (!def) {
    // Should never happen; every call site below uses a literal key from
    // CLUE_DEFINITIONS. Fail loudly in dev rather than silently drop a clue.
    throw new Error(`[signal-scout] generateClueCandidates: unknown clue key "${key}"`);
  }
  out.push({
    clueKey: def.key,
    tier: def.tier,
    category: def.category,
    label: def.label,
    displayValue,
    specificity: def.specificity,
  });
}

// ---------------------------------------------------------------------------
// Facts input
// ---------------------------------------------------------------------------

export type ClueValueFacts = {
  value: number;
  overallRank: number | null;
  movement30dPct: number | null;
  dataPoints30d: number;
  sourceUsed: "ffbeacon" | "ktc";
};

export type ClueAdpFacts = {
  value: number;
};

export type ClueFacts = {
  position: string;
  lastName: string;
  birthDate: string | null;
  yearsExperience: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  college: string | null;
  highSchool: string | null;
  jerseyNumber: string | null;
  /** Team abbreviation (players.team), or null. Gates every team/position clue. */
  team: string | null;
  teamName: string | null;
  conference: string | null;
  division: string | null;
  stats: StatsBundle;
  value: ClueValueFacts | null;
  adp: ClueAdpFacts | null;
};

// ---------------------------------------------------------------------------
// Bucketing and display helpers
// ---------------------------------------------------------------------------

/**
 * Floor-bucket a value into a fixed-width range. `base` shifts the origin so
 * 1-indexed values (overall rank, draft round) bucket starting at 1 instead
 * of 0. Inclusive on both ends: bucketRange(26, 2) -> {lo: 26, hi: 27}.
 */
export function bucketRange(value: number, size: number, base = 0): { lo: number; hi: number } {
  const shifted = value - base;
  const lo = Math.floor(shifted / size) * size + base;
  return { lo, hi: lo + size - 1 };
}

/** Sleeper ADP round bucket assumption: 12 picks per round (standard league size). */
const ADP_PICKS_PER_ROUND = 12;

function ageRangeDisplay(age: number): string {
  const { lo, hi } = bucketRange(age, 2);
  return `${lo} to ${hi} years old`;
}

function experienceRangeDisplay(years: number): string {
  const { lo, hi } = bucketRange(years, 2);
  return `${lo} to ${hi} years of experience`;
}

function exactExperienceDisplay(years: number): string {
  if (years === 0) return "Rookie season";
  return `${years} year${years === 1 ? "" : "s"} of experience`;
}

/** Matches the site's height convention exactly (player-bio-overview.tsx heightDisplay). */
function heightDisplay(heightInches: number): string {
  return `${Math.floor(heightInches / 12)}'${heightInches % 12}"`;
}

/** Matches the site's weight convention exactly ("lb" singular, player-bio-overview.tsx). */
function weightDisplay(weightLbs: number): string {
  return `${weightLbs} lb`;
}

function pointsRangeDisplay(points: number): string {
  const { lo, hi } = bucketRange(Math.floor(points), 25);
  return `${lo} to ${hi} PPR points`;
}

function totalYardsRangeDisplay(yards: number): string {
  const { lo, hi } = bucketRange(Math.floor(yards), 250);
  return `${lo} to ${hi} total yards`;
}

function valueRangeDisplay(value: number): string {
  const { lo, hi } = bucketRange(Math.floor(value), 500);
  return `${lo} to ${hi} FF Beacon value`;
}

function rankRangeDisplay(rank: number): string {
  const { lo, hi } = bucketRange(rank, 10, 1);
  return `Ranked ${lo} to ${hi} overall`;
}

function adpRangeDisplay(adp: number): string {
  const round = Math.max(1, Math.ceil(adp / ADP_PICKS_PER_ROUND));
  const { lo, hi } = bucketRange(round, 2, 1);
  return `Drafted in rounds ${lo} to ${hi} on Sleeper ADP`;
}

function movementDisplay(pct: number): string {
  const rounded = Math.round(Math.abs(pct));
  if (rounded === 0) return "Flat value over the last 30 days";
  const direction = pct > 0 ? "Up" : "Down";
  return `${direction} ${rounded}% in value over the last 30 days`;
}

const POSITION_NAMES: Record<string, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
};

function exactPositionDisplay(position: string): string {
  return POSITION_NAMES[position.toUpperCase()] ?? position;
}

// ---------------------------------------------------------------------------
// Season stat clue definitions (position-gated single-stat exacts)
// ---------------------------------------------------------------------------

type StatLine = StatsBundle["seasons"][number]["line"];

type SeasonStatClue = {
  key: string;
  /** Eligible positions, mirroring components/player-profile/stat-shaping.tsx statColumns(). */
  positions: string[];
  extract: (line: StatLine) => number;
  unit: string;
};

const SEASON_STAT_CLUES: SeasonStatClue[] = [
  { key: "season_passing_yards_exact", positions: ["QB"], extract: (l) => l.pass_yd, unit: "passing yards" },
  { key: "season_passing_tds_exact", positions: ["QB"], extract: (l) => l.pass_td, unit: "passing touchdowns" },
  { key: "season_rushing_yards_exact", positions: ["QB", "RB"], extract: (l) => l.rush_yd, unit: "rushing yards" },
  { key: "season_rushing_tds_exact", positions: ["QB", "RB"], extract: (l) => l.rush_td, unit: "rushing touchdowns" },
  {
    key: "season_receiving_yards_exact",
    positions: ["RB", "WR", "TE"],
    extract: (l) => l.rec_yd,
    unit: "receiving yards",
  },
  {
    key: "season_receiving_tds_exact",
    positions: ["RB", "WR", "TE"],
    extract: (l) => l.rec_td,
    unit: "receiving touchdowns",
  },
  { key: "season_receptions_exact", positions: ["RB", "WR", "TE"], extract: (l) => l.rec, unit: "receptions" },
  { key: "season_targets_exact", positions: ["WR", "TE"], extract: (l) => l.rec_tgt, unit: "targets" },
  { key: "season_carries_exact", positions: ["RB"], extract: (l) => l.rush_att, unit: "carries" },
];

function seasonStatLine(position: string, season: number, line: StatLine): string | null {
  const p = position.toUpperCase();
  if (p === "QB") {
    return `${Math.round(line.pass_cmp)} of ${Math.round(line.pass_att)} passing, ${Math.round(line.pass_yd)} yards, ${Math.round(line.pass_td)} touchdowns, ${Math.round(line.pass_int)} interceptions in ${season}`;
  }
  if (p === "RB") {
    return `${Math.round(line.rush_att)} carries, ${Math.round(line.rush_yd)} rush yards, ${Math.round(line.rush_td)} rush touchdowns, ${Math.round(line.rec)} receptions in ${season}`;
  }
  if (p === "WR" || p === "TE") {
    return `${Math.round(line.rec)} receptions, ${Math.round(line.rec_yd)} yards, ${Math.round(line.rec_td)} touchdowns in ${season}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// generateClueCandidates
// ---------------------------------------------------------------------------

/**
 * Generate every clue candidate the given facts support. A clue is emitted
 * only when its underlying data exists; nothing here consults settings
 * (disabled keys are applied separately via applyDisabledKeys so coverage
 * math can run before or after that filter, per the caller's need).
 *
 * "Named season" for the season-specific stat family (points, games, total
 * yards, the single-stat exacts, the full stat line, and the season-specific
 * positional finish) is the player's career-high-points season since 2020
 * (StatsBundle.careerHighs.points.season). Plan section 11 asks for "one or
 * two named-season clues (favoring highest points and highest volume)"; this
 * generator mints exactly one (the highest-points season) as a documented
 * simplification, rather than a second "highest volume" season, to keep
 * clue keys stable and enumerable (a second season would either collide on
 * clue_key or require dynamic per-season keys, both undesirable for the
 * eventual signal_scout_round_clues unique(round_id, clue_key) constraint).
 * "Last season" (the last_season_points_range headline clue) is tracked
 * separately via StatsBundle.lastSeason and may be a different season.
 */
export function generateClueCandidates(facts: ClueFacts): GeneratedClue[] {
  const out: GeneratedClue[] = [];

  // --- Bio -----------------------------------------------------------------
  const ageYears = computeAgeYears(facts.birthDate);
  if (ageYears !== null) emit(out, "age_range", ageRangeDisplay(ageYears));

  const exactAgeStr = formatAge(facts.birthDate);
  if (exactAgeStr !== null) emit(out, "exact_age", `${exactAgeStr} years old`);

  if (facts.yearsExperience !== null) {
    emit(out, "experience_range", experienceRangeDisplay(facts.yearsExperience));
    emit(out, "exact_experience", exactExperienceDisplay(facts.yearsExperience));
  }

  if (facts.heightInches !== null) emit(out, "height", heightDisplay(facts.heightInches));
  if (facts.weightLbs !== null) emit(out, "weight", weightDisplay(facts.weightLbs));
  if (facts.college) emit(out, "college", facts.college);
  if (facts.highSchool) emit(out, "high_school", facts.highSchool);
  if (facts.jerseyNumber) emit(out, "jersey_number", `Number ${facts.jerseyNumber}`);

  const initial = facts.lastName.trim().charAt(0).toUpperCase();
  if (initial) emit(out, "last_name_initial", `Last name starts with ${initial}`);

  // --- Team and position (all gate on team non-null per plan section 10) ---
  if (facts.team !== null) {
    if (facts.conference) emit(out, "conference", facts.conference);
    if (facts.division) emit(out, "division", facts.division);
    // Skip branch of plan section 10's "offensive skill player or skip" for
    // QB targets: a constant string true of every pool player is
    // information-free, and a QB-distinct string would itself be a meta-leak
    // (its presence would announce "not QB"). RB/WR/TE targets get a real,
    // if low-specificity, fact instead. See the CLUE_DEFINITIONS entry above.
    if (facts.position.toUpperCase() !== "QB") {
      emit(out, "position_group", "Not a quarterback");
    }
    emit(out, "exact_position", exactPositionDisplay(facts.position));
    emit(out, "current_team", facts.teamName ?? facts.team);
  }

  // --- Stats -----------------------------------------------------------------
  const bundle = facts.stats;
  if (bundle.hasData) {
    if (bundle.lastSeason && bundle.lastSeason.games > 0) {
      emit(out, "last_season_points_range", pointsRangeDisplay(bundle.lastSeason.line.pts_ppr));
    }

    const namedSeasonNumber = bundle.careerHighs.points?.season ?? null;
    const namedSeason =
      namedSeasonNumber !== null ? (bundle.seasons.find((s) => s.season === namedSeasonNumber) ?? null) : null;

    if (namedSeason && namedSeason.games > 0) {
      const ppg = bundle.pointsPerGame[namedSeason.season] ?? null;
      if (ppg !== null) {
        emit(
          out,
          "season_points_exact",
          `${namedSeason.line.pts_ppr.toFixed(1)} PPR points (${ppg.toFixed(1)} per game) in ${namedSeason.season}`,
        );
      }
      emit(out, "season_games_played", `${namedSeason.games} games played in ${namedSeason.season}`);

      const totalYards = namedSeason.line.pass_yd + namedSeason.line.rush_yd + namedSeason.line.rec_yd;
      emit(out, "season_total_yards_range", `${totalYardsRangeDisplay(totalYards)} in ${namedSeason.season}`);

      const positionUpper = facts.position.toUpperCase();
      for (const statClue of SEASON_STAT_CLUES) {
        if (!statClue.positions.includes(positionUpper)) continue;
        const value = statClue.extract(namedSeason.line);
        emit(out, statClue.key, `${Math.round(value)} ${statClue.unit} in ${namedSeason.season}`);
      }

      const statLine = seasonStatLine(facts.position, namedSeason.season, namedSeason.line);
      if (statLine !== null) emit(out, "season_stat_line", statLine);

      const finishForNamedSeason = bundle.finishes.seasons.find((f) => f.season === namedSeason.season) ?? null;
      if (finishForNamedSeason) {
        emit(
          out,
          "positional_finish",
          `Finished ${facts.position.toUpperCase()}${finishForNamedSeason.finish} in ${namedSeason.season}`,
        );
      }
    }

    if (bundle.careerHighs.points) {
      emit(
        out,
        "career_high_points",
        `Best season since 2020: ${bundle.careerHighs.points.value.toFixed(1)} PPR points in ${bundle.careerHighs.points.season}`,
      );
    }
    if (bundle.careerHighs.totalYards) {
      emit(
        out,
        "career_high_yards",
        `Best season since 2020: ${Math.round(bundle.careerHighs.totalYards.value)} total yards in ${bundle.careerHighs.totalYards.season}`,
      );
    }
    if (bundle.finishes.bestFinish) {
      emit(
        out,
        "best_positional_finish",
        `Best finish since 2020: ${facts.position.toUpperCase()}${bundle.finishes.bestFinish.finish} in ${bundle.finishes.bestFinish.season}`,
      );
    }
  }

  // --- Value and market --------------------------------------------------
  if (facts.value) {
    emit(out, "value_range", valueRangeDisplay(facts.value.value));
    if (facts.value.overallRank !== null) {
      emit(out, "overall_rank_range", rankRangeDisplay(facts.value.overallRank));
    }
    if (facts.value.movement30dPct !== null && facts.value.dataPoints30d >= 7) {
      emit(out, "value_movement_30d", movementDisplay(facts.value.movement30dPct));
    }
  }
  if (facts.adp) {
    emit(out, "sleeper_adp_range", adpRangeDisplay(facts.adp.value));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Disabled keys and coverage
// ---------------------------------------------------------------------------

/** Filter out admin-disabled clue keys. Apply before both coverage and starter selection. */
export function applyDisabledKeys(candidates: GeneratedClue[], disabledKeys: string[]): GeneratedClue[] {
  if (disabledKeys.length === 0) return candidates;
  const disabled = new Set(disabledKeys);
  return candidates.filter((c) => !disabled.has(c.clueKey));
}

/**
 * Coverage counts for eligibility.ts's clue_coverage check. Computed BEFORE
 * starter selection (starterCandidates counts every starter-eligible
 * candidate present, not just the ones that would ultimately be chosen).
 * Callers that want post-disabled-key coverage should call this after
 * applyDisabledKeys; callers that want raw coverage call it directly.
 */
export function computeClueCoverage(candidates: GeneratedClue[]): ClueCoverageInput {
  const generatableByTier: Record<SignalTier, number> = { weak: 0, clear: 0, ping: 0, scan: 0 };
  let starterCandidates = 0;
  for (const c of candidates) {
    generatableByTier[c.tier] += 1;
    if (DEF_BY_KEY.get(c.clueKey)?.starterEligible) starterCandidates += 1;
  }
  return { starterCandidates, generatableByTier };
}

// ---------------------------------------------------------------------------
// Starter selection
// ---------------------------------------------------------------------------

/**
 * Total specificity budget for the starter set (plan section 12). Chosen so
 * the single highest-specificity starter-eligible bio clue (weight, 3) can
 * combine with one team clue (conference or position_group, 1) and one
 * stat-or-value clue (last_season_points_range or value_range, 2) for
 * exactly 6, the richest allowed 3-clue starter opener, while still
 * rejecting combinations that stack multiple mid-specificity clues past a
 * sensible "openers should stay guessable" ceiling.
 */
export const STARTER_SPECIFICITY_BUDGET = 6;

/** At least one selected starter must clear this so openers are never all-1s. */
const STARTER_MIN_SPECIFICITY_FLOOR = 2;

const STARTER_CATEGORIES: ClueCategory[] = ["bio", "team", "stat", "value"];

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

function cartesianProduct<T>(groups: T[][]): T[][] {
  return groups.reduce<T[][]>((acc, group) => acc.flatMap((prefix) => group.map((item) => [...prefix, item])), [
    [],
  ]);
}

function isValidStarterCombo(combo: GeneratedClue[]): boolean {
  const keys = new Set(combo.map((c) => c.clueKey));
  // Redundant with the one-per-category cap (conference and position_group
  // are the only starter-eligible "team" clues), kept explicit per plan
  // section 12's literal wording and as a guard against future additions to
  // the team category that would not otherwise be mutually exclusive.
  if (keys.has("conference") && keys.has("position_group")) return false;
  // exact_age is never starterEligible (tier clear), so this is unreachable
  // today; kept explicit per the plan's literal instruction and as a guard
  // if exact_age's tier is ever revisited.
  if (keys.has("exact_age") && keys.has("age_range")) return false;
  const totalSpecificity = combo.reduce((sum, c) => sum + c.specificity, 0);
  return totalSpecificity <= STARTER_SPECIFICITY_BUDGET;
}

/**
 * Select the free starter clues for a round (plan section 12): at most one
 * per category (bio/team/stat/value, a strict superset of the plan's named
 * bio/stat/value cap that also naturally enforces "conference and
 * position_group never appear together" since team has only those two
 * starter-eligible candidates), within the specificity budget, with a floor
 * requiring at least one specificity >= 2 clue whenever that is possible.
 *
 * Deterministic given rng: the same candidates, settings, and rng call
 * sequence always produce the same result. If fewer than starter_clue_count
 * categories have a valid candidate, returns the largest valid subset found
 * (documented as acceptable in the design contract; rare given eligibility's
 * 3-starter-candidate minimum).
 */
export function selectStarterClues(
  candidates: GeneratedClue[],
  settings: ClueSettings,
  rng: () => number = Math.random,
): GeneratedClue[] {
  const starterPool = candidates.filter((c) => DEF_BY_KEY.get(c.clueKey)?.starterEligible);

  const byCategory = new Map<ClueCategory, GeneratedClue[]>();
  for (const c of starterPool) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }
  const availableCategories = STARTER_CATEGORIES.filter((cat) => (byCategory.get(cat)?.length ?? 0) > 0);

  const maxTarget = Math.min(settings.starter_clue_count, availableCategories.length);
  for (let targetCount = maxTarget; targetCount >= 1; targetCount--) {
    const categorySubsets = combinations(availableCategories, targetCount);
    const validCombos: GeneratedClue[][] = [];
    for (const catSet of categorySubsets) {
      const perCategoryOptions = catSet.map((cat) => byCategory.get(cat)!);
      for (const combo of cartesianProduct(perCategoryOptions)) {
        if (isValidStarterCombo(combo)) validCombos.push(combo);
      }
    }
    if (validCombos.length === 0) continue;

    const withFloor = validCombos.filter((combo) => combo.some((c) => c.specificity >= STARTER_MIN_SPECIFICITY_FLOOR));
    const pool = withFloor.length > 0 ? withFloor : validCombos;
    const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    return pool[idx];
  }
  return [];
}

// ---------------------------------------------------------------------------
// assembleClueFacts loader
// ---------------------------------------------------------------------------

/**
 * Fixed value combo (plan section 14, a documented exception to the global
 * source/format sync rule: a shared game must present identical clues for
 * everyone). ffbeacon first, per-player fallback to ktc.
 */
const VALUE_FORMAT_SLUG = "dynasty-ppr-sflex";

/**
 * ADP map key on player_market_snapshots.adp for the fixed dynasty-ppr-sflex
 * combo: dynasty (isDynasty) + superflex (isSuperflex) maps to "dynasty_2qb"
 * under lib/on-the-clock/adp.ts's own key convention (parseFormatShape +
 * adpFormatKeyCandidates). Signal Scout always uses this one fixed format, so
 * the key is a constant here rather than re-deriving it through that
 * helper's PlayerPool-aware candidate list.
 */
const ADP_FORMAT_KEY = "dynasty_2qb";

const MARKET_ADP_SOURCE = "sleeper";

export type ClueFactsPlayer = {
  id: string;
  position: string;
  /**
   * Not in the original loader signature draft; added because
   * last_name_initial needs it and players.last_name is a real, always
   * non-null column (lib/database.types.ts players.last_name: string).
   */
  last_name: string;
  birth_date: string | null;
  years_experience: number | null;
  height_inches: number | null;
  weight_lbs: number | null;
  college?: string | null;
  team?: string | null;
  metadata?: unknown;
};

function readString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Mirrors lib/player-profile.ts sleeperMeta(): the raw Sleeper object persisted under metadata.sleeper. */
function extractSleeperMeta(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object") {
    const m = metadata as { sleeper?: unknown };
    if (m.sleeper && typeof m.sleeper === "object") return m.sleeper as Record<string, unknown>;
  }
  return {};
}

type TeamFacts = { teamName: string | null; conference: string | null; division: string | null };

/** Mirrors lib/player-profile.ts loadTeamRow()'s abbreviation lookup pattern. */
async function loadTeamFacts(supabase: Client, team: string | null): Promise<TeamFacts> {
  if (!team) return { teamName: null, conference: null, division: null };
  try {
    const { data, error } = await supabase
      .from("nfl_teams")
      .select("name, conference, division")
      .eq("abbreviation", team)
      .maybeSingle();
    if (error) {
      console.error("[signal-scout] nfl_teams lookup failed", error);
      return { teamName: null, conference: null, division: null };
    }
    if (!data) return { teamName: null, conference: null, division: null };
    return { teamName: data.name, conference: data.conference, division: data.division };
  } catch (err) {
    console.error("[signal-scout] nfl_teams lookup threw", err);
    return { teamName: null, conference: null, division: null };
  }
}

async function loadValueFacts(supabase: Client, playerId: string): Promise<ClueValueFacts | null> {
  try {
    const { data: formatRow, error: formatError } = await supabase
      .from("format_configs")
      .select("id")
      .eq("slug", VALUE_FORMAT_SLUG)
      .maybeSingle();
    if (formatError) {
      console.error("[signal-scout] format_configs lookup failed", formatError);
      return null;
    }
    if (!formatRow) {
      console.error(`[signal-scout] format_configs has no row for slug "${VALUE_FORMAT_SLUG}"`);
      return null;
    }
    const formatConfigId = formatRow.id;

    const fetchValue = (source: "ffbeacon" | "ktc") =>
      supabase
        .from("player_value_trends")
        .select("current_value, change_30d_pct, data_points_30d")
        .eq("player_id", playerId)
        .eq("format_config_id", formatConfigId)
        .eq("source", source)
        .maybeSingle();

    let sourceUsed: "ffbeacon" | "ktc" = "ffbeacon";
    const primary = await fetchValue("ffbeacon");
    if (primary.error) console.error("[signal-scout] player_value_trends lookup failed", primary.error);
    let valueRow = primary.data;

    if (!valueRow) {
      sourceUsed = "ktc";
      const fallback = await fetchValue("ktc");
      if (fallback.error) console.error("[signal-scout] player_value_trends ktc fallback failed", fallback.error);
      valueRow = fallback.data;
    }
    if (!valueRow) return null;

    const { data: rankRow, error: rankError } = await supabase
      .from("rankings")
      .select("overall_rank")
      .eq("player_id", playerId)
      .eq("format_config_id", formatConfigId)
      .eq("source", sourceUsed)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rankError) console.error("[signal-scout] rankings lookup failed", rankError);

    return {
      value: valueRow.current_value,
      overallRank: rankRow?.overall_rank ?? null,
      movement30dPct: valueRow.change_30d_pct,
      dataPoints30d: valueRow.data_points_30d,
      sourceUsed,
    };
  } catch (err) {
    console.error("[signal-scout] value facts lookup threw", err);
    return null;
  }
}

async function loadAdpFacts(supabase: Client, playerId: string): Promise<ClueAdpFacts | null> {
  try {
    const { data, error } = await supabase
      .from("player_market_snapshots")
      .select("adp")
      .eq("player_id", playerId)
      .eq("source", MARKET_ADP_SOURCE)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[signal-scout] player_market_snapshots lookup failed", error);
      return null;
    }
    if (!data?.adp) return null;
    const map = data.adp as Record<string, unknown>;
    const raw = map[ADP_FORMAT_KEY];
    const num = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
    if (!Number.isFinite(num) || num <= 0) return null;
    return { value: num };
  } catch (err) {
    console.error("[signal-scout] adp facts lookup threw", err);
    return null;
  }
}

/**
 * Assemble the full ClueFacts input for one player at round-generation time.
 * Every section (team, value, ADP) degrades to null on its own query failure
 * rather than throwing, so one missing dataset never blocks round start; each
 * failure is logged via console.error per the [signal-scout] convention.
 */
export async function assembleClueFacts(
  supabase: Client,
  player: ClueFactsPlayer,
  statsBundle: StatsBundle,
): Promise<ClueFacts> {
  const sleeperMeta = extractSleeperMeta(player.metadata);
  const highSchool = readString(sleeperMeta.high_school);
  const jerseyNumber = readString(sleeperMeta.number);

  const team = player.team ?? null;
  const [teamFacts, value, adp] = await Promise.all([
    loadTeamFacts(supabase, team),
    loadValueFacts(supabase, player.id),
    loadAdpFacts(supabase, player.id),
  ]);

  return {
    position: player.position,
    lastName: player.last_name,
    birthDate: player.birth_date,
    yearsExperience: player.years_experience,
    heightInches: player.height_inches,
    weightLbs: player.weight_lbs,
    college: player.college ?? null,
    highSchool,
    jerseyNumber,
    team,
    teamName: teamFacts.teamName,
    conference: teamFacts.conference,
    division: teamFacts.division,
    stats: statsBundle,
    value,
    adp,
  };
}
