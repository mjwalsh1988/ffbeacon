/**
 * Types for the FAAB strategy calculator.
 *
 * The calculator is a pure function (lib/faab/calculate-faab.ts) driven by an
 * editable settings document (lib/faab/default-settings.ts holds the fallback
 * defaults; the admin page persists overrides to faab_calculator_settings).
 *
 * Nothing here reads or writes player values. The calculator only CONSUMES the
 * rank/value numbers the page already resolved for the active source + format.
 */

export type NeedLevel = "low" | "medium" | "high";

/** One band of the playerRatio -> baseline FAAB curve. Ordered low ratio to
 * high. maxRatio === null means "and above" (the final band). */
export interface BidBand {
  /** Stable identifier so the admin UI can key/edit rows. */
  id: string;
  minRatio: number;
  /** null === infinity (final band). */
  maxRatio: number | null;
  tierLabel: string;
  /** Baseline bid as a percent of remaining budget, before adjustments. */
  minPct: number;
  maxPct: number;
  /** Hard cap (percent of budget) for this tier, applied after every
   * adjustment so high need cannot inflate a deep flyer into a huge bid. */
  capPct: number;
}

export interface UserDefaults {
  defaultTeams: number;
  teamOptions: number[];
  defaultStarters: number;
  starterOptions: number[];
  defaultNeed: NeedLevel;
  defaultBudget: number;
}

export interface DepthAdjustments {
  /** leagueDemand <= this is a "shallow" league. */
  shallowMaxDemand: number;
  /** leagueDemand <= this (and above shallow) is "standard"; above is "deep". */
  standardMaxDemand: number;
  /** playerRatio <= this counts as an "elite" player for depth adjustments. */
  eliteRatioMax: number;
  /** playerRatio >= this counts as a "fringe / depth" player. */
  depthRatioMin: number;
  /** Shallow league: boost elite players by this percent. */
  shallowEliteBoostPct: number;
  /** Shallow league: cut fringe / depth players by this percent. */
  shallowDepthCutPct: number;
  /** Deep league: trim the elite emphasis by this percent. */
  deepEliteBoostReductionPct: number;
  /** Deep league: boost fringe / depth players by this percent. */
  deepDepthBoostPct: number;
}

export interface NeedMultipliers {
  low: number;
  medium: number;
  high: number;
}

/** Inclusive percent-of-budget range. */
export interface PctRange {
  minPct: number;
  maxPct: number;
}

export interface DumpSettings {
  enabled: boolean;
  /** dumpRankThreshold = leagueDemand * thresholdRatio. */
  thresholdRatio: number;
  /** valueScore at or above this also flags a dump candidate. */
  valueScoreThreshold: number;
  ranges: Record<NeedLevel, PctRange>;
}

export interface ValueNormalization {
  /** replacementRank = round(leagueDemand * this). */
  replacementRankMultiplier: number;
  /** eliteRank = max(1, round(leagueDemand * this)). */
  eliteRankMultiplier: number;
  valueScoreClampMin: number;
  valueScoreClampMax: number;
  /** valueScore at which the value modifier is neutral (no change). */
  valueScoreNeutral: number;
  /** Maximum +/- percent the value modifier can move a bid. */
  valueAdjustmentMaxPct: number;
}

export interface ResultCopy {
  economyNotice: string;
  missingValueNote: string;
  dumpNote: string;
  teamsHelp: string;
  startersHelp: string;
  /** Shown above the league-connected result, which is a different promise from
   * the general baseline the manual mode makes. */
  leagueModeNotice: string;
  /** Shown when league mode runs but the data underneath it is thin. */
  thinDataNote: string;
}

// ---------------------------------------------------------------------------
// League mode settings
//
// Everything below drives the connected-league calculator. It is separate from
// the manual bid curve on purpose: manual mode prices a player against a
// generic league, league mode prices what he adds to one specific roster, and
// collapsing the two would force one set of numbers to mean two things.
// ---------------------------------------------------------------------------

