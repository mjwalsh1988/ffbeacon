/**
 * Manager Pulse: the shared shapes.
 *
 * WHAT THIS MEASURES
 *   Type a Sleeper handle. Get everything worth knowing about that person as a
 *   fantasy manager, drawn from several seasons of their public Sleeper
 *   history: what they win, how they draft, who they keep buying, what they
 *   overpay for, how fast they move, and how to approach them in a trade. One
 *   engine, two consumers: the /tools/manager-pulse page, and League Pulse
 *   Trade Ideas (section 8), which reads the compact tendency DTO only.
 *
 * THE RULES THIS FILE'S SHAPES ENCODE (docs/manager-pulse/manager-pulse-plan.md)
 *
 *   1. PURE ENGINE. Every module in lib/manager-pulse/ up through engine.ts
 *      takes plain data and returns plain data: no SupabaseClient, no fetch,
 *      no React import. These types are that plain data. Nothing here may
 *      carry a class instance, a client handle, or a promise.
 *
 *   2. DYNASTY AND REDRAFT NEVER POOL FOR A VALUE-PRICED FIGURE. A dynasty
 *      superflex trade and a redraft PPR trade are priced against different
 *      format configs, so their margins sit on different scales and an
 *      average across both has no unit. Every metric here is one of three
 *      kinds, and the wrapper type it uses is what declares which:
 *        - Scale-free, POOLABLE (win rate, championships, playoff rate,
 *          finish percentile, lineup efficiency, moves per week, draft reach
 *          in rounds): wrapped in `PoolableStat<T>`, which carries a combined
 *          `all` figure alongside the two per-type ones.
 *        - Scale-dependent, NEVER POOLED (every value-priced figure: trade
 *          margins, position appetite, age lean): wrapped in `PerTypeStat<T>`,
 *          which has no `all` slot at all. There is no combined number to
 *          compute, so the type does not offer one.
 *        - TYPE-EXCLUSIVE (dynasty pick trading, age lean, rookie-versus-
 *          veteran lean; redraft in-season churn as a share of roster): a
 *          plain nullable field, absent (null) in the game it does not apply
 *          to rather than shown as zero.
 *      `MetricKind` names which of the three a field is, for documentation
 *      and for anything that walks the report generically; the wrapper type
 *      actually used on the field is what enforces the rule at compile time.
 *
 *   3. NO LANGUAGE MODEL ANYWHERE IN THIS FEATURE. Every sentence in
 *      `ManagerNarrative` is a deterministic template citing a figure present
 *      elsewhere in the report. A null figure means the sentence does not
 *      fire. There is no free-text field anywhere in this file for a
 *      generated sentence to hide in.
 *
 *   4. THE TOKEN "WAR" APPEARS NOWHERE IN THIS DIRECTORY. Positional WAR is
 *      player-independent and reads no roster; everything in Manager Pulse is
 *      specific to one manager or one team, so it uses the vocabulary
 *      reserved for that: "points", "wins", "efficiency", "margin". Comments
 *      included, per lib/positional-war/naming.test.ts's own convention.
 *
 *   5. EVERY LIST CARRIES ITS OWN SAMPLE SIZE. A favourites list, a trade
 *      list, a league-season list: each ships beside a count field naming how
 *      much evidence produced it, because a list with three entries and a
 *      list with three hundred are not the same claim.
 */

import type { LeagueCategoryKey } from "@/lib/league-category";
import type { TradePosition } from "@/lib/trade-finder/types";
import type { ManagerPulseSettings } from "./default-settings";

export type { TradePosition };

/** Which league-type lens a report view is filtered to. */
export type LeagueLens = "all" | "dynasty" | "redraft";

/**
 * Which of the three metric buckets a figure belongs to. Declared for
 * documentation and generic tooling; the wrapper type on the field
 * (`PoolableStat`, `PerTypeStat`, or a bare nullable) is what actually
 * enforces the rule.
 */
