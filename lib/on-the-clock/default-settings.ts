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
  },

  cache: {
    activeTtlHours: 24,
    completedRetentionHours: 168, // 7 days
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
};
