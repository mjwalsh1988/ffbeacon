/**
 * What the pure engine is handed.
 *
 * The engine and every module under it takes PLAIN DATA. No SupabaseClient, no
 * fetch, no React. `load.ts` is the only file that talks to the database, and
 * this is the shape it produces. Five separate modules read from it (results,
 * drafting, affinity, trading, roster-ops), so it lives in its own file rather
 * than in any one of them.
 *
 * WHY THE INPUT IS FLAT AND PRE-JOINED
 * Every module wants the same handful of joins: this league-season, this
 * manager's roster in it, the transactions that touched that roster, the picks
 * they made. Doing those joins once here means the modules are arithmetic over
 * arrays, which is what makes them testable with a literal.
 *
 * WHY EVERY ROW CARRIES ITS CATEGORY
 * Dynasty and redraft never pool for a value-priced figure, and the cheapest way
 * to guarantee that is to make the league type impossible to lose. Every
 * league-season carries its `category`, and every derived row carries the
 * `sleeperLeagueId` plus `season` that identify which league-season it came
 * from, so a module can always ask.
 *
 * NULL IS NOT ZERO, ANYWHERE IN HERE
 * A missing ledger row, an unpriced pick, a league whose bracket we could not
 * read: all of them are null. A module that reads a null and writes a zero has
 * turned "we do not know" into "it was nothing", which is the single most
 * common way a report like this tells a confident lie.
 */

import type {
  ManagerLeagueCategory,
  ManagerPulseSettings,
  TradePosition,
} from "./types";

/* -------------------------------------------------------------------------- */
/* League-seasons                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One league, one season, from this manager's seat.
 *
 * `rosterId` is their Sleeper roster id IN THIS LEAGUE. It is not stable across
 * leagues and must never be used as an identity; `sleeperUserId` on the report
 * request is the identity.
 */
export type ManagerLeagueSeason = {
  /** Our internal leagues.id when we hold the league, null when we do not. */
  leagueId: string | null;
  sleeperLeagueId: string;
  season: number;
  leagueName: string;
  /**
   * Sleeper's own league logo id, or null when the league has no image.
   *
   * Lifted out of the raw Sleeper league object we already store verbatim in
   * `leagues.metadata`. There is no avatar column on `leagues` and none is to
   * be added: this is source data, so it lives in `metadata`.
   */
  avatar: string | null;
  category: ManagerLeagueCategory;
  /** Sleeper's own settings.type. 0 redraft, 1 keeper, 2 dynasty, 3 chopped. */
  sleeperLeagueType: number | null;
  teamCount: number | null;
  /** Startable slot tokens from roster_positions, bench and IR included. */
  rosterPositions: string[];
  /** True when the league runs FAAB rather than rolling waiver priority. */
  usesFaab: boolean;
  faabBudget: number | null;
  /** This manager's roster id in this league. Null if we could not match them. */
  rosterId: number | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number | null;
  pointsAgainst: number | null;
  /**
   * Final standing, 1 = first. Null when the season has not finished or when we
   * could not read a bracket. Never guessed from the regular season record: a
   * league with playoffs does not finish in points order.
   */
  finish: number | null;
  championRosterId: number | null;
  runnerUpRosterId: number | null;
  /** Roster ids that reached the playoff bracket, when we could read one. */
  playoffRosterIds: number[] | null;
  /** True once the regular season plus playoffs are over. */
  isComplete: boolean;
  /** Points-for rank of every roster in this league-season, 1 = most points. */
  pointsForRankByRoster: Record<number, number>;
  /**
   * Points-against rank of every roster, 1 = most points conceded.
   *
   * Reported, never framed as an achievement. A high points-against rank is bad
   * luck: it says the schedule sent this manager the week's best scores, not
   * that they did anything. It earns its place because a manager who reads
   * "middle of the table on points for, worst in the league on points against"
   * has learned something real about their season that the record alone hides.
   */
  pointsAgainstRankByRoster: Record<number, number>;
};