export type MetricKind = "poolable" | "per-type" | "type-exclusive";

/** A figure that is safe to average across league types. */
export type PoolableStat<T> = { all: T | null; dynasty: T | null; redraft: T | null };

/** A figure priced in league value. There is deliberately NO `all`. */
export type PerTypeStat<T> = { dynasty: T | null; redraft: T | null };

/**
 * A Sleeper league-type bucket, reused rather than redefined. Best ball folds
 * into its parent for the lens (section 6.0): best ball is a lineup-setting
 * rule, not a different asset horizon, so a best-ball-dynasty league belongs
 * with dynasty for anything scale-dependent while still being distinguishable
 * in the sections that count it separately (the identity split in 6.1).
 */
export type ManagerLeagueCategory = LeagueCategoryKey;

/**
 * Fold the four-bucket Sleeper category down to the two-bucket lens.
 *
 * Best ball is a lineup rule (bench size, no waivers on some formats), not a
 * different asset horizon, so a best-ball-dynasty league prices and trades
 * exactly like dynasty and a best-ball-redraft league exactly like redraft.
 * Folding here keeps that single decision in one place rather than repeated
 * as an `||` at every call site.
 */
export function lensForCategory(key: ManagerLeagueCategory): "dynasty" | "redraft" {
  return key === "dynasty" || key === "best-ball-dynasty" ? "dynasty" : "redraft";
}

// ---------------------------------------------------------------------------
// 6.1 Header: who this is
// ---------------------------------------------------------------------------

export type ManagerIdentity = {
  sleeperUserId: string;
  handle: string;
  avatarUrl: string | null;
  /** Distinct seasons in which we found at least one league-season. */
  seasonsCovered: number;
  /** Total league-seasons found across every bucket, the header's one accent figure. */
  leagueSeasonsFound: number;
  splits: {
    dynasty: number;
    redraft: number;
    bestBallDynasty: number;
    bestBallRedraft: number;
  };
  /** The earliest season we can see this manager in. Null if none found. */
  firstSeasonSeen: number | null;
};

// ---------------------------------------------------------------------------
// 6.2 Results: aggregate record, finishes, championships
// ---------------------------------------------------------------------------

export type ManagerRecord = { wins: number; losses: number; ties: number };

/** Scale-free by construction (a rate, a percentile, a count), so every field pools. */
export type ManagerResults = {
  /** League-seasons contributing to this section, per lens. */
  sampleSize: PoolableStat<number>;
  record: PoolableStat<ManagerRecord>;
  winRate: PoolableStat<number>;
  championships: PoolableStat<number>;
  runnerUps: PoolableStat<number>;
  playoffRate: PoolableStat<number>;
  lastPlaceFinishes: PoolableStat<number>;
  /** Average finish as a percentile of league size, not a raw rank. */
  avgFinishPercentile: PoolableStat<number>;
  /** Average points-for rank within its own league-season, 0 (worst) to 1 (best). */
  pointsForRank: PoolableStat<number>;
  /** Average points-against rank within its own league-season, 0 to 1. */
  pointsAgainstRank: PoolableStat<number>;
};

// ---------------------------------------------------------------------------
// 6.3 Draft habits
// ---------------------------------------------------------------------------

/** Share of first-`earlyRoundCutoff`-round picks spent at each position. */
export type DraftPositionShape = Partial<Record<TradePosition, number>>;

/**
 * Whole-draft pace, as a fact about the ROOM, never attributed to a manager.
 * See section 2.3A: "Their drafts run at 42 seconds a pick on a 120 second
 * clock" is a sentence about the drafts this manager has sat in, not a
 * personal stat, and it is never ranked against other managers.
 */
export type DraftPaceFact = {
  secondsPerPick: number;
  /** Share of the allowed clock the room used, from settings.pick_timer. */
  clockShareUsed: number;
  draftsObserved: number;
};

