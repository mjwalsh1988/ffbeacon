/**
 * Shared shapes for Trade Finder.
 *
 * Trade Finder answers one question: given everything we already know about a
 * league, what is the single best trade this team should go and offer right now?
 *
 * It shows ONE suggestion at a time. That is a product decision with a real
 * consequence for this file: the engine still ranks the whole field, because you
 * cannot know which deal is best without comparing it to the others, but the
 * surface reads `[0]` and the reader's pass is what advances the cursor. A list
 * of twenty trades is a research project. One trade is a decision.
 *
 * Everything here is plain data. The engine takes these objects and returns
 * these objects; it opens no connection and imports no React. The database read
 * that fills them lives in lib/trade-finder-data.ts, and the cross-league walk
 * lives in lib/trade-finder-cross-league.ts.
 */

import type { TeamStatusKey } from "@/lib/league-team-status";
import type { TradeQualityConfig } from "@/lib/trade-quality";
import type { PulseSnapshot } from "./pulse";
// Type-only. Nothing runtime from lib/manager-pulse may reach the finder
// engine; see lib/trade-finder/tendency.ts for the rule this import serves.
import type { ManagerTendency } from "@/lib/manager-pulse/types";
import type { TendencyThresholds } from "./tendency";

export type { PulseSnapshot } from "./pulse";

/**
 * Which question the ranking is answering: does this deal win me games, or does
 * it win me the trade?
 *
 * These are the two things a manager actually wants from a suggestion engine and
 * they routinely disagree, which is why picking one has to be the reader's call
 * rather than a weighting buried in a scoring function.
 *
 *   "contender" ranks on the lineup: projected points per week, and what those
 *   points are worth in games against the schedule still to play. Trade value
 *   still keeps a deal honest, it just stops deciding the order.
 *
 *   "value" ranks on what the pieces are worth in this league's format, from the
 *   reader's chosen source. Youth and draft capital count here too, because in a
 *   dynasty league they ARE value that has not been spent yet.
 *
 * A REDRAFT LEAGUE ONLY EVER GETS "contender". That follows from the league
 * rather than from a default we chose. Nothing carries past January, so a pile
 * of trade
 * value that does not score points on Sunday is worth exactly nothing, and the
 * reader is never asked a question whose other answer is wrong.
 */
export type TradeStrategy = "contender" | "value";

/**
 * The toggle's two options.
 *
 * The blurb is a phrase rather than a sentence because it rides inside the
 * control's accessible name, so it is heard on every arrow press. That is also
 * why the CONTENDER one says "only", and why the word is load-bearing: a deal
 * that costs lineup points is excluded rather than ranked lower, and that is
 * the fact which explains an empty panel. A reader who meets it here has met it
 * before they need it, rather than in a paragraph they may never tab to.
 */
export const TRADE_STRATEGIES: {
  key: TradeStrategy;
  label: string;
  blurb: string;
}[] = [
  {
    key: "contender",
    label: "Contender",
    blurb: "only deals that add points to your lineup, ranked by projected wins",
  },
  {
    key: "value",
    label: "Value",
    blurb: "ranks on what the pieces are worth, youth and picks included",
  },
];

const STRATEGY_KEYS = new Set<string>(TRADE_STRATEGIES.map((s) => s.key));

/**
 * The strategy actually in force, given the league.
 *
 * One function so the engine, the server action, the page's first paint and the
 * toggle itself can never disagree about what a redraft league is doing. A
 * second copy of "redraft means contender" is how a surface ends up rendering a
 * toggle the engine ignores.
 */
export function resolveStrategy(
  isDynasty: boolean,
  strategy?: TradeStrategy | string | null,
): TradeStrategy | null {
  // Not a default. A one-year league has no second answer, so the reader is
  // never offered the toggle and whatever arrived on the wire is discarded.
  if (!isDynasty) return "contender";
  // NULL, not "contender", when a dynasty caller has said nothing. Absent means
  // we have not been told, and the ranking then reads the team's own footing the
  // way it always did. Guessing "contender" here would quietly hand every
  // dynasty rebuilder a win-now shortlist on the strength of a missing field.
  return readTradeStrategy(strategy);
}

