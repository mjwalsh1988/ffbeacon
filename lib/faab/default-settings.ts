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
    // WHAT A MAXIMUM UPGRADE LOOKS LIKE, and it is the number that decides
    // whether the calculator can tell two players apart at all.
    //
    // It was four, which is roughly a flex upgrade, so everything from a
    // fringe second running back up to the best player in the game scored a
    // full points term and came out at the same price. Every complaint about
    // the tool pricing a streamer like a league winner traces to this line.
    //
    // Nine is the real bar: a genuine league-winning add replaces a starter
    // rather than a bench player, and the gain to an OPTIMAL lineup, averaged
    // over every remaining week including byes and weeks he does not start,
    // lands around nine to twelve points for that player and around three to
    // five for an ordinary useful one. Those are now different answers.
    bigUpgradePointsPerWeek: 9,
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
    // WHEN IN THE SEASON A CLAIM HAPPENS, AND WHAT THAT DOES TO THE PRICE.
    //
    // Re-measured 2026-09-22 over 3,578 priced winning bids in our own synced
    // leagues, weeks 2 to 17, chopped excluded, as a share of each league's
    // full budget. Against the weeks 7 to 10 baseline:
    //
    //   weeks 2 to 6    p75 1.33x   p50 1.20x   (n=1,742)
    //   weeks 7 to 10   p75 1.00x   p50 1.00x   (n=872)
    //   weeks 11 to 13  p75 1.10x   p50 1.00x   (n=556)
    //   week 14 on      p75 1.64x   p50 1.48x   (n=408)
    //
    // The bands below reproduce that shape exactly (divide any by 0.9). The
    // previous set had the right shape and was flattened by about half: early
    // season ran at 1.22x the baseline where the market runs at 1.33x, and the
    // run-in at 1.44x where the market runs at 1.64x. Managers really do spend
    // harder in September and again when leftover budget is about to be worth
    // nothing, and the model was splitting the difference with itself.
    //
    // WEEK 1 IS DELIBERATELY NOT RAISED. Our week 1 bucket is 5,526 claims and
    // most of them are offseason and preseason dynasty rookie claims rather
    // than an in-season market, so its level says little about the Tuesday
    // after the opener.
    calendar: {
      enabled: true,
      bands: [
        { fromWeek: 1, toWeek: 1, multiplier: 0.95 },
        { fromWeek: 2, toWeek: 6, multiplier: 1.2 },
        { fromWeek: 7, toWeek: 10, multiplier: 0.9 },
        { fromWeek: 11, toWeek: 13, multiplier: 1.0 },
        { fromWeek: 14, toWeek: null, multiplier: 1.5 },
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
    // Was 3.5, which is an ordinary flex upgrade and fired the dump on players
    // no league empties a budget for. Seven sits just under
    // `marginal.bigUpgradePointsPerWeek`, so the points route into the dump now
    // means the same thing the points term calls a near-maximum upgrade.
    pointsPerWeekThreshold: 7,
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
    //
    // But four is four out of eleven in a 12-team league and four out of
    // seventeen in a chopped one, and "would start him" is a one-point bar, so
    // the count alone fired on nearly every usable player in a normal league
    // and on every single one in a big chopped league. Both of the guards
    // below have to clear as well: a real share of the room, and a real
    // upgrade for the reader rather than for somebody else.
    contestedRivals: 4,
    contestedRivalShare: 0.4,
    // A crowded wire makes a big add more urgent; it does not make a small one
    // big. This sits just under `pointsPerWeekThreshold`, which is the bar the
    // points route alone has to clear, so the crowd is worth about a point of
    // upgrade and no more.
    contestedMinPointsPerWeek: 6,
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
    // WHAT A RIVAL BIDS, AS A SHARE OF WHAT THE PLAYER IS WORTH TO THEM.
    //
    // Rivals used to bid their reservation price, which nobody does: FAAB is
    // one budget for a whole season and a manager who spends their full
    // valuation on every claim has nothing left by week 6. The consequence was
    // measurable and severe. Against `faab_market_priors`, the simulated top
    // rival in a contested redraft auction sat at 45% of budget where the real
    // runner-up sits near 11%, so the cheapest bid reaching a 60% win chance
    // came out above the p90 of every comparable auction we hold.
    //
    // 0.3 is the calibration: see `scripts/faab-calibrate.ts`, which prints
    // the simulated top-rival quantiles beside the real ones for the same
    // cell. Rebuild the priors and re-run it before moving this number.
    worthToBidRatio: 0.3,
    // THE PREMIUM A PLAYER WHO WILL NOT COME ROUND AGAIN DRAWS.
    //
    // Measured over settled auctions in our own leagues, weeks 2 to 16,
    // chopped excluded, joined to a current redraft ranking. A player inside
    // the top 24 clears at 8.0% of budget at the median, 20.0% at the
    // seventy-fifth and 45.2% at the ninetieth (n=22). One outside the top
    // 120 clears at 5.0%, 12.0% and 25.0% (n=3,099). Top 60 against beyond
    // 150 on contested auctions only: winner 15.0% against 12.6%, runner-up
    // 7.0% against 5.0% (n=53 and n=683).
    //
    // Part of that gap is already in the model, because a better player is a
    // bigger lineup upgrade for the rivals too. 35% is the residual: what the
    // room pays for scarcity itself, over and above the arithmetic.
    //
    // A CAVEAT THE NUMBER CARRIES. Those tiers come from joining historical
    // bids to a CURRENT ranking, so a player who was nobody in week 3 and is a
    // starter now sits in the wrong bucket. It is the best measurement
    // available (we store no historical rank) and it is why this is 35 rather
    // than the 80 the raw p90 gap would support.
    scarcityPremiumPct: 35,
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
    // Two thirds of the way to a genuine starter's market value. Above this a
    // player is one the room chases rather than prices, and the page says so.
    scarceShare: 0.66,
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