/** Real per-pick timing from draft_pick_observations. Empty until first live capture. */
export type DraftClockFact = {
  medianSeconds: number;
  /** The poll interval at capture time, stated as the error bar. */
  errorBarMs: number;
  sampleSize: number;
};

export type AutopickFact = {
  rate: number;
  draftsObserved: number;
};

export type ManagerDrafting = {
  /** Average pick number minus market ADP, in rounds. Positive = earlier than market. */
  reachIndexRounds: PoolableStat<number>;
  reachIndexSampleSize: PoolableStat<number>;
  firstRoundsShape: PoolableStat<DraftPositionShape>;
  firstRoundsSampleSize: PoolableStat<number>;
  /** Positive means more rookies than veterans in dynasty startups. Dynasty only. */
  rookieVeteranLean: number | null;
  rookieVeteranLeanSampleSize: number;
  /** Share of roster spots filled by keepers, in leagues that carry keepers. */
  keeperUsageRate: number | null;
  keeperUsageSampleSize: number;
  /** Grades come from lib/on-the-clock/draft-grade.ts. This section aggregates them, never regrades. */
  avgDraftGrade: PoolableStat<number>;
  avgDraftGradeSampleSize: PoolableStat<number>;
  draftPace: DraftPaceFact | null;
  perPickClock: DraftClockFact | null;
  autopick: AutopickFact | null;
};

// ---------------------------------------------------------------------------
// 6.4 Who they like
// ---------------------------------------------------------------------------

export type PlayerExposure = {
  playerId: string;
  name: string;
  position: TradePosition | null;
  /** Weighted by acquisition method: early draft counts most, waiver least, trade-in counts. */
  exposureScore: number;
  leagueSeasonsRostered: number;
  /** How commonly this player is rostered across every league in our database, for context. */
  leagueWideRosterRate: number;
};

export type RepeatDraftEntry = {
  playerId: string;
  name: string;
  timesDrafted: number;
};

export type ManagerAffinity = {
  favourites: PlayerExposure[];
  favouritesSampleSize: number;
  /** Only players who had opportunity: available in leagues this manager played for minAvoidSeasons+. */
  avoids: PlayerExposure[];
  avoidsSampleSize: number;
  repeatDrafts: RepeatDraftEntry[];
  repeatDraftsSampleSize: number;
};

// ---------------------------------------------------------------------------
// 6.5 Trading
// ---------------------------------------------------------------------------

/**
 * The six outcomes a trade can land in, FROM THIS MANAGER'S SEAT.
 *
 * These are buckets, not Signal Check's own verdict sentence. That sentence
 * carries the margin inside it ("Side A wins by 22.7% of total trade value."),
 * so counting sentences produced one row per trade: a manager with 251 graded
 * trades got a 251-row "distribution" in which almost every count was 1, which
 * is a list of trades wearing a histogram's label. Bucketing by the margin the
 * report already holds is what makes it a distribution.
 *
 * The two thresholds live in `wording` on the settings row, like every other
 * line between one word and another in this feature.
 */
export const TRADE_VERDICT_BUCKETS = [
  "clear_win",
  "slight_win",
  "even",
  "slight_loss",
  "clear_loss",
  "ungraded",
] as const;

export type TradeVerdictBucket = (typeof TRADE_VERDICT_BUCKETS)[number];

export type TradeVerdictCounts = Partial<Record<TradeVerdictBucket, number>>;

export type PositionAppetite = Partial<Record<TradePosition, number>>;

export type OverpayEntry = {
  /** A position slug or a player id, whichever the pattern was found at. */
  subject: string;
  subjectLabel: string;
  playerId: string | null;
  /**
   * Which of the two independent groupings produced this row.
   *
   * The card that renders these separates them, because they answer different
   * questions: a player row is a trade target ("they pay up for this man"),
   * and a position row is a standing habit ("they pay up for running backs").
   * Mixed into one list, a reader cannot tell a name from a category without
   * already knowing every player in the league.
   */
  kind: "player" | "position";
  /** The position, for a player row we could resolve one for, and for every
   *  position row. Drives the position chip on the card; never invented. */
  position: TradePosition | null;
  /** Negative means they habitually give up more than they get, priced at market. */
  avgMarginPct: number;
  sampleSize: number;
};

