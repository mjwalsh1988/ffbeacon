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
    defaultLastRegularWeek: 14,
    defaultLeagueBudget: 100,
    defaultStyle: "typical",
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
      "Every league spends differently. Connect a league above and we price against your real roster, your rivals' budgets, and what your league actually pays.",
    missingValueNote:
      "No current value data for this player, so this bid is based on ranking alone.",
    dumpNote:
      "Worth emptying the budget. A player this good rarely reaches waivers.",
    teamsHelp: "More teams means more starters each week, so useful players get harder to replace.",
    startersHelp:
      "QB, RB, WR, TE, and FLEX spots. Deeper lineups make marginal players more valuable.",
    leagueModeNotice:
      "Priced against your real roster: every remaining week projected with and without him, in your league's scoring. A strong starting point, not a ceiling.",
    thinDataNote:
      "Not much history behind this one yet, so the range is deliberately wide.",
  },

  // ---- League mode ---------------------------------------------------------

  marginal: {
    // Roughly a starting flex upgrade. Adding four points a week to an optimal
    // lineup every week is a genuine, season-shifting add in most formats.
    bigUpgradePointsPerWeek: 4,
    // Twenty points of playoff odds is the difference between a bubble team and
    // a favorite. That is what "worth emptying the budget" looks like.
    bigUpgradeOddsPoints: 20,
    oddsWeight: 0.5,
    // Half the Power Pulse run count. This simulates twice, on demand, inside a
    // request, and 2000 runs already settles playoff odds to well under a point.
    simulationRuns: 2000,
    maxPctFromUpgrade: 85,
    minMeaningfulPointsPerWeek: 0.25,
  },

  dropGuard: {
    enabled: true,
    useHealthyBaseline: true,
    // A straight comparison. We will not tell somebody to cut a player the
    // market prices above the one they are claiming, and no fudge factor makes
    // that advice better.
    maxDropValueRatio: 1,
    // The bottom 40% of a keeper roster. Deep enough that a real spare part is
    // always available, shallow enough that nobody is told to release a starter
    // they intend to keep next year.
    keeperBottomShare: 0.4,
    // Below eight priced players a roster has no meaningful top and bottom, so
    // the guards would be sorting noise.
    minValuedPlayers: 8,
  },

  signals: {
    beatRate: { enabled: true, neutral: 0.5, maxAdjustPct: 12, minWeeks: 4 },
    availability: { enabled: true, neutral: 0.85, maxAdjustPct: 15 },
    volatility: { enabled: true, neutral: 0.55, maxSpreadPct: 25 },
    opportunity: {
      enabled: true,
      maxAdjustPct: 20,
      minTeamSnaps: 20,
      breakoutDeltaPoints: 15,
      collapseDeltaPoints: 15,
      recentGames: 2,
    },
    matchup: { enabled: true, maxAdjustPct: 10 },
    ceiling: { enabled: true, lookbackSeasons: 3 },
  },

  market: {
    rivalBudget: { enabled: true, maxAdjustPct: 20 },
    rivalNeed: { enabled: true, maxAdjustPct: 25, minPointsPerWeek: 1 },
    history: { enabled: true, minSamples: 6, lookbackSeasons: 3, blendWeight: 0.35 },
    // Measured from 8,257 priced winning bids in our synced leagues, seasons
    // 2024 to 2026, then tempered: the p75 ratios are steeper than this and a
    // model should not bet the whole difference on one season of data.
    calendar: {
      enabled: true,
      bands: [
        { fromWeek: 1, toWeek: 1, multiplier: 1.0 },
        { fromWeek: 2, toWeek: 6, multiplier: 1.1 },
        { fromWeek: 7, toWeek: 10, multiplier: 0.9 },
        { fromWeek: 11, toWeek: 13, multiplier: 1.0 },
        { fromWeek: 14, toWeek: null, multiplier: 1.3 },
      ],
    },
    urgency: {
      enabled: true,
      lateSeasonWeek: 12,
      maxLateBoostPct: 40,
      earlySeasonWeek: 3,
      maxEarlyDiscountPct: 15,
    },
  },

  ladder: {
    walkAwayTrimPct: 0,
    aggressiveAbovePct: 35,
    minStartableBid: 1,
  },

  // Sums to 9 at the baseline, which is the standard 1 QB, 2 RB, 3 WR, 1 TE
  // plus two flex spots absorbed into the running back and receiver counts.
  manualReplacement: {
    startersPerTeam: { QB: 1.0, RB: 2.8, WR: 3.9, TE: 1.3, K: 1.0, DEF: 1.0 },
    baselineStarters: 9,
    flatPositions: ["K", "DEF"],
    superflexQbPerTeam: 1.9,
  },

  leagueDump: {
    enabled: true,
    oddsPointsThreshold: 12,
    pointsPerWeekThreshold: 3.5,
    // A team under a 5% playoff chance is not one waiver claim away, and telling
    // it to empty the budget is the worst advice the tool could give.
    loserOddsCeiling: 5,
    ranges: {
      low: { minPct: 55, maxPct: 75 },
      medium: { minPct: 70, maxPct: 90 },
      high: { minPct: 85, maxPct: 100 },
    },
    // Four teams that would start him is where our auction data turns brutal:
    // the median winning bid at four or more bidders is 16% of budget against
    // 6.5% at three, and the p90 is 53%.
    contestedRivals: 4,
    superflexQbStarterOut: true,
  },

  auction: {
    enabled: true,
    // 4,000 runs settles a win chance to well under a percentage point, and the
    // whole simulation is arithmetic over at most 31 rivals.
    runs: 4000,
    participation: 0.7,
    strayBidRate: 0.06,
    bidSigma: 0.55,
    heatShrink: 20,
    tendencyShrink: 8,
    heatClamp: [0.5, 2.5],
    tendencyClamp: [0.5, 2.5],
    // Week 1 is a different market: budgets are full and half the room bids on
    // everything. Counting it would make every league look hot.
    minContestedWeek: 2,
    oddNudge: true,
  },

  goal: {
    defaultGoal: "value",
    valueTarget: 0.6,
    sureTarget: 0.9,
    sureMaxOverWorthPct: 25,
  },

  priors: {
    minCellSamples: 30,
    staleAfterDays: 6,
    styleMultipliers: { tight: 0.7, typical: 1, wild: 1.4 },
  },

  playoffValue: {
    enabled: true,
    playoffWeekWeight: 1.0,
    titleOddsWeight: 0.25,
    bigTitleOddsPoints: 5,
  },

  dynastyValue: {
    enabled: true,
    // A contender is buying weeks; a rebuilder is buying an asset. The blend is
    // the one number that separates those two answers about the same player.
    blendByStatus: { competitor: 0.15, loaded: 0.25, middle: 0.35, rebuilder: 0.6 },
    eliteRankFactor: 0.25,
  },

  injury: {
    carryOutFromSource: true,
    teammateSignal: { enabled: true, maxAdjustPct: 20 },
  },

  breakout: {
    enabled: true,
    blendWeight: 0.5,
  },

  chopped: {
    enabled: true,
    runs: 3000,
    strengthWeights: { surviveThisWeek: 0.4, winLeague: 0.35, weeksAlive: 0.25 },
    bigSurvivePoints: 10,
    bigWinPoints: 5,
    bigWeeksAlive: 1.0,
    maxPctFromUpgrade: 70,
    // Money loses value as the field shrinks and the pool fills with starters.
    // Fantasy Life's 2024 guillotine medians have the same player falling 22%
    // (Jefferson) to 77% (St. Brown) between about 13 alive and about 6, and
    // the NFFC Eliminator study has top-12 running backs at 28.9% of budget
    // with half the field alive, 12.8% at 30 to 50%, and 0% below that.
    priceByAliveFraction: [
      { minFraction: 0.5, multiplier: 1.0 },
      { minFraction: 0.3, multiplier: 0.45 },
      { minFraction: 0, multiplier: 0.15 },
    ],
    dangerThreshold: 0.2,
    dangerWeight: 0.5,
    substituteShare: 0.9,
    substituteDiscount: 0.5,
    // Charchian's published hold targets, which the 2024 champion's ledger
    // ($969 after week 4, $904 after week 8, $240 after week 12, $11 after 14)
    // tracks closely.
    paceTargets: [
      { throughWeek: 4, holdPct: 90 },
      { throughWeek: 8, holdPct: 75 },
      { throughWeek: 12, holdPct: 25 },
      { throughWeek: 17, holdPct: 0 },
    ],
    manualDangerMultipliers: { bottomTwo: 1.6, nearCut: 1.25, midPack: 1.0, safe: 0.8 },
  },
};
