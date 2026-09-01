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

export type { PulseSnapshot } from "./pulse";

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
 * The blurb is read aloud on every arrow press, because it rides in the option
 * text rather than in a hint beside the control. That is the reason to keep it
 * to a phrase: it is heard five times while somebody makes one choice.
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
  goal: TradeGoal;
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
  | "offers-missing";

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