/** Coerce anything off the wire to a strategy, or null when it is not one. */
export function readTradeStrategy(raw: unknown): TradeStrategy | null {
  return typeof raw === "string" && STRATEGY_KEYS.has(raw)
    ? (raw as TradeStrategy)
    : null;
}

/**
 * What the reader is trying to do. Weights the ranking; never fabricates data.
 *
 * Each of these names a SHAPE of deal rather than a filter on what may appear in
 * it. "Obtain draft picks" means at least one pick has to come back, not that
 * nothing else may; a pick plus a receiver still counts, and so it should, since
 * refusing to name that deal would hide the best version of the thing the reader
 * asked for.
 */
export type TradeGoal =
  | "balanced"
  | "consolidate"
  | "split-assets"
  | "add-picks"
  | "get-younger";

/**
 * The five shapes, with the words the dropdown used to show.
 *
 * Trade Ideas no longer offers them: the reader picks a strategy, and the shape
 * of the package falls out of that rather than being chosen in advance. The
 * keys still drive the engine's shape constraints, so this list stays as the
 * one place that names them; the labels and blurbs have no production reader
 * today and are kept so that a surface which wants to offer a shape again does
 * not have to reinvent the wording.
 */
export const TRADE_GOALS: { key: TradeGoal; label: string; blurb: string }[] = [
  {
    key: "balanced",
    label: "Open to all trades",
    blurb: "any shape of deal",
  },
  {
    key: "consolidate",
    label: "Consolidate",
    blurb: "two or three pieces for one better player",
  },
  {
    key: "split-assets",
    label: "Split assets",
    blurb: "one good player for several with upside",
  },
  {
    key: "add-picks",
    label: "Obtain draft picks",
    blurb: "draft capital, alone or with players",
  },
  {
    key: "get-younger",
    label: "Get younger",
    blurb: "younger players and rookie picks",
  },
];

/**
 * A position group the reader can name on either side of a deal.
 *
 * Deliberately the same six keys lib/on-the-clock/position-colors.ts colours, so
 * a chip in the filter and a tag on an asset row are the same word in the same
 * hue. Anything a league does not roster is never offered as a choice; see
 * `availablePositions` on the Trade Ideas page.
 */
export type TradePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

/** Display order. Skill positions first, because that is what gets traded. */
export const TRADE_POSITIONS: TradePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const TRADE_POSITION_SET = new Set<string>(TRADE_POSITIONS);

/**
 * Coerce a raw position string to one of the six, or null.
 *
 * Sleeper says DST where we say DEF and PK where we say K, and a filter that
 * silently failed to match either would look like a broken control rather than
 * like a naming difference.
 */
export function readTradePosition(raw: unknown): TradePosition | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "DST") return "DEF";
  if (upper === "PK") return "K";
  return TRADE_POSITION_SET.has(upper) ? (upper as TradePosition) : null;
}

/** The spoken and written name of a group. "DEF" alone reads as an abbreviation. */
export const TRADE_POSITION_LABEL: Record<TradePosition, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  DEF: "Defense",
};

/**
 * The group as it appears inside a sentence, article and all.
 *
 * Separate from the label because the label is a heading ("Running back") and
 * this is prose ("You asked to bring in a running back"). Keeping one string for
 * both jobs is how a card ends up reading "bring in Running back".
 */
export const TRADE_POSITION_PHRASE: Record<TradePosition, string> = {
  QB: "a quarterback",
  RB: "a running back",
  WR: "a wide receiver",
  TE: "a tight end",
  K: "a kicker",
  DEF: "a defense",
};

/**
 * How many players may be pinned to ONE side of a search.
 *
 * Lives here so the control that collects them and the action that validates
 * them read the same number. Two copies of a limit is how a reader ends up
 * able to add a fifth chip that the server then silently drops, and the deal
 * that comes back is for a package they did not ask about.
 *
 * Four is past what anybody actually proposes. It is also where the cost
 * starts to matter: every pinned piece widens the currency pool and forces
 * the balancing search to carry a larger fixed side.
 */
export const MAX_NAMED_PLAYERS = 4;

/** Which side of a suggested deal an asset sits on, from the reader's view. */
export type Direction = "in" | "out";

