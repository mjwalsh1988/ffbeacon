/**
 * Types for the On The Clock live-draft helper.
 *
 * Two concerns live here:
 *  1. The admin-editable settings document (mirrors the FAAB settings pattern:
 *     code holds the fallback defaults in default-settings.ts; the admin page
 *     persists overrides to the single-row on_the_clock_settings table).
 *  2. The shaped cache payloads the read path returns to the client (whitelisted
 *     fields only; see cache.ts).
 *
 * Nothing here computes or writes player values. On The Clock CONSUMES the same
 * rankings / value rows the Rankings Board reads; it never changes them.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Which players the room shows. A rookie draft defaults to "rookies". */
export type PlayerPool = "everyone" | "rookies";

/** Team-Need aggressiveness preset. Drives the default need weight. */
export type TeamNeedAggressiveness = "conservative" | "balanced" | "aggressive";

/**
 * How Team-Need treats DST/K. They are ALWAYS present in the room; this only
 * controls whether they can be RECOMMENDED.
 *  - suppress_until_need: only when a late-round roster-need gate passes (default)
 *  - never: never recommend a DST/K under Team-Need
 *  - always_allowed: eligible like any other position (not recommended default)
 */
export type DstkRecommendBehavior =
  | "suppress_until_need"
  | "never"
  | "always_allowed";

export interface FeatureSettings {
  /** Master on/off for the public tool. Ships OFF (see default-settings.ts). */
  enabled: boolean;
}

export interface SourceFormatSettings {
  /**
   * Default ranking source slug. null = use the source_registry default
   * (resolveSourceForFormat). The user can still override per session.
   */
  defaultRankingSource: string | null;
  /**
   * Format slug to fall back to when a league's scoring cannot be matched to a
   * supported format. Must be an active format_configs.slug.
   */
  defaultFormatFallback: string;
}

export interface PoolSettings {
  /** Pools offered in the UI toggle. */
  enabledPools: PlayerPool[];
  /**
   * Fallback default pool when the draft type does not imply one. A detected
   * rookie draft still defaults to "rookies" regardless of this.
   */
  defaultPool: PlayerPool;
}

export interface SyncSettings {
  /** Server-enforced per-draft cooldown between Sleeper syncs. */
  cooldownSeconds: number;
  /** Short in-progress lock that blocks two concurrent syncs of one draft. */
  lockSeconds: number;
  /** Whether the client subscribes to Supabase Realtime for co-viewer picks. */
  realtimeEnabled: boolean;
}

export interface CacheSettings {
  /** Non-complete drafts older than this (by last activity) are prunable. */
  activeTtlHours: number;
  /** Completed drafts older than this are prunable. */
  completedRetentionHours: number;
}

export interface LimitSettings {
  /** Max active-draft leagues returned per user from the lookup route. */
  maxActiveLeagues: number;
  /** Max available players rendered before the "Show more" control. */
  maxAvailablePlayers: number;
}

/** The three canonical blended-score weights. All components are 0-100. */
export interface RecommendationWeights {
  value: number;
  need: number;
  reach: number;
}

export interface RecommendationSettings {
  /** Master toggle for the Team-Need card (Best Available always renders). */
  teamNeedEnabled: boolean;
  /** Preset that seeds the weights in the admin UI. */
  aggressiveness: TeamNeedAggressiveness;
  /** Live weights consumed by the recommend engine (Phase 6). */
  weights: RecommendationWeights;
  /**
   * Tier-break threshold for the positional reach gate: reach is only penalized
   * once a player sits more than this many tiers below the best same-position
   * available option. Prevents reach from vetoing a legitimate need pick.
   */
  maxReachTierBreak: number;
}

export interface DstkSettings {
  /** DST/K present in board / lists / picks / My Draft. Default on. */
  includedInRoom: boolean;
  /** Whether/when DST/K can be a Team-Need recommendation. */
  recommendBehavior: DstkRecommendBehavior;
  /** Only recommend a DST/K if the league's starting lineup requires the slot. */
  requireStartingSlot: boolean;
  /** Earliest round a DST may be recommended (roster-need gate). */
  minRoundForDst: number;
  /** Earliest round a K may be recommended (roster-need gate). */
  minRoundForK: number;
}

export interface PositionAdjustSettings {
  /** Multiplier raising QB need in superflex leagues (open SF slot). */
  superflexQbMultiplier: number;
  /** Multiplier raising TE need when the league is TE-premium. */
  tePremiumMultiplier: number;
}

/**
 * Fallback starting-slot counts per position, used only when a league's
 * roster_positions is missing or unmatched. Keys are FF Beacon slot names.
 */