/* -------------------------------------------------------------------------- */
/* Players                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything the engine knows about one player, resolved once. */
export type ManagerPlayerFacts = {
  playerId: string;
  sleeperId: string | null;
  name: string;
  position: TradePosition | null;
  /**
   * Age in years at report time, from players.birth_date. Null when we hold no
   * birth date, which is common for fringe players and always means the age
   * lean simply excludes them rather than assuming a number.
   */
  age: number | null;
  /** Current market value in the league type's format. Null when unpriced. */
  marketValue: { dynasty: number | null; redraft: number | null };
  /** How commonly this player is rostered across every league we hold, 0 to 1. */
  leagueWideRosterRate: number | null;
};

/* -------------------------------------------------------------------------- */
/* Drafts                                                                     */
/* -------------------------------------------------------------------------- */

export type ManagerDraftFacts = {
  sleeperDraftId: string;
  sleeperLeagueId: string;
  season: number;
  category: ManagerLeagueCategory;
  /** "snake", "linear", "auction". */
  draftType: string | null;
  rounds: number | null;
  teams: number | null;
  /** Seconds per pick the room allowed, from settings.pick_timer. */
  pickTimerSeconds: number | null;
  /** Epoch ms. Both null on a draft we hold no timing for. */
  startedAtMs: number | null;
  lastPickedAtMs: number | null;
  totalPicks: number;
  /**
   * True when this is a dynasty STARTUP draft rather than a rookie draft.
   * Null when we cannot tell, which is not the same as false.
   */
  isStartup: boolean | null;
};

export type ManagerDraftPick = {
  sleeperDraftId: string;
  sleeperLeagueId: string;
  season: number;
  category: ManagerLeagueCategory;
  pickNo: number;
  round: number | null;
  playerId: string | null;
  sleeperPlayerId: string | null;
  /**
   * A keeper is carried at a slot the league's rules set, not chosen off the
   * board, so it is excluded from the reach index and from the round baselines.
   * Same rule the Manager Ledger's draft ledger holds.
   */
  isKeeper: boolean;
  /** Market ADP for this player in this format and season. Null when unknown. */
  marketAdp: number | null;
  /** Grade from lib/on-the-clock/draft-grade.ts. Never recomputed here. */
  grade: number | null;
  /** True when the player was a rookie in this season. Null when unknown. */
  wasRookie: boolean | null;
};

/** One measured observation from draft_pick_observations. */
export type ManagerPickObservation = {
  sleeperDraftId: string;
  pickNo: number;
  firstSeenAtMs: number;
  /** The poll interval when this pick was seen. Null means no elapsed time can be derived. */
  observationGapMs: number | null;
  /** Three states. Null means we could not read the autopicker list at all. */
  wasAutopick: boolean | null;
};

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

export type ManagerMoveKind = "waiver" | "free_agent" | "trade" | "commissioner";

/** One roster move that touched this manager. */
export type ManagerMove = {
  sleeperTransactionId: string;
  sleeperLeagueId: string;
  season: number;
  week: number | null;
  category: ManagerLeagueCategory;
  kind: ManagerMoveKind;
  createdAtMs: number | null;
  /** Player ids this manager took in. */
  addedPlayerIds: string[];
  /** Player ids this manager sent out or cut. */
  droppedPlayerIds: string[];
  /** FAAB spent by this manager on this move, when the league runs FAAB. */
  faabSpent: number | null;
  /** The league's FAAB budget at the time, for expressing a bid as a share. */
  faabBudget: number | null;
};

/**
 * One trade this manager was in, already graded.
 *
 * ABSOLUTE: the grade comes from the existing Signal Check pipeline
 * (lib/league-signal-check.ts analyzeLeagueTrades). Nothing in Manager Pulse
 * prices a trade itself. A second grader would let two pages disagree about the
 * same trade with nothing to say which is right.
 */