/** Turning a lineup upgrade into a share of budget. */
/**
 * Which players the calculator is allowed to tell you to cut.
 *
 * The lineup model measures a player by the points he adds to your starting
 * lineup over the weeks you have left. That is the right measure for pricing a
 * bid and the wrong one for choosing a cut, because a player carrying a
 * long-term injury designation projects zero for every remaining week and so
 * reads as the cheapest man on the roster. He is not cheap. He is the most
 * expensive thing you own, sitting still.
 *
 * Two guards, and the second one is different in a keeper league on purpose: a
 * cut returns nothing, and in a league where you keep your team, what you are
 * giving up is the asset, not the rest of a season.
 */
export interface DropGuardSettings {
  enabled: boolean;
  /**
   * Rank cut candidates on what they are worth when they play, ignoring injury
   * designations. Turning this off restores the old behavior, where the injured
   * player is always the cheapest cut.
   */
  useHealthyBaseline: boolean;
  /**
   * Redraft only. A cut may be suggested when the market rates that player at
   * or below this multiple of the player being added. 1 means "never tell me to
   * cut someone worth more than the man I am bidding on".
   */
  maxDropValueRatio: number;
  /**
   * Dynasty and keeper leagues only. A cut may be suggested only from this
   * bottom share of the roster by market value. 0.4 means the bottom 40%.
   */
  keeperBottomShare: number;
  /**
   * Below this many valued players on a roster the value guards are skipped
   * entirely: a bottom share of four players is not a share of anything.
   */
  minValuedPlayers: number;
}

export interface MarginalSettings {
  /**
   * The points-per-week gain treated as a full-strength upgrade. A player who
   * adds this much to your starting lineup every week justifies the top of the
   * scale. Anything less scales down proportionally.
   */
  bigUpgradePointsPerWeek: number;
  /** The playoff-odds gain (in percentage points) treated as full strength. */
  bigUpgradeOddsPoints: number;
  /**
   * How much of the blended upgrade score comes from playoff odds rather than
   * raw points, 0 to 1. Odds answer "does this change my season", points answer
   * "does this change my Sunday", and both matter.
   */
  oddsWeight: number;
  /** Monte Carlo runs per simulation. This runs twice, on demand, so it is
   * deliberately lighter than the Power Pulse page's own run count. */
  simulationRuns: number;
  /** The most of your remaining budget a lineup upgrade alone can justify. */
  maxPctFromUpgrade: number;
  /** Below this points-per-week the player is reported as not an upgrade. */
  minMeaningfulPointsPerWeek: number;
}

/** One tunable player-quality signal. */
export interface SignalToggle {
  enabled: boolean;
  /** The most this signal can move the bid, up or down, as a percent. */
  maxAdjustPct: number;
}

export interface SignalSettings {
  /** How often he meets or beats his own projection. */
  beatRate: SignalToggle & {
    /** The beat rate that counts as neutral, 0 to 1. */
    neutral: number;
    /** Below this many graded weeks the signal is skipped as too thin. */
    minWeeks: number;
  };
  /** How often he is actually available to play. */
  availability: SignalToggle & { neutral: number };
  /**
   * Boom-or-bust players widen the recommended range instead of moving it. A
   * wide range is the honest way to say "this could go either way".
   */
  volatility: { enabled: boolean; neutral: number; maxSpreadPct: number };
  /** Snap share and touches: is the role real, or was it one loud afternoon. */
  opportunity: SignalToggle & {
    /** Team offensive snaps below this in a game make the read unreliable. */
    minTeamSnaps: number;
    /** Snap-share gain (percentage points) that reads as a role change. */
    breakoutDeltaPoints: number;
    /** Snap-share drop (percentage points) that reads as a role loss. */
    collapseDeltaPoints: number;
    /** Games in the recent window compared against the games before it. */
    recentGames: number;
  };
  /** Who he actually plays over your remaining weeks. */
  matchup: SignalToggle;
  /** Past positional finishes, used for framing rather than for math. */
  ceiling: { enabled: boolean; lookbackSeasons: number };
}