/** Where a team sits on the compete-or-rebuild axis, as the engine reads it. */
export type TeamDirection = "win-now" | "balanced" | "rebuild";

export type FinderPlayer = {
  playerId: string;
  sleeperId: string | null;
  name: string;
  /** QB / RB / WR / TE / K / DEF. Anything else is dropped before this point. */
  position: string;
  team: string | null;
  /** Trade value in the league's own format, from the reader's chosen source. */
  value: number;
  /** False when no value row exists. Such a player is never used in a package. */
  hasValue: boolean;
  age: number | null;
  /**
   * Projected points per week under this league's literal scoring settings.
   * Null when Sleeper has published no projection, which makes the player
   * invisible to the lineup math but still tradeable on value.
   */
  projPoints: number | null;
  /** On IR or the taxi squad, so he cannot fill a starting slot this week. */
  isInactive: boolean;
};

export type FinderPick = {
  /**
   * Stable identity: "pick:2027:1:4", where the last part is the ORIGINAL
   * roster. Season and round alone are not an identity. One roster in a real
   * league holds nine different 2027 1sts, and keying on season and round
   * collapsed eight of them out of existence: the builder offered one, the
   * evaluator matched one, and the URL could only say one.
   */
  key: string;
  season: number;
  round: number;
  pickPosition: "early" | "mid" | "late" | "unknown";
  /**
   * Sleeper roster id of the team the pick ORIGINALLY belonged to.
   *
   * This is the field that makes a pick a pick. It decides which end of the
   * round the pick lands in (a bad team's 1st is an early pick and a contender's
   * is a late one), and it is what a manager actually asks about: "whose first?"
   * The team holding it is already known from the side of the trade it sits on.
   */
  originalRosterId: number;
  /** True when the holder is also the original owner. */
  isOwnPick: boolean;
  /** Original owner's Sleeper handle, for "via @handle". Null if unresolved. */
  originalOwnerHandle: string | null;
  /** Original owner's team name. The fallback when the handle is unknown. */
  originalTeamName: string | null;
  /**
   * True when the early/mid/late bucket came from a projected finish rather than
   * a published draft order. Drives the wording; never hidden, because an
   * estimate presented as a fact is the thing this codebase keeps refusing to
   * do.
   */
  positionEstimated: boolean;
  /** Full plain-text label: "2027 R1, early, via @handle". Feeds aria. */
  label: string;
  value: number;
  hasValue: boolean;
};

export type FinderTeam = {
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  /** Contender / Bubble / Rebuilder. Null when the league has no Power Pulse. */
  statusKey: TeamStatusKey | null;
  statusLabel: string | null;
  pulseRank: number | null;
  valueRank: number | null;
  /**
   * What Power Pulse says about this team's season: projected wins, playoff
   * odds, and how much one point a week of lineup is worth against the games
   * still to play.
   *
   * Null on a league Power Pulse has not scored. Every consumer treats that as
   * "we cannot say" rather than as zero, which is the difference between a
   * suggestion that admits what it does not know and one that invents a number.
   */
  pulse: PulseSnapshot | null;
  players: FinderPlayer[];
  picks: FinderPick[];
};

