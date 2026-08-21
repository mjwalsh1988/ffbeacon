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

import type { KeeperStyle } from "@/lib/sleeper-to-format";

export type { KeeperStyle };

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
  /** Server-enforced per-draft cooldown between MANUAL Sleeper syncs. */
  cooldownSeconds: number;
  /** Short in-progress lock that blocks two concurrent syncs of one draft. */
  lockSeconds: number;
  /** Whether the client subscribes to Supabase Realtime for co-viewer picks. */
  realtimeEnabled: boolean;
  /** Whether an open room refreshes itself without anyone pressing Sync. */
  autoRefreshEnabled: boolean;
  /**
   * The room's unattended refresh interval, shared per draft the same way the
   * manual cooldown is. Never shorter than cooldownSeconds: a shorter window
   * would be denied by the manual claim anyway and would only add traffic.
   */
  autoRefreshSeconds: number;
}

export interface CacheSettings {
  /**
   * How long a cached projection sweep is kept after it was computed.
   *
   * The only On The Clock cache with a retention window, because it is the only
   * one that is not a record of something that happened. Drafts and their picks
   * are kept permanently: they are what this tool observed, a completed draft can
   * still be opened and snapshotted later, and no resync can restore the moment we
   * watched a pick land.
   */
  projectionRetentionHours: number;
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
  /**
   * DST/K present in board / lists / picks / My Draft.
   *
   * ALWAYS TRUE, and nothing reads it. Hiding a position from the board would
   * mean hiding it from the draft board, the pick list, every roster, and the
   * trade builder, all of which read a Sleeper draft that contains those picks
   * whatever we think of them: the room would then disagree with Sleeper. What
   * an admin actually wants is control over RECOMMENDING them, which is what
   * the three settings below do, and they are the ones the admin panel exposes.
   * Kept in the shape so a stored settings row does not fail validation.
   */
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

export interface ValueIndicatorSettings {
  /**
   * Neutral band (in picks) for the ADP value indicators: a made pick is only
   * flagged good value / reach when |pick_no - ADP| reaches this many picks.
   * Keeps ordinary draft-order noise from being called good or bad.
   */
  thresholdPicks: number;
}

export interface MappingVisibilitySettings {
  /** Show the admin panel listing recent unmapped Sleeper ids per draft. */
  showUnmappedPanel: boolean;
}

/**
 * How the drafter wants this team built. Only offered in a dynasty STARTUP,
 * where the choice is real: a redraft team is always competing, and a rookie
 * draft sits on top of a team whose direction is already set.
 */
export type BuildMode = "compete" | "balanced" | "rebuild";

export interface BuildModeSettings {
  /** Master toggle for offering the selector at all. */
  enabled: boolean;
  /** Starting mode in a dynasty startup before the drafter chooses. */
  defaultMode: BuildMode;
  /**
   * Weight on this season's points when the starting lineup is EMPTY. Almost
   * everything, because every early pick is a starter.
   */
  pointsWeightEmpty: number;
  /**
   * Weight on points when the starting lineup is FULL. Much lower, because the
   * next pick is a bench player who starts only on a bye or an injury, and
   * ranking bench players by points added to a lineup they cannot crack
   * produces a wall of zeroes and no advice at all.
   */
  pointsWeightFull: number;
  /** Multiplier on both weights in compete mode. Above 1 leans win-now harder. */
  competePointsBoost: number;
  /** Ceiling on the points weight in rebuild mode, so the long game stays in charge. */
  rebuildPointsCap: number;
  /** Credit for youth in rebuild scoring (0 to 1 of a rescaled age score). */
  youthWeight: number;
  /** Credit for a projection that outruns the market price, in rebuild scoring. */
  upsideWeight: number;
  /** How hard Best Value tilts toward this season's points in compete mode. */
  competeValueTilt: number;
  /** How hard Best Value tilts toward youth and upside in rebuild mode. */
  rebuildValueTilt: number;
}

/** Weights for the marginal starting-lineup engine (lib/on-the-clock/marginal.ts). */
export interface MarginalValueSettings {
  /** Credit for what a player is worth if the starter ahead of him misses time. */
  insuranceWeight: number;
  /** Credit for the cost of waiting until your next pick. */
  dropoffWeight: number;
  /** Floor on assumed starter injury risk, so a healthy starter still leaves credit. */
  minStarterRisk: number;
  /** How many available players get priced per request. */
  maxCandidates: number;
}

export interface AwardsSettings {
  /** Per-award on/off, keyed by award id. A missing key means enabled. */
  enabled: Record<string, boolean>;
  /** Minimum completed trades to qualify for the trade-quality award. */
  minSuccessfulTraderTrades: number;
  /** Minimum ADP-known picks before a drafting award can be earned. */
  minAdpPicks: number;
  /** Minimum weeks of projection history before a reliability award can be earned. */
  minAccuracyWeeks: number;
  /** Minimum drafted players before the lineup-shaped awards can be earned. */
  minPlayersForLineupAwards: number;
}

export interface GradeSettings {
  enabled: boolean;
  /** Component weights. Normalized at use, so they need not sum to 1. */
  weights: {
    market: number;
    lineup: number;
    construction: number;
    reliability: number;
    future: number;
    trades: number;
  };
  /**
   * How much of the final grade is absolute rather than curved within the
   * league. 0 is a pure curve, which guarantees somebody gets an F even in a
   * strong room; 1 ignores the league entirely. The default leans on the curve
   * because every startup drains the same player pool.
   */
  absoluteBlend: number;
}

export interface DraftAlertSettings {
  /** How many recent picks a positional run looks at. */
  runWindow: number;
  /** How many of those must share a position before it counts as a run. */
  runThreshold: number;
  /** Warn about a tier when this many or fewer players remain in it. */
  tierCliffRemaining: number;
  /** Cap on the "gone before your next pick" list. */
  maxGoneBefore: number;
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
  valueIndicators: ValueIndicatorSettings;
  mappingVisibility: MappingVisibilitySettings;
  buildMode: BuildModeSettings;
  marginal: MarginalValueSettings;
  awards: AwardsSettings;
  grades: GradeSettings;
  alerts: DraftAlertSettings;
}

// ---------------------------------------------------------------------------
// Shaped cache payloads (read path, whitelisted fields)
// ---------------------------------------------------------------------------

/** One Sleeper league user, reduced to display fields the room needs. */
export interface ShapedLeagueUser {
  userId: string;
  displayName: string | null;
  /** Sleeper handle (the @username). May equal displayName. */
  username: string | null;
  /** Custom team name (metadata.team_name) when the owner set one, else null. */
  teamName: string | null;
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
  /** The raw Sleeper league status ("drafting", "pre_draft", "in_season", ...). */
  draftStatus: string;
  /**
   * Which picker group the league belongs to. Actively drafting leagues lead,
   * pre-draft leagues follow, completed/in-season drafts render last (openable
   * for review, visually differentiated).
   */
  stage: "drafting" | "pre_draft" | "completed";
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
  /**
   * How long the league carries players, straight from Sleeper's own league
   * type. Separate from formatSlug on purpose: keeper leagues PRICE off the
   * redraft board, so the slug says redraft, but a keeper league is not a
   * one-year league and the room's explanatory copy must not call it one.
   */
  keeperStyle: KeeperStyle;
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
  /**
   * The league's literal Sleeper scoring_settings map, captured with the league
   * object at sync time. Empty when the league fetch failed or predates the
   * league_metadata column (migration 0180). Everything points-based (Draft
   * Pulse, the marginal starting-lineup engine, draft grades) scores through
   * this rather than a scoring preset, exactly like Power Pulse.
   */
  scoringSettings: Record<string, number>;
  /**
   * The league's roster_positions array, verbatim ("QB","RB","RB","WR","WR",
   * "TE","FLEX","SUPER_FLEX","BN",...). This is the ONLY honest source of the
   * starting lineup: draft.settings.slots_* flattens REC_FLEX / WR_TE /
   * WRRB_FLEX into one bucket. Empty when unavailable, in which case the slot
   * model falls back to slots_* and then to the admin fallback targets.
   */
  rosterPositions: string[];
  /** Sleeper settings.playoff_teams, or null when unknown. */
  playoffTeams: number | null;
  /** Sleeper settings.playoff_week_start, or null when unknown. */
  playoffWeekStart: number | null;
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
export type SyncStatus =
  | "synced"
  | "served-cache"
  | "cooldown"
  | "synced-by-other"
  | "rate-limited"
  | "error";

/** Result of a sync attempt: always carries the current shaped cache when available. */
export interface SyncOutcome {
  status: SyncStatus;
  cooldownRemainingSeconds: number;
  lastSyncedAt: string | null;
  cache: ShapedDraftCache | null;
  /** Sanitized, user-safe message on the error path. */
  error?: string;
}
