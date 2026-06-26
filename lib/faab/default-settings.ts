/**
 * Fallback defaults for the FAAB strategy calculator.
 *
 * These mirror what the admin page seeds on first save. They are the single
 * source of truth when faab_calculator_settings has no row (or fails to load),
 * so the public calculator always renders and never depends on a DB round trip
 * succeeding. Keep every value plain and source-agnostic: nothing here assumes
 * a particular value scale.
 */

import type { FaabSettings } from "./types";

export const DEFAULT_FAAB_SETTINGS: FaabSettings = {
  userDefaults: {
    defaultTeams: 12,
    teamOptions: [8, 10, 12, 14, 16],
    defaultStarters: 9,
    starterOptions: [7, 8, 9, 10, 11, 12],
    // NOTE: 12 teams x 9 starters = 108 weekly starter demand, a safe general
    // public baseline. A deeper 10-starter default skews the calculator more
    // aggressive out of the box; users can still pick 10-12 manually.
    defaultNeed: "medium",
    defaultBudget: 100,
  },

  // playerRatio = effectiveOverallRank / (teams * offensiveStarters).
  // Lower ratio = scarcer/more valuable player. Bands are ordered; the final
  // band uses maxRatio null to mean "and above".
  bidCurve: [
    { id: "elite", minRatio: 0.0, maxRatio: 0.35, tierLabel: "Elite / league-changing", minPct: 65, maxPct: 100, capPct: 100 },
    { id: "high_starter", minRatio: 0.35, maxRatio: 0.6, tierLabel: "High-end starter", minPct: 40, maxPct: 65, capPct: 75 },
    { id: "strong_starter", minRatio: 0.6, maxRatio: 0.85, tierLabel: "Strong weekly starter", minPct: 25, maxPct: 40, capPct: 55 },
    { id: "starter", minRatio: 0.85, maxRatio: 1.1, tierLabel: "Starter-level / priority add", minPct: 14, maxPct: 25, capPct: 45 },
    { id: "depth", minRatio: 1.1, maxRatio: 1.4, tierLabel: "Useful depth / flex", minPct: 8, maxPct: 14, capPct: 25 },
    { id: "bench", minRatio: 1.4, maxRatio: 1.8, tierLabel: "Bench depth / upside add", minPct: 4, maxPct: 8, capPct: 15 },
    { id: "speculative", minRatio: 1.8, maxRatio: 2.4, tierLabel: "Speculative add", minPct: 1, maxPct: 4, capPct: 8 },
    { id: "flyer", minRatio: 2.4, maxRatio: null, tierLabel: "Deep flyer", minPct: 0, maxPct: 2, capPct: 3 },
  ],

  depthAdjustments: {
    shallowMaxDemand: 80,
    standardMaxDemand: 125,
    eliteRatioMax: 0.6,
    depthRatioMin: 1.1,
    shallowEliteBoostPct: 15,
    shallowDepthCutPct: 30,
    deepEliteBoostReductionPct: 5,
    deepDepthBoostPct: 25,
  },

  needMultipliers: {
    low: 0.75,
    medium: 1.0,
    high: 1.35,
  },

  dump: {
    enabled: true,
    thresholdRatio: 0.4,
    valueScoreThreshold: 1.05,
    ranges: {
      low: { minPct: 60, maxPct: 80 },
      medium: { minPct: 75, maxPct: 95 },
      high: { minPct: 90, maxPct: 100 },
    },
  },

  valueNormalization: {
    replacementRankMultiplier: 1.4,
    eliteRankMultiplier: 0.25,
    valueScoreClampMin: 0,
    valueScoreClampMax: 1.25,
    valueScoreNeutral: 0.5,
    valueAdjustmentMaxPct: 25,
  },

  copy: {
    economyNotice:
      "FAAB is league-dependent. These bids are general baseline suggestions based on player value, ranking, league size, starter demand, remaining budget, and need level. Every league economy is different, so aggressive leagues, shallow benches, late-season timing, and manager tendencies can change the right bid.",
    missingValueNote:
      "This recommendation is rank-based because current value data was not available for this player or league setup.",
    dumpNote:
      "This is a FAAB dump candidate. In most leagues, a player this valuable should rarely be available, so spending most or all of your remaining budget can be justified.",
    teamsHelp:
      "How many teams are in your league. More teams means more starters every week, which makes useful players harder to replace.",
    startersHelp:
      "How many offensive players each team starts every week (QB, RB, WR, TE, and FLEX spots). More starters means deeper demand for talent.",
  },
};