export type TradePartnerEntry = {
  sleeperUserId: string;
  handle: string | null;
  tradeCount: number;
};

/**
 * Which picks moved in, which moved out, and in which rounds.
 *
 * A single "picks traded" count cannot tell a manager who buys picks from one
 * who sells them, and those are opposite strategies: the first is rebuilding,
 * the second is going for it this year. It also cannot tell three firsts from
 * three fourths. `byRound` is ascending by round and holds only rounds that
 * actually moved, so a league that never trades past round four produces four
 * rows rather than a chart padded with zeroes.
 *
 * `acquired` and `sent` count every pick that moved, including the ones whose
 * round Sleeper did not publish, so they can legitimately exceed the sum of
 * `byRound`. `roundsKnown` states how many of them carried a round, which is
 * what stops the chart being read as the whole story.
 */
export type PickFlow = {
  acquired: number;
  sent: number;
  roundsKnown: number;
  /**
   * One row per round, ascending, capped at `display.pickRoundsShown`.
   *
   * A `round` of null is the TAIL: every round past the cap, summed into one
   * row, with `laterFromRound` naming where it starts. Nothing is dropped;
   * some leagues run drafts past round thirty and charting each of those
   * individually produced twenty-two rows, eighteen of them a single pick.
   */
  byRound: { round: number | null; acquired: number; sent: number }[];
  /** The first round folded into the tail row, or null when there is no tail. */
  laterFromRound: number | null;
};

export type ManagerTrading = {
  tradeCount: PoolableStat<number>;
  tradesPerSeason: PoolableStat<number>;
  /** From THIS manager's side. Never pooled: dynasty and redraft margins have no shared unit. */
  avgValueMargin: PerTypeStat<number>;
  avgValueMarginSampleSize: PerTypeStat<number>;
  verdictDistribution: PerTypeStat<TradeVerdictCounts>;
  /** Net value bought minus sold, per position. Never pooled, for the same reason as the margin. */
  positionAppetite: PerTypeStat<PositionAppetite>;
  /** Net value flow weighted by player age. Dynasty only; null in redraft. */
  ageLean: number | null;
  ageLeanSampleSize: number;
  picksTraded: PerTypeStat<number>;
  /** The same picks as `picksTraded`, split by direction and by round. */
  pickFlow: PerTypeStat<PickFlow>;
  mostTradedWith: PerTypeStat<TradePartnerEntry[]>;
  /** The intersection of a negative margin and enough sample to be a pattern. */
  overpays: PerTypeStat<OverpayEntry[]>;
  /**
   * The same computation with the sign flipped: subjects this manager comes
   * out AHEAD on. The mirror image of `overpays` and just as actionable, in
   * the opposite direction: an overpay is what to sell them, a bargain is what
   * they have historically bought well and you should think twice about
   * handing over cheaply.
   */
  bargains: PerTypeStat<OverpayEntry[]>;
  /** Trades that moved a pick the value source cannot price. Flagged, never dropped or zeroed. */
  tradesWithUnpricedPicks: PerTypeStat<number>;
};

// ---------------------------------------------------------------------------
// 6.6 Roster management
// ---------------------------------------------------------------------------

export type MoveShape = "front-loaded" | "steady" | "faded";

