/**
 * Manager Ledger: the shared shapes.
 *
 * WHAT THIS MEASURES, AND WHY IT IS NOT ANY OF THE OTHER MODELS
 *
 *   Every other model in League Pulse measures a ROSTER. The trade-value power
 *   rankings say who owns the most. Power Pulse says what each roster should
 *   win from here. Positional WAR says which positions are scarce. Not one of
 *   them measures the person operating the roster.
 *
 *   This does. It grades the decisions a manager actually made, against what
 *   was actually available to them at the moment they made it, using results
 *   that have already happened. Four ledgers, one page:
 *
 *     Lineup   Did you start the right players out of the ones you owned?
 *     Waivers  Did the players you claimed go on to score for you?
 *     Trades   Did the players you traded for outscore the ones you sent?
 *     Draft    Did you pick the players who went on to produce?
 *
 * ABSOLUTE RULE: EVERY FIGURE HERE IS RETROSPECTIVE AND SETTLED.
 *   Nothing in this model is a projection, an estimate, or a simulation. Every
 *   number is read off `league_matchups` rows marked `is_final`, which carry
 *   the actual points every rostered player scored that week. A week that has
 *   not settled contributes nothing at all rather than contributing a partial
 *   score, because a Sunday-afternoon total graded as a final one would
 *   describe a lineup decision that had not finished happening.
 *
 * ABSOLUTE RULE: THIS MODEL DOES NOT VARY BY VALUE SOURCE OR FORMAT CONFIG.
 *   The same reasoning as Power Pulse and Positional WAR. Every quantity is
 *   points scored under the league's own literal scoring, so there is exactly
 *   one answer per (league, season, roster). `source` and `format_config_id`
 *   are deliberately absent from the fingerprint, and flipping the source
 *   toggle on a league page must never invalidate the cache. A trade
 *   containing draft picks is therefore graded on the players only, and the UI
 *   says so rather than pricing the picks in a currency this model does not
 *   have.
 *
 * ABSOLUTE RULE: NOTHING IN HERE MAY BORROW THE OTHER MODEL'S NAME.
 *   Positional WAR is player-independent and reads no roster. Everything in
 *   this file is team-specific by construction, so it uses the vocabulary
 *   CLAUDE.md reserves for team-specific work: "wins left on the bench",
 *   "best-lineup record", "points".
 *
 *   `lib/positional-war/naming.test.ts` now polices this directory, comments
 *   included, which is why the sentence above names the metric in full rather
 *   than using the bare token: the rule holds for the file that states it.
 *
 * THE LINE BETWEEN A LEDGER AND A GRADE
 *   A ledger entry is a fact: this manager started this lineup, it scored this
 *   many, the best legal lineup out of the same players scored this many. A
 *   grade is an opinion about the fact. The engine produces only ledger
 *   entries and ranks; every sentence a reader sees is built at render time
 *   from those numbers, and every sentence cites one of them.
 */

/** A position the optimizer understands. Mirrors PulsePosition deliberately. */
export type LedgerPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/**
 * One settled week for one roster, graded.
 *
 * `setPoints` is NOT necessarily the score Sleeper put on the board. It is the
 * score of the set lineup restricted to the slots this model can optimise. In
 * a league with no IDP those are the same number. In an IDP league they are
 * not, because `startingSlots` in lib/power-pulse/lineup.ts drops the tokens
 * it has no position eligibility for, and comparing a full official total
 * against an optimum built from a subset of the slots would invent a deficit
 * that is really just the linebackers. `ungradedSlots` carries the count so
 * the UI can say which slots were left out instead of quietly excluding them.
 */
export type LedgerWeek = {
  week: number;
  /**
   * Sleeper's official total for the week, over every slot including the ones
   * this model cannot grade. This is the number that decided the game, so it
   * is the number the result is read from.
   */
  officialPoints: number;
  /** optimalPoints - setPoints for the week, floored at zero. */
  pointsLeft: number;
  /**
   * The opponent's official score, when the week paired this roster with one.
   * Null for a bye or an unpaired roster, which is not a zero: an unpaired
   * week has no result to have gone either way.
   */
  opponentPoints: number | null;
  /**
   * How the week actually went. Null when there was no opponent, which is not
   * a loss: an unpaired week has no result to have gone either way.
   */
  outcome: LedgerOutcome | null;
  /**
   * Whether the BEST legal lineup would have won, compared against the
   * opponent's actual score exactly as it happened. Null when there was no
   * opponent.
   *
   * The comparison is deliberately one-sided: the opponent's lineup is left
   * alone. "What if we had both been perfect" is a different and much less
   * useful question, because the reader cannot set their opponent's lineup.
   */
  bestLineupOutcome: LedgerOutcome | null;
  /** The single biggest swap available that week, for the week-by-week table. */
  biggestMiss: LedgerMiss | null;
};

/**
 * What the grader works out about a week, before anything is thrown away.
 *
 * THE LINE THIS DRAWS is the one lib/league-activity/types.ts draws between an
 * event and a card. `GradedWeek` is everything the arithmetic produced;
 * `LedgerWeek` is the subset that is stored and rendered. The three extra
 * fields are load-bearing for the season roll-up and are what the tests assert
 * on, and nothing displays them per week, so they are computed and then dropped
 * rather than carried into a jsonb column that is serialized into the page's
 * Flight payload once per team per week.
 */
export type GradedWeek = LedgerWeek & {
  /** Actual points from the set lineup, over gradable slots only. */
  setPoints: number;
  /** Actual points from the best legal lineup, over the same slots. */
  optimalPoints: number;
  /** Startable slots this model could not grade (IDP and anything unknown). */
  ungradedSlots: number;
};

