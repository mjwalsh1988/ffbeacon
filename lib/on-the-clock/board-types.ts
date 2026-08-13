/**
 * Shared board types for On The Clock.
 *
 * These live in lib (not in the app/ fixtures) so the SERVER ranked-board loader
 * and the CLIENT cockpit share one definition. fixtures.ts re-exports them, so
 * existing component imports from "./fixtures" are unchanged.
 *
 * Nothing here computes values. The board CONSUMES the same rankings /
 * player_value_history / player_value_trends rows the Rankings Board reads.
 */

/** The six draftable position buckets On The Clock renders. */
export type DraftPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/**
 * One FF Beacon draft-pick value, keyed by season + round + bucket. These are the
 * real published FF Beacon pick values (source='ffbeacon' in draft_pick_values),
 * loaded alongside the board so the Trade Analyzer and Trade History can value
 * future-year picks directly instead of projecting a player and discounting.
 */
export interface PickBucketValue {
  season: number;
  round: number;
  bucket: "early" | "mid" | "late";
  value: number;
}

/** One ranked, draftable player for the available board. */
export interface RankedPlayer {
  playerId: string;
  sleeperId: string | null;
  name: string;
  position: DraftPosition;
  team: string | null;
  overallRank: number;
  positionRank: number;
  tier: number;
  value: number;
  isRookie: boolean;
  /**
   * Sleeper ADP (overall pick number) for the board's resolved ADP market key,
   * from the latest (live) or historically resolved (snapshot) market snapshot.
   * Null/absent when the market has no data for this player.
   */
  adp?: number | null;
  // ---- Enrichment, populated by the loader when available; UI hides absent ----
  yearsExperience?: number;
  age?: number;
  /** Exact age carried to one decimal, for display only (e.g. 23.4). Absent
   * when there is no usable birth date. */
  ageDecimal?: number;
  /** Last few positional finishes, newest first (not wired from data yet). */
  recentFinishes?: string[];
  /** One short scouting line (not wired from data yet). */
  shortNote?: string;
  // ---- Projection enrichment (optional; supplied by the pulse route) ----
  /** Projected points per remaining week in the LEAGUE'S own scoring. */
  projPointsPerWeek?: number | null;
  /** Projected points across the remaining slate. */
  projSeasonPoints?: number | null;
  /** How often this player has met or beaten their projection, 0 to 1. */
  beatRate?: number | null;
  /** Weeks played over weeks projected, 0 to 1. */
  availability?: number | null;
  /** Weeks of history behind beatRate/availability, for the sample gates. */
  accuracyWeeks?: number | null;
  // ---- Beacon Steals (optional; from draft_value_targets, loaded per format) ----
  /**
   * Where FF Beacon would draft this player, as a pick number on the market's
   * own scale. This is NOT overall_rank: a cross-position value rank compared to
   * a scarcity-priced ADP flags every quarterback in a single-QB format. See
   * lib/draft-value/engine.ts for the measurement behind that.
   */
  beaconPick?: number | null;
  /** 0 to 100, 50 being neutral. Above 50 the market is late on him. */
  stealScore?: number | null;
  /** steal | swing | fade | fair. */
  stealCategory?: string | null;
  /** The plain-English verdict, already written by the nightly build. */
  stealVerdict?: string | null;
  /** 0 to 1. Gates whether the room is willing to call this a steal out loud. */
  stealConfidence?: number | null;
  // ---- 7-day movement (optional; carried for future UI, not rendered yet) ----
  change7d?: number | null;
  change7dPct?: number | null;
  trend7d?: string | null;
  show7d?: boolean;
}

/** Recommendation card payload (Best Available now; Team Need engine is Phase 6B). */
export interface RecommendationCardData {
  kind: "best" | "need";
  player: RankedPlayer | null;
  reason: string;
  decidingFactor: "value" | "need" | "reach" | "none";
  filledSlot: string | null;
  /**
   * Card heading when the build mode changes what the card means, e.g. "Best
   * value for a contender". Absent falls back to the component's default.
   */
  title?: string;
  /**
   * Short supporting facts, each already phrased for display and for a screen
   * reader ("Adds 6.2 points a week to your starters"). Empty when the engine
   * had no numbers to show.
   */
  metrics?: string[];
  /**
   * Which engine produced this card. "points" means the marginal
   * starting-lineup model ran; "heuristic" means projections were unavailable
   * and the slot-fill model answered instead. Surfaced so the room can say so.
   */
  engine?: "points" | "heuristic";
}

/**
 * Outcome of a board load.
 *  - ok: players loaded.
 *  - no-rankings: the forced FF Beacon source has no ranking rows for the format.
 *  - source-unavailable: the FF Beacon source row is missing from source_registry
 *    (a config/admin problem; the UI shows a dev/admin-facing message).
 *  - error: unexpected failure / unknown format.
 */
export type BoardStatus = "ok" | "no-rankings" | "source-unavailable" | "error";

export interface BoardResult {
  status: BoardStatus;
  players: RankedPlayer[];
  /** Format slug the board was loaded for. */
  formatSlug: string;
  formatLabel: string;
  /** Always the FF Beacon source slug for On The Clock (forced; no selector). */
  sourceSlug: string | null;
  sourceLabel: string;
  /** Same as sourceSlug (FF Beacon backs both rankings and values for OTC). */
  valueSourceSlug: string | null;
  /**
   * Whether the FF Beacon source row is is_active. OTC reads FF Beacon data
   * regardless (like Signal Check); false drives an admin "not publicly active
   * yet" note, NOT a hard block.
   */
  sourceActive: boolean;
  /**
   * The board season: the latest published ranking-season partition for this
   * (format, source). This is a LABEL only. Rankings are regenerated daily and
   * values come from the latest player_value_history rows, so it is NOT a
   * staleness signal and must NOT be surfaced as "{year} values" in the UI. It
   * matches the production Rankings Board, which reads a single fixed board season
   * rather than the calendar/NFL season. Empty string when no board exists.
   */
  season: string;
  /**
   * FF Beacon draft-pick values for this format (source='ffbeacon'), latest
   * snapshot per (season, round, bucket). Empty when the format has no FF Beacon
   * pick rows (e.g. redraft formats, which publish no future picks). The Trade
   * Analyzer reads these directly for future-year pick buckets.
   */
  pickValues: PickBucketValue[];
  /**
   * The Sleeper ADP market key the board's `adp` values came from (e.g.
   * "dynasty_2qb"), or null when no ADP snapshot exists yet.
   */
  adpFormatKey?: string | null;
  /** The snapshot_date (YYYY-MM-DD) the ADP values came from, or null. */
  adpSnapshotDate?: string | null;
}