export type ManagerRosterOps = {
  movesPerWeek: PoolableStat<number>;
  moveShape: PoolableStat<MoveShape>;
  waiverClaimsPerSeason: PoolableStat<number>;
  /** Average bid as a share of budget. Null where the league runs no FAAB. */
  avgFaabBidShare: PoolableStat<number | null>;
  waiverPointsProduced: PoolableStat<number>;
  /** Read from league_manager_ledger_cache (section 4.4). Never computed here. */
  lineupEfficiency: PoolableStat<number>;
  /** League-seasons that actually had a ledger row to read. Never manufactured. */
  lineupEfficiencySampleSize: PoolableStat<number>;
  bestLineupRecord: PoolableStat<ManagerRecord>;
  winsLeftOnBench: PoolableStat<number>;
  /** League-seasons ending in several weeks of zero moves and an incomplete lineup. A count, not a judgement. */
  abandonmentCount: PoolableStat<number>;
};

// ---------------------------------------------------------------------------
// 6.7 How to deal with them
// ---------------------------------------------------------------------------

/**
 * One deterministic sentence. `sampleSize` is null only for a sentence with no
 * single governing sample (rare); every sentence that cites a rate or an
 * average carries the count that produced it, inline in the text as well as
 * here.
 */
export type NarrativeSentence = {
  /** Stable id naming which template fired, for testing and for analytics. */
  templateId: string;
  text: string;
  sampleSize: number | null;
};

export type ManagerNarrative = {
  sentences: NarrativeSentence[];
};

// ---------------------------------------------------------------------------
// 6.8 League list
// ---------------------------------------------------------------------------

export type ManagerLeagueRow = {
  /** Our internal leagues.id, when we hold this league. Null otherwise. */
  leagueId: string | null;
  sleeperLeagueId: string;
  season: number;
  leagueName: string;
  /**
   * Sleeper's own league logo id, or null when the league has no image.
   * Decorative on screen: the league name is always beside it.
   */
  avatar: string | null;
  category: ManagerLeagueCategory;
  lens: "dynasty" | "redraft";
  teamCount: number | null;
  record: ManagerRecord;
  finish: number | null;
  champion: boolean;
  runnerUp: boolean;
  madePlayoffs: boolean;
  /** Whether this row can link to the League Pulse deep view. */
  hasLeaguePulseLink: boolean;
};

// ---------------------------------------------------------------------------
// The report container
// ---------------------------------------------------------------------------

/**
 * What the report could NOT measure, and why. Never silently absent: every
 * gap named here is a gap a reader would otherwise have to infer from a
 * missing number.
 */
export type ManagerReportLimits = {
  /** League-seasons found but dropped for exceeding maxLeaguesPerRun, most recent kept first. */
  leagueSeasonsSkipped: number;
  /** League-seasons with no league_manager_ledger_cache row, so lineup efficiency excludes them. */
  leagueSeasonsWithoutLedger: number;
  /** Seasons with zero draft_pick_observations rows, so per-pick timing has nothing to show. */
  seasonsWithoutDraftObservations: number;
};

export type ManagerReport = {
  identity: ManagerIdentity;
  results: ManagerResults;
  drafting: ManagerDrafting;
  affinity: ManagerAffinity;
  trading: ManagerTrading;
  rosterOps: ManagerRosterOps;
  narrative: ManagerNarrative;
  leagues: ManagerLeagueRow[];
  /** Whichever bucket holds more of the manager's league-seasons. The page's default ?lens=. */
  defaultLens: LeagueLens;
  window: { seasonFrom: number; seasonTo: number };
  counts: { leagueSeasons: number; dynasty: number; redraft: number };
  generatedAt: string;
  modelVersion: string;
  limits: ManagerReportLimits;
};

// ---------------------------------------------------------------------------
// Section 8.1: the compact cross-tool tendency DTO
// ---------------------------------------------------------------------------

