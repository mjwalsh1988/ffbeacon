/**
 * Fallback defaults for the On The Clock live-draft helper.
 *
 * These are the single source of truth when on_the_clock_settings has no row (or
 * fails to load), so the tool degrades gracefully instead of breaking. The admin
 * page seeds these on first save. Keep every value plain and source-agnostic.
 *
 * SHIPS OFF: feature.enabled defaults to false. On The Clock is not launched yet,
 * matching the project convention of landing features OFF (Beacon Brief
 * bb_enabled=false, ffbeacon is_active=false). The owner flips this in
 * /admin/on-the-clock when the tool is ready to go live; a developer can set a
 * settings row with enabled=true to exercise the UI before launch.
 */

import { DEFAULT_FORMAT_SLUG } from "@/lib/site";
import type { OnTheClockSettings } from "./types";

export const DEFAULT_ON_THE_CLOCK_SETTINGS: OnTheClockSettings = {
  feature: {
    enabled: false,
  },

  sourceFormat: {
    // null = resolve the source_registry default (resolveSourceForFormat). The
    // tool never hardcodes a source slug for data; this is only the starting
    // selection when the user has no preference.
    defaultRankingSource: null,
    // Used when a league's scoring cannot be matched to a supported format.
    defaultFormatFallback: DEFAULT_FORMAT_SLUG,
  },

  pools: {
    enabledPools: ["everyone", "rookies"],
    defaultPool: "everyone",
  },

  sync: {
    // 30s shared per-draft cooldown (server-enforced by claim_on_the_clock_sync).
    cooldownSeconds: 30,
    // Short in-progress lock that blocks two simultaneous syncs of one draft.
    lockSeconds: 15,
    realtimeEnabled: true,
    // An open room pulls Sleeper on its own so a drafter reading the board never
    // has to press anything. Shared per draft, not per viewer: twelve people
    // watching one draft still produce one Sleeper fetch a minute between them.
    autoRefreshEnabled: true,
    autoRefreshSeconds: 60,
  },

  cache: {
    // Three times PROJECTION_CACHE_TTL_MS, so a sweep is only dropped well after
    // it stopped being served and a rebuild is one background pass rather than a
    // user-facing wait. Drafts and picks have no window: they are never deleted.
    projectionRetentionHours: 72,
  },

  limits: {
    maxActiveLeagues: 10,
    maxAvailablePlayers: 100,
  },

  recommendation: {
    teamNeedEnabled: true,
    // Balanced preset: wNeed 0.40, wValue 0.60, wReach 0.15 (a small constant).
    aggressiveness: "balanced",
    weights: {
      value: 0.6,
      need: 0.4,
      reach: 0.15,
    },
    // Reach only bites once a player is more than one tier below the best
    // same-position available option.
    maxReachTierBreak: 1,
  },

  dstk: {
    includedInRoom: true,
    recommendBehavior: "suppress_until_need",
    requireStartingSlot: true,
    // Conservative late-round gates: only surface a DST/K as a need pick deep in
    // the draft, and only when the league requires the slot and the user lacks one.
    minRoundForDst: 10,
    minRoundForK: 12,
  },

  positionAdjust: {
    superflexQbMultiplier: 1.25,
    tePremiumMultiplier: 1.15,
  },

  // Fallback starting-slot counts, used only when roster_positions is missing or
  // unmatched. A common 1QB / 2RB / 3WR / 1TE / 2FLEX shape plus K/DEF.
  positionFallbackTargets: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    FLEX: 2,
    SUPER_FLEX: 0,
    K: 1,
    DEF: 1,
  },

  // ADP value indicators: a pick is flagged good value / reach only once it
  // lands this many picks after / before its Sleeper ADP (half a round in a
  // 12-team league). Adjustable in /admin/on-the-clock.
  valueIndicators: {
    thresholdPicks: 6,
  },

  mappingVisibility: {
    showUnmappedPanel: true,
  },

  buildMode: {
    enabled: true,
    // Balanced is the honest starting point: we have not asked the drafter yet,
    // so we do not assume they are chasing this season or next.
    defaultMode: "balanced",
    // An empty lineup is almost entirely a points question, a full one is
    // almost entirely an asset question. See marginal.ts pointsWeightFor.
    pointsWeightEmpty: 0.8,
    pointsWeightFull: 0.35,
    competePointsBoost: 1.15,
    rebuildPointsCap: 0.25,
    youthWeight: 0.35,
    upsideWeight: 0.2,
    competeValueTilt: 0.45,
    rebuildValueTilt: 0.4,
  },

  marginal: {
    insuranceWeight: 0.35,
    dropoffWeight: 0.5,
    // Even a starter who has never missed a week leaves his backup some credit;
    // the accuracy table only knows the seasons it has seen.
    minStarterRisk: 0.12,
    maxCandidates: 160,
  },

  awards: {
    // Empty map means every award is on. The admin page writes explicit falses.
    enabled: {},
    minSuccessfulTraderTrades: 1,
    minAdpPicks: 3,
    minAccuracyWeeks: 8,
    minPlayersForLineupAwards: 5,
  },

  grades: {
    enabled: true,
    weights: {
      market: 0.28,
      lineup: 0.26,
      construction: 0.14,
      reliability: 0.1,
      future: 0.12,
      trades: 0.1,
    },
    // Mostly curved: every team in a startup drafts from the same pool, so the
    // interesting question is who did better than the room, not who cleared an
    // arbitrary bar. A little absolute so a genuinely strong room is not forced
    // to produce an F.
    absoluteBlend: 0.25,
  },

  alerts: {
    runWindow: 8,
    runThreshold: 4,
    tierCliffRemaining: 3,
    maxGoneBefore: 12,
  },
};