export interface MarketSettings {
  /** Your budget against theirs. Cheap when they are broke. */
  rivalBudget: SignalToggle;
  /** How many rivals this player would actually start for. */
  rivalNeed: SignalToggle & {
    /** Points-per-week gain that counts as a rival genuinely wanting him. */
    minPointsPerWeek: number;
  };
  /** What comparable players have actually sold for in this league. */
  history: {
    enabled: boolean;
    /** Below this many past winning bids the history is not reported. */
    minSamples: number;
    lookbackSeasons: number;
    /**
     * How far to pull the recommendation toward the league's own going rate,
     * 0 to 1. The model still leads; history corrects it toward reality.
     */
    blendWeight: number;
  };
  /** Unspent FAAB is worth nothing in January. */
  urgency: {
    enabled: boolean;
    /** From this week onward the late-season boost is at full strength. */
    lateSeasonWeek: number;
    maxLateBoostPct: number;
    /** Through this week the early-season discount is at full strength. */
    earlySeasonWeek: number;
    maxEarlyDiscountPct: number;
  };
}

/**
 * How the answer becomes a walk-away / likely / aggressive ladder.
 *
 * Walk-away is derived from VALUE (what he is worth to this roster) and the
 * other two from PRICE (what it takes to win him), which is why only the trim
 * is expressed against the ceiling.
 */
export interface LadderSettings {
  /** Safety margin taken off the walk-away ceiling, as a percent. */
  walkAwayTrimPct: number;
  /** The aggressive rung sits this percent above the likely bid. */
  aggressiveAbovePct: number;
  /** A player who starts for you is never worth less than this many FAAB. */
  minStartableBid: number;
}

/**
 * Finding replacement level without a league connected.
 *
 * The shape is editable because leagues genuinely differ, and it scales with
 * the reader's starter count so a deep league gets a deeper replacement level.
 */
export interface ManualReplacementSettings {
  /** Starters of each position per team, at the baseline starter count. */
  startersPerTeam: Record<string, number>;
  /** The starter count `startersPerTeam` is expressed against. */
  baselineStarters: number;
  /** Positions that do not scale with starter count. Nobody starts two kickers. */
  flatPositions: string[];
}

/** When league mode should shout. */
export interface LeagueDumpSettings {
  enabled: boolean;
  /** Playoff-odds gain (percentage points) that justifies emptying the budget. */
  oddsPointsThreshold: number;
  /** Points-per-week gain that justifies it on its own. */
  pointsPerWeekThreshold: number;
  /** Teams whose playoff odds are at or below this are told to sit it out. */
  loserOddsCeiling: number;
  ranges: Record<NeedLevel, PctRange>;
}

export interface FaabSettings {
  userDefaults: UserDefaults;
  bidCurve: BidBand[];
  depthAdjustments: DepthAdjustments;
  needMultipliers: NeedMultipliers;
  dump: DumpSettings;
  valueNormalization: ValueNormalization;
  copy: ResultCopy;
  marginal: MarginalSettings;
  dropGuard: DropGuardSettings;
  signals: SignalSettings;
  market: MarketSettings;
  ladder: LadderSettings;
  leagueDump: LeagueDumpSettings;
  manualReplacement: ManualReplacementSettings;
}

/** The selected player, reduced to only what the calculator consumes. */
export interface FaabPlayerInput {
  overallRank: number | null;
  positionRank?: number | null;
  value: number | null;
}

/** One entry of the resolved player pool (the page's ranked list for the
 * active source + format). Used only to locate replacement/elite value. */
export interface FaabPoolEntry {
  overallRank: number;
  value: number | null;
}

export interface FaabCalcInput {
  player: FaabPlayerInput;
  remainingBudget: number;
  needLevel: NeedLevel;
  teams: number;
  offensiveStarters: number;
  settings: FaabSettings;
  /** Optional. When absent or valueless, the calc falls back to rank-only. */
  playerPool?: FaabPoolEntry[];
}