/** The per-league-type half. Everything value-priced lives in here. */
export type TendencySlice = {
  tradeCount: number;
  tradesPerSeason: number;
  /**
   * Mean value margin from THIS manager's side, in PERCENT units (-4.2 means
   * four point two percent under market). Negative pays up. Signal Check's own
   * `marginPct` convention, carried through unchanged: every consumer reads it
   * as a percent, and the two settings written as shares
   * (`wording.marginDeadzone`, `wording.verdictClearMargin`) are converted at
   * the point of comparison rather than here.
   */
  avgValueMargin: number | null;
  /** Net value bought minus sold, per position. */
  positionAppetite: Partial<Record<TradePosition, number>>;
  /** Positive means they buy youth. Dynasty only; null in redraft. */
  ageLean: number | null;
  picksTraded: number;
  favouritePlayerIds: string[];
  avoidPlayerIds: string[];
  sampleSize: number;
  confidence: "low" | "medium" | "high";
};

export type ManagerTendency = {
  sleeperUserId: string;
  seasonsCovered: number;
  /** Scale-free and safe to read whatever league you are in. */
  overall: { leagueSeasons: number; winRate: number | null; lineupEfficiency: number | null };
  dynasty: TendencySlice | null;
  redraft: TendencySlice | null;
};

/**
 * The one accessor for reading a tendency. Returns null rather than falling
 * back to the other game's slice: a dynasty read of a manager only ever seen
 * in redraft is an absence, not an approximation.
 */
export function pickTendencySlice(
  tendency: ManagerTendency,
  category: ManagerLeagueCategory,
): TendencySlice | null {
  return tendency[lensForCategory(category)];
}

// ---------------------------------------------------------------------------
// Section 3.1: the service contract
// ---------------------------------------------------------------------------

/** One independently-loading, independently-caching slice of the report. */
export type ManagerSection =
  | "identity"
  | "results"
  | "drafting"
  | "affinity"
  | "trading"
  | "rosterOps"
  | "narrative"
  | "leagues";

/** Real, counted progress. Never a fraction bound to a timer. */
export type CaptureProgress = {
  runId: string;
  status: "pending" | "capturing" | "computing" | "complete" | "error" | "throttled";
  /** ISO, from manager_pulse_runs.requested_at. The clock's anchor. */
  requestedAt: string;
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  /** Linked jobs currently 'processing'. */
  leaguesProcessing: number;
  /**
   * How many pending jobs belonging to OTHER lookups were created before this
   * run's own oldest pending job. This is a measure of how busy the queue is,
   * NOT a position in a line: since migration 0263 the claim interleaves
   * owners round-robin rather than draining oldest-first, so a lower number
   * here does not mean this run's jobs are picked up sooner.
   */
  queueAhead: number;
  /** ISO of the newest updated_at across this run's jobs; null when it has none. */
  workerSeenAt: string | null;
  /** manager_pulse_live_reports.version for this run's subject; 0 when none. */
  partialVersion: number;
  detail: string | null;
};

export type GetManagerFootprintRequest = {
  /** One of handle or sleeperUserId is required. */
  handle?: string;
  sleeperUserId?: string;
  /** Window size in seasons, clamped to settings.capture bounds. */
  seasons?: number;
  /** How stale, in ms, a cached report may be before it is treated as absent. */
  maxAge?: number;
};

/** The full report. Never throws. */
export type ManagerFootprintResult =
  | { status: "ready"; report: ManagerReport; generatedAt: string; stale: boolean }
  | { status: "building"; progress: CaptureProgress }
  | { status: "not_found"; handle: string }
  | {
      status: "throttled";
      retryAfterSeconds: number;
      /** The league-season budget this hour, when the caller has it (MPS-T028, MPS-T045). */
      budgetUsed?: number;
      budgetTotal?: number;
    }
  | { status: "empty"; reason: "no_leagues" | "window_empty" }
  | { status: "error"; detail: string };

export type GetManagerTendenciesRequest = {
  /** Batched: a league has eleven of these. */
  sleeperUserIds: string[];
  minSample?: number;
};

/** Re-exported so a caller of the service never needs a second import for it. */
export type { ManagerPulseSettings };