/**
 * One player who should have started ahead of one who did.
 *
 * Names and points only. The player IDS and the incoming position were carried
 * here at first and rendered nowhere, and this shape is repeated up to eighteen
 * times per team in a payload that crosses to the browser. Add an id back the
 * day something links to a player, not before.
 */
export type LedgerMiss = {
  inName: string;
  inPoints: number;
  /** Null when the slot was empty, which is a hole rather than a person. */
  outPlayerId: string | null;
  outName: string;
  outPoints: number;
  /** inPoints - outPoints. Always positive, or the miss is not reported. */
  gain: number;
};

/** The lineup ledger for one roster across the settled part of a season. */
export type LineupLedger = {
  weeksGraded: number;
  setPoints: number;
  optimalPoints: number;
  pointsLeft: number;
  /** setPoints / optimalPoints. Null when nothing gradable has happened yet. */
  efficiency: number | null;
  /** Record as it actually stands, over graded weeks only. */
  actualRecord: LedgerRecord;
  /** Record the best legal lineup would have produced, same opponents. */
  bestLineupRecord: LedgerRecord;
  /**
   * Games lost that the best legal lineup out of the same roster would have
   * won. THE headline number of this feature, and a count of real games rather
   * than a modelled quantity.
   */
  winsLeftOnBench: number;
  /** Weeks in which at least one startable slot could not be graded. */
  weeksWithUngradedSlots: number;
  weeks: LedgerWeek[];
};

export type LedgerRecord = { wins: number; losses: number; ties: number };

/** A settled head-to-head result. A draw is its own outcome, never a loss. */
export type LedgerOutcome = "win" | "loss" | "tie";

/** One acquisition off waivers or free agency, graded by what followed. */
export type WaiverMove = {
  transactionId: string;
  week: number;
  playerId: string;
  name: string;
  position: LedgerPosition | null;
  /** FAAB spent, from the Sleeper payload. Null in a league with no budget. */
  bid: number | null;
  /** Points scored while on this roster, from the week of the claim onward. */
  pointsOnRoster: number;
  /** Of those, the points scored from a starting slot. */
  pointsStarted: number;
  /** Weeks the player was in this roster's starting lineup after the claim. */
  weeksStarted: number;
};

export type WaiverLedger = {
  moves: number;
  /** Moves whose player started at least once afterward. */
  hits: number;
  faabSpent: number | null;
  pointsOnRoster: number;
  pointsStarted: number;
  /** pointsStarted / faabSpent. Null when the league runs no FAAB. */
  pointsPerDollar: number | null;
  /** Strongest first, capped for storage. */
  best: WaiverMove[];
};

/** One trade, from one side's point of view. */
export type TradeMove = {
  transactionId: string;
  week: number;
  receivedIds: string[];
  receivedNames: string[];
  sentIds: string[];
  sentNames: string[];
  /** Points the received players scored for this roster afterward. */
  pointsIn: number;
  /** Points the sent players scored for their new roster afterward. */
  pointsOut: number;
  /** pointsIn - pointsOut. Positive means the trade fed this roster more. */
  net: number;
  /** Draft picks changed hands. This model does not price them. */
  involvedPicks: boolean;
};

export type TradeLedger = {
  trades: number;
  pointsIn: number;
  pointsOut: number;
  net: number;
  /** True when any trade in the ledger moved a pick, driving the footnote. */
  anyPicks: boolean;
  moves: TradeMove[];
};

/** One draft pick, graded by the player's production in this league. */
export type DraftMove = {
  pickNo: number;
  round: number;
  playerId: string;
  name: string;
  position: LedgerPosition | null;
  /**
   * Points the player scored in this league, for ANYONE, over graded weeks.
   *
   * Deliberately not "points for the drafting roster". The draft decision was
   * "take this player"; what happened to him afterward belongs to the trade
   * ledger. Charging a good pick to nothing because he was later traded would
   * count the same decision twice, once in each direction.
   */
  points: number;
  /** Mean points of every player taken in the same round of this draft. */
  roundBaseline: number;
  /** points - roundBaseline. */
  aboveBaseline: number;
};

export type DraftLedger = {
  picks: number;
  points: number;
  aboveBaseline: number;
  /** Strongest and weakest, capped for storage. */
  best: DraftMove[];
  worst: DraftMove[];
};

/** Everything the model knows about one roster. */
export type LedgerTeam = {
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  lineup: LineupLedger;
  waivers: WaiverLedger;
  trades: TradeLedger;
  draft: DraftLedger;
  /** 1 is the most efficient lineup manager in the league. */
  efficiencyRank: number | null;
  /** 1 is the most starter points added off waivers. */
  waiverRank: number | null;
  /** 1 is the best points-in minus points-out across trades. */
  tradeRank: number | null;
  /** 1 is the most points above this draft's own round baselines. */
  draftRank: number | null;
  /**
   * 1 is the highest total points scored over graded weeks. The roster half of
   * the "good, lucky, or carried" split: a manager can rank first here and
   * last on efficiency, which is the single most useful thing this page says.
   */
  scoringRank: number | null;
};

/** The whole computed answer for one league season. */
export type LedgerResult = {
  season: number;
  /** Settled weeks the model graded, ascending. */
  gradedWeeks: number[];
  /** Startable slot tokens the model could grade. */
  gradableSlots: string[];
  /** Startable slot tokens it could not, so the UI can name them. */
  ungradableSlots: string[];
  teams: LedgerTeam[];
};

/** Why a run produced nothing. Mirrors the Power Pulse / Positional WAR shape. */
export type LedgerSkip = { skipped: string };