export type AggressionLabel =
  | "Conservative"
  | "Balanced"
  | "Aggressive"
  | "Empty the Clip";

export interface FaabDebugContext {
  leagueDemand: number;
  playerRatio: number | null;
  bandId: string | null;
  baselineMinPct: number;
  baselineMaxPct: number;
  depthTier: "shallow" | "standard" | "deep";
  depthMultiplier: number;
  valueScore: number | null;
  valueMultiplier: number;
  needMultiplier: number;
  replacementRank: number;
  eliteRank: number;
  replacementValue: number | null;
  eliteValue: number | null;
  preCapMinPct: number;
  preCapMaxPct: number;
  capPct: number | null;
  dumpRankThreshold: number;
  isDumpCandidate: boolean;
  usedValueData: boolean;
}

export interface FaabResult {
  lowBid: number;
  highBid: number;
  lowPct: number;
  highPct: number;
  targetPct: number;
  tierLabel: string;
  aggressionLabel: AggressionLabel;
  isDumpCandidate: boolean;
  explanation: string;
  notices: string[];
  debugContext: FaabDebugContext;
}

// ---------------------------------------------------------------------------
// League mode results
// ---------------------------------------------------------------------------

/** One remaining week, from your roster's point of view. */
export interface MarginalWeek {
  week: number;
  /** True when adding him changes the optimal lineup that week. */
  startsForYou: boolean;
  /** Points the optimal lineup gains that week. Zero when he does not start. */
  pointsAdded: number;
  /** NFL opponent, when the projection carries one. */
  opponent: string | null;
  /** Opponent-strength multiplier, 1.0 when neutral. */
  opponentMultiplier: number;
}

/** The player you would drop to make room, and what it costs you. */
export interface DropCost {
  playerId: string;
  name: string;
  position: string;
  /** NFL team, for telling two players with the same surname apart. */
  team: string | null;
  /** Points per week the optimal lineup loses by cutting them. Usually 0. */
  pointsPerWeek: number;
  /** Sleeper's injury designation, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /**
   * One short plain-language line about this player's place on the roster, so a
   * reader does not have to interpret a points figure to understand why he is
   * on the list.
   */
  note: string | null;
}

/** One player on the shortlist of who a reader could cut. */
export type DropCandidate = DropCost;

/** What adding this player actually does to your team. */
export interface MarginalValue {
  weeksConsidered: number;
  /** How many of those weeks he cracks your starting lineup. */
  weeksStarting: number;
  /** Averaged across every remaining week, including the ones he sits. */
  pointsPerWeek: number;
  /** Averaged across only the weeks he starts. The bigger, flattering number. */
  pointsPerStartedWeek: number;
  /** After subtracting what the drop costs you. This is the number that counts. */
  netPointsPerWeek: number;
  expectedWinsAdded: number | null;
  /**
   * Playoff and title odds in percentage POINTS, 0 to 100, not a 0-to-1
   * probability. The simulator answers in probabilities and lib/faab/league-faab.ts
   * converts once on the way in, because everything downstream of here (the
   * ladder's point thresholds, the copy, the page) reads points.
   */
  playoffOddsBefore: number | null;
  playoffOddsAfter: number | null;
  titleOddsBefore: number | null;
  titleOddsAfter: number | null;
  weeks: MarginalWeek[];
  /**
   * The cut the figures above are measured net of. Always the first entry in
   * `dropOptions`, because the lineup math has to apply one specific cut and
   * the cheapest is the one it applies.
   */
  dropCost: DropCost | null;
  /**
   * Two to four players your lineup would miss least, cheapest first.
   *
   * A LIST RATHER THAN A VERDICT, on purpose. The model measures projected
   * lineup points and market value, and there are real reasons to keep a player
   * it cannot see: a handcuff whose stock jumped when the starter ahead of him
   * went down, a rookie the reader is high on, a piece of a trade already in
   * motion. Naming one player in a confident sentence reads as an instruction.
   * Naming a few, cheapest first, reads as what it is.
   */
  dropOptions: DropCandidate[];
  /**
   * Set when the cut search refused to name somebody, either because every
   * player left is worth keeping or because the obvious cut is a player we will
   * not tell you to give away. Says who, and why, in one sentence.
   */
  dropNote: string | null;
  /** True when he never cracks the lineup: insurance, not an upgrade. */
  isBenchOnly: boolean;
}