export type ManagerTrade = {
  sleeperTransactionId: string;
  sleeperLeagueId: string;
  season: number;
  week: number | null;
  category: ManagerLeagueCategory;
  createdAtMs: number | null;
  /** The other Sleeper user ids in this trade. */
  counterpartyUserIds: string[];
  /** Player ids this manager received. */
  incomingPlayerIds: string[];
  /** Player ids this manager gave up. */
  outgoingPlayerIds: string[];
  incomingPickCount: number;
  outgoingPickCount: number;
  /**
   * The ROUND of every pick that moved, one entry per pick, on each side.
   *
   * Sleeper publishes a round on every traded pick, and a count alone cannot
   * tell "traded away three firsts" from "traded away three fourths", which is
   * the difference between a manager selling their future and one clearing out
   * the back of a rookie draft. The arrays are parallel to the counts above
   * rather than replacing them: a pick whose round Sleeper did not publish is
   * still counted and simply contributes no round.
   */
  incomingPickRounds: number[];
  outgoingPickRounds: number[];
  /**
   * Signal Check's margin, SIGNED FROM THIS MANAGER'S SEAT. Positive means they
   * came out ahead at market. Null when the trade could not be graded, which is
   * a different thing from a margin of zero and must never be flattened to one.
   */
  marginPct: number | null;
  verdictLabel: string | null;
  /**
   * Value this manager received and gave up, at market, in the format this
   * league prices in. Both null when the trade could not be graded.
   */
  valueIn: number | null;
  valueOut: number | null;
  /**
   * True when the trade moved a pick the value source could not price. The
   * trade is still counted and its player side still graded; the flag is what
   * stops a reader treating the margin as the whole story.
   */
  hasUnpricedPick: boolean;
};

/* -------------------------------------------------------------------------- */
/* Settled results                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One league-season's manager ledger row, READ from league_manager_ledger_cache.
 *
 * ABSOLUTE: Manager Pulse never triggers a ledger compute. A league-season with
 * no row is simply absent from this array and is counted in the report's
 * `leagueSeasonsWithoutLedger` limit, so the page can say how much of the
 * manager's history the efficiency figure actually covers.
 */
export type ManagerLedgerFacts = {
  sleeperLeagueId: string;
  season: number;
  category: ManagerLeagueCategory;
  weeksGraded: number;
  lineupEfficiency: number | null;
  /**
   * Waiver figures, straight off the ledger row.
   *
   * `waiverPointsStarted` is the one the report leads on: points a claimed
   * player actually scored IN THE LINEUP. `waiverPointsOnRoster` counts him
   * while he sat on the bench too, which measures the claim rather than the
   * decision to start him, and reporting that as "what their claims produced"
   * would credit a manager for a player they never played.
   */
  waiverMoves: number | null;
  waiverHits: number | null;
  waiverFaabSpent: number | null;
  waiverPointsStarted: number | null;
  waiverPointsOnRoster: number | null;
  winsLeftOnBench: number | null;
  bestLineupWins: number | null;
  bestLineupLosses: number | null;
  bestLineupTies: number | null;
  efficiencyRank: number | null;
  scoringRank: number | null;
};

/**
 * Weekly move counts for one league-season, used for the season shape.
 * Index is the week number; a week with no moves is 0 and that zero is real.
 */
export type ManagerWeeklyMoves = {
  sleeperLeagueId: string;
  season: number;
  category: ManagerLeagueCategory;
  movesByWeek: Record<number, number>;
  /** The last week this league actually played, so a shape is measured over a real season. */
  lastWeekPlayed: number | null;
  /**
   * Weeks in which the manager started an incomplete lineup. Part of the
   * abandonment signal, and only meaningful alongside a run of zero moves.
   */
  weeksWithIncompleteLineup: number;
};

/* -------------------------------------------------------------------------- */
/* The whole input                                                            */
/* -------------------------------------------------------------------------- */

export type ManagerPulseInput = {
  sleeperUserId: string;
  handle: string;
  avatarUrl: string | null;
  window: { seasonFrom: number; seasonTo: number };
  settings: ManagerPulseSettings;
  /** Every league-season we captured, most recent first. */
  leagueSeasons: ManagerLeagueSeason[];
  /** Keyed by playerId. Every id referenced anywhere else resolves here or is skipped. */
  players: Record<string, ManagerPlayerFacts>;
  /** Sleeper user id to display handle, for naming trade partners. */
  handles: Record<string, string>;
  drafts: ManagerDraftFacts[];
  picks: ManagerDraftPick[];
  pickObservations: ManagerPickObservation[];
  moves: ManagerMove[];
  trades: ManagerTrade[];
  ledgers: ManagerLedgerFacts[];
  weeklyMoves: ManagerWeeklyMoves[];
  /** League-seasons found but dropped past maxLeaguesPerRun. A count, for the limits block. */
  leagueSeasonsSkipped: number;
};