export interface PositionFallbackTargets {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SUPER_FLEX: number;
  K: number;
  DEF: number;
}

export interface MappingVisibilitySettings {
  /** Show the admin panel listing recent unmapped Sleeper ids per draft. */
  showUnmappedPanel: boolean;
}

export interface OnTheClockSettings {
  feature: FeatureSettings;
  sourceFormat: SourceFormatSettings;
  pools: PoolSettings;
  sync: SyncSettings;
  cache: CacheSettings;
  limits: LimitSettings;
  recommendation: RecommendationSettings;
  dstk: DstkSettings;
  positionAdjust: PositionAdjustSettings;
  positionFallbackTargets: PositionFallbackTargets;
  mappingVisibility: MappingVisibilitySettings;
}

// ---------------------------------------------------------------------------
// Shaped cache payloads (read path, whitelisted fields)
// ---------------------------------------------------------------------------

/** One Sleeper league user, reduced to display fields the room needs. */
export interface ShapedLeagueUser {
  userId: string;
  displayName: string | null;
  avatar: string | null;
}

/** One roster as cached, reduced for team detection + dynasty seeding. */
export interface ShapedRoster {
  rosterId: number;
  ownerId: string | null;
  coOwners: string[];
  players: string[];
}

/** One draft pick, whitelisted for the wire. */
export interface ShapedPick {
  pickNo: number;
  round: number | null;
  draftSlot: number | null;
  rosterId: number | null;
  pickedBy: string | null;
  sleeperPlayerId: string | null;
  /** Resolved FF Beacon player id, or null if unmapped. */
  playerId: string | null;
  isKeeper: boolean;
  /** Raw cached fields so an unmapped pick still renders (no value chip). */
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  team: string | null;
}

/**
 * One active-draft league card returned by the leagues lookup route. Carries
 * draftId + leagueId + season so the client can drive the sync route without an
 * extra pre-fetch (the sync claim needs league_id + season).
 */
export interface LeagueCard {
  leagueId: string;
  draftId: string;
  season: string;
  name: string;
  totalRosters: number;
  avatar: string | null;
  /** Mapped from the Sleeper league status: "drafting" | "pre_draft". */
  draftStatus: string;
  /**
   * FF Beacon format auto-detected from the league's Sleeper scoring/roster
   * settings (On The Clock derives the format from the league, never the global
   * toggle). null when no FF Beacon format matches the league type.
   */
  formatSlug: string | null;
  /** Display name of the detected/closest FF Beacon format. */
  formatLabel: string | null;
  /** Plain-language description of the league's actual format (e.g. "Dynasty PPR Superflex"). */
  formatDerivedLabel: string | null;
  /** True when the exact format is not carried and a closest FF Beacon format was used. */
  formatIsClosest: boolean;
}

/** The draft header + lock/sync state, whitelisted for the wire. */
export interface ShapedDraftMeta {
  sleeperDraftId: string;
  sleeperLeagueId: string;
  season: string;
  draftStatus: string | null;
  draftType: string | null;
  pickCount: number;
  /** slot -> roster_id, lifted from the raw Sleeper draft object. */
  slotToRosterId: Record<string, number>;
  /** Sleeper draft settings (teams / rounds / reversal_round, etc). */
  settings: Record<string, number>;
  lastSyncedAt: string | null;
}

/**
 * One traded draft pick, shaped from the cached Sleeper /traded_picks payload.
 * Keys stay snake_case to match Sleeper and the pick-ownership normalizer. season
 * may be a string or number as Sleeper sends it.
 */
export interface ShapedTradedPick {
  season: number | string;
  round: number;
  /** The roster whose pick this originally was. */
  roster_id: number;
  /** The roster that currently owns the pick after all trades. */
  owner_id: number;
  previous_owner_id: number | null;
}

/** The full shaped cache payload the read route returns. */
export interface ShapedDraftCache {
  draft: ShapedDraftMeta;
  users: ShapedLeagueUser[];
  rosters: ShapedRoster[];
  picks: ShapedPick[];
  /** Traded draft picks (current + future seasons) for pick-ownership resolution. */
  tradedPicks: ShapedTradedPick[];
}

/** Status union the sync flow reports back. */
export type SyncStatus = "synced" | "served-cache" | "cooldown" | "synced-by-other" | "error";

/** Result of a sync attempt: always carries the current shaped cache when available. */
export interface SyncOutcome {
  status: SyncStatus;
  cooldownRemainingSeconds: number;
  lastSyncedAt: string | null;
  cache: ShapedDraftCache | null;
  /** Sanitized, user-safe message on the error path. */
  error?: string;
}