export type TradeFinderInput = {
  /** The reader's own Sleeper roster id. */
  myRosterId: number;
  teams: FinderTeam[];
  /** Startable slot tokens from the league's roster_positions. */
  startingSlots: string[];
  isDynasty: boolean;
  /** False for redraft, where no pick has a published value. */
  allowPicks: boolean;
  /**
   * Which question the ranking answers. See TradeStrategy.
   *
   * Optional, and resolved through `resolveStrategy` rather than read directly,
   * so a redraft league lands on "contender" whatever the caller passed and a
   * caller that has not thought about it lands on the reading that talks about
   * this season.
   */
  strategy?: TradeStrategy;
  /**
   * The SHAPE the deal has to take.
   *
   * No longer a control on Trade Ideas: the reader picks a strategy now, and the
   * five shapes were answering a different question from the one the toggle
   * asks. The constraint itself is unchanged and still honoured, so a caller
   * that wants a specific shape can still ask for one; the surface simply does
   * not, and leaving it out means "any shape".
   */
  goal?: TradeGoal;
  /**
   * Players locked onto the INCOMING side ("what would it take to get these?").
   *
   * Every one of them has to come back in the deal, which is what makes this a
   * package rather than a list of alternatives. A trade has exactly one other
   * side, so naming players from two different rosters describes a deal that
   * cannot happen; the engine says so through `notice` rather than returning an
   * empty panel with no reason attached.
   */
  targetPlayerIds: string[];
  /**
   * Players locked onto the OUTGOING side ("what does this package bring back?").
   *
   * Same contract on the other side: all of them leave together, and the engine
   * builds the return around the package rather than around each piece.
   */
  offerPlayerIds: string[];
  /**
   * Position groups the reader wants at least one of on the INCOMING side.
   *
   * Empty or absent means any. NAMED targets settle the incoming side on their
   * own and override this, for the same reason they override the goal: naming a
   * player is the more specific request, and applying both would ask for a deal
   * where the named quarterback is also a running back.
   */
  wantPositions?: TradePosition[];
  /**
   * Position groups the reader is willing to send at least one of.
   *
   * Same contract as `wantPositions`, on the other side, and overridden by
   * `offerPlayerIds` for the same reason.
   */
  givePositions?: TradePosition[];
  /** Deal fingerprints the reader has already passed on. */
  excludeKeys: string[];
  /**
   * Consolidation scoring, the same model Signal Check grades with.
   *
   * Without it, packages are balanced by addition alone, which is how a trade
   * tool ends up offering three bench pieces for somebody's starting back: the
   * numbers line up and nothing in the arithmetic notices that they should not.
   * Optional so tests and any caller that has not loaded settings still run, on
   * the published defaults.
   */
  quality?: {
    config: TradeQualityConfig;
    /** Top value in this league's format and source. Null falls back sanely. */
    poolMax: number | null;
  };
  /**
   * What we know about how each manager in this league actually trades, from
   * Manager Pulse. Keyed by rosterId. Absent for a manager we hold no cached
   * tendency for, which is read as "no opinion" and never as a neutral one.
   */
  managerTendencies?: Map<number, ManagerTendency>;
  /**
   * The three tendency thresholds an admin owns, read from
   * `manager_pulse_settings` by the CALLER and passed down.
   *
   * The engine is pure, so it cannot read the settings row itself. Threading
   * them through is what stops the same numbers living in two places and
   * eventually disagreeing: an admin who raises the sample floor expects Trade
   * Ideas to go quieter, not to keep talking on a copy of the old value.
   * Omitted, the published defaults apply.
   */
  tendencyThresholds?: Partial<TendencyThresholds>;
};

/** One asset as it appears on a rendered suggestion. */
export type SuggestionAsset =
  | {
      kind: "player";
      playerId: string;
      sleeperId: string | null;
      name: string;
      position: string;
      team: string | null;
      value: number;
      age: number | null;
      /** Projected points per week, when we have a projection. */
      projPoints: number | null;
    }
  | {
      kind: "pick";
      key: string;
      label: string;
      season: number;
      round: number;
      value: number;
    };

/** How likely the other manager is to engage, as a band rather than a number. */
export type AcceptanceBand = "likely" | "worth-asking" | "long-shot";

export const ACCEPTANCE_LABEL: Record<AcceptanceBand, string> = {
  likely: "Likely",
  "worth-asking": "Worth asking",
  "long-shot": "Long shot",
};

/** What a trade does to one team, measured the two ways that matter. */
export type SideImpact = {
  /** Trade value gained (positive) or given up (negative). */
  valueDelta: number;
  /**
   * Change in the optimal starting lineup, in points per week. Null when the
   * league has no projections loaded, which is not the same as zero.
   */
  lineupDelta: number | null;
  /**
   * Change in projected wins over the games still to play, estimated from the
   * lineup change against this team's own remaining schedule.
   *
   * Null when there are no projections, or when Power Pulse has not scored this
   * league, or when the season has no games left. An estimate, and described as
   * one wherever it is shown: the full simulation lives in the trade builder.
   */
  winsDelta: number | null;
  /** Value-weighted change in average age. Negative means younger. */
  ageDelta: number | null;
  /** Draft picks gained (positive) or given up. */
  pickCountDelta: number;
};