export type SignalTone = "good" | "bad" | "neutral";

/** One reason the bid moved, in a form the UI can list and a reader can hear. */
export interface FaabSignal {
  id: string;
  label: string;
  detail: string;
  tone: SignalTone;
  /** Multiplier applied to the target bid. 1 means no effect. */
  multiplier: number;
  /** Extra half-width added to the range, as a fraction of the target. */
  spread: number;
}

/** What comparable players have gone for in this league. */
export interface ComparableBids {
  sampleSize: number;
  median: number;
  p25: number;
  p75: number;
  seasonsCovered: number[];
}

/** The competition. */
export interface MarketRead {
  yourBudget: number;
  /** Rival teams holding more FAAB than you. */
  rivalsRicher: number;
  /**
   * Rival teams holding at least as much as you, which is the number that
   * decides whether you can be outbid. Counting only the strictly-richer ones
   * reads a league where everybody is level as a league where nobody can
   * compete, which is how "the richest rival has only 100" got printed about a
   * league whose budget is 100.
   */
  rivalsAtLeastAsRich: number;
  richestRivalBudget: number | null;
  medianRivalBudget: number | null;
  /** The league's full per-team FAAB allowance. Null when not configured. */
  leagueTotalBudget: number | null;
  /** True when nobody in the league, you included, has spent a dollar yet. */
  everyoneAtFullBudget: boolean;
  /** How many rival teams this player would meaningfully improve. Null when we
   * could not run the check. */
  interestedRivals: number | null;
  rivalsChecked: number | null;
  comparable: ComparableBids | null;
  /** Weeks left in the regular season, including the current one. */
  weeksLeft: number;
  urgencyMultiplier: number;
}

/** The recommendation, as a ladder rather than one number. */
export interface BidLadder {
  /** Above this, walk away. The most useful number on the page. */
  walkAway: number;
  /** What it probably takes to win him. */
  likely: number;
  /** What it takes to be confident. */
  aggressive: number;
  /** Percent of remaining budget the likely bid represents. */
  likelyPct: number;
  /** What you would have left after the likely bid. */
  budgetAfterLikely: number;
}

export type FaabConfidence = "high" | "medium" | "low";

/** One connected-league recommendation, start to finish. */
export interface LeagueFaabReport {
  league: {
    sleeperLeagueId: string;
    name: string;
    season: number;
    teams: number;
    /** Your roster in this league. */
    rosterId: number;
    teamName: string;
    currentWeek: number;
  };
  player: {
    playerId: string;
    sleeperId: string;
    name: string;
    position: string;
    team: string | null;
    injuryStatus: string | null;
  };
  /** Whether he is actually gettable here. */
  availability: "free" | "rostered" | "unknown";
  /** Who holds him, when he is not free. */
  rosteredBy: string | null;
  marginal: MarginalValue | null;
  signals: FaabSignal[];
  market: MarketRead;
  ladder: BidLadder;
  aggressionLabel: AggressionLabel;
  isDumpCandidate: boolean;
  /** One-line answer. */
  headline: string;
  /** The paragraph under it. */
  explanation: string;
  notices: string[];
  confidence: FaabConfidence;
}

/** One league's answer inside the all-leagues view. */
export interface MultiLeagueRow {
  sleeperLeagueId: string;
  leagueName: string;
  status: "ok" | "rostered" | "unsynced" | "error";
  /** Present only when status is "ok". */
  report: LeagueFaabReport | null;
  rosteredBy: string | null;
  message: string | null;
}
