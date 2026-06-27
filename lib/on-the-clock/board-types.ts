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
  // ---- Enrichment, populated by the loader when available; UI hides absent ----
  yearsExperience?: number;
  age?: number;
  /** Last few positional finishes, newest first (not wired from data yet). */
  recentFinishes?: string[];
  /** One short scouting line (not wired from data yet). */
  shortNote?: string;
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
}