export type TradeSuggestion = {
  /** Stable fingerprint of this exact deal. Drives the pass list. */
  key: string;
  /** The team on the other side. */
  counterparty: {
    rosterId: number;
    teamName: string;
    ownerHandle: string | null;
    statusLabel: string | null;
    direction: TeamDirection;
  };
  /** What the reader receives. */
  incoming: SuggestionAsset[];
  /** What the reader sends. */
  outgoing: SuggestionAsset[];
  mine: SideImpact;
  theirs: SideImpact;
  /** |value gap| over the larger side, 0 to 1. Lower is fairer. */
  valueGap: number;
  /**
   * What the outgoing package is worth against the incoming one in quality
   * terms, where 1 is level. Under 1 means the reader is paying with pieces that
   * do not add up to the player they are asking for, however well the raw
   * numbers match. This is what the acceptance band reads.
   */
  qualityRatio: number;
  acceptance: AcceptanceBand;
  /** Internal rank score. Exposed for tests and debugging, not for display. */
  score: number;
  /** One sentence naming the deal. */
  headline: string;
  /**
   * Why this deal is in front of the reader at all.
   *
   * Distinct from `whyYou`, which describes the deltas once a deal exists. This
   * one answers the question a reader actually asks of a suggestion engine:
   * "why are you showing me this?" It names the shape they asked for, the hole
   * on their roster it fills, and what about the other team's situation put the
   * piece on the table. Across the portfolio surface it is the only thing that
   * explains why a deal came out of one league rather than another.
   *
   * Assembled from figures the engine already computed. Nothing here is a model
   * output and nothing is invented.
   */
  rationale: string;
  /** Why the reader should want it. */
  whyYou: string;
  /** Why the other manager might say yes. */
  whyThem: string;
  /**
   * Manager Pulse: what this counterparty's own trading history says, as its
   * own short lines separate from `whyThem`.
   *
   * Empty when there is no cached tendency for this manager, when the manager
   * reads null for this league's game type, or when every figure a tendency
   * could offer sits below `minSample` (see lib/trade-finder/tendency.ts):
   * "no data" and "data too thin to trust" both render nothing here rather
   * than a hedge. Per docs/manager-pulse-plan.md section 8.4, the reader sees
   * this as its own quiet line under the acceptance band, with a link to that
   * manager's full Manager Pulse report when a handle is available
   * (`counterparty.ownerHandle`).
   */
  tendencyNotes: string[];
  /**
   * The message to send the other manager, written to them.
   *
   * Deliberately carries none of `whyYou`: the person receiving it does not care
   * what the trade does for the sender, and telling them hands over the reason
   * to refuse.
   */
  pitch: string;
  /** Caveats that would otherwise make a number misleading. Often empty. */
  caveats: string[];
};

/**
 * Why a search came back with nothing, when the reason is the question rather
 * than the league.
 *
 * Only set when the engine could not run the search AS ASKED. An ordinary empty
 * result (the league genuinely holds no deal that balances) leaves this null,
 * because the surface already has good words for that and a machine reason
 * would be a worse version of them.
 */
export type TradeFinderNotice =
  | "targets-split"
  | "targets-missing"
  | "targets-unpriced"
  | "targets-unaffordable"
  | "offers-missing"
  /**
   * Deals existed and every one of them would have cost the reader points off
   * their starting lineup, so the contender floor turned them all away.
   *
   * This one is not a malformed question; it is the honest answer to a good one,
   * and it earns a notice because the alternative reads as a broken tool. A
   * redraft manager who is told "no trade to suggest" with a full league of
   * rosters in front of them assumes the search failed. Told that the search ran
   * and nothing on the board makes their Sunday better, they have their answer.
   */
  | "no-lineup-gain";

/** What a league returns to a surface: the best deal, plus what is behind it. */
export type TradeFinderResult = {
  suggestions: TradeSuggestion[];
  /** Counterparties the engine could actually evaluate. */
  consideredTeams: number;
  /** True when no projections were available, so lineup impact is unavailable. */
  lineupUnavailable: boolean;
  /** Set when the search could not run as asked. Null on an ordinary empty. */
  notice: TradeFinderNotice | null;
};
