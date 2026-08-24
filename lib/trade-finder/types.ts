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
  /** Stable key for fingerprinting: "pick:2027:1:mid". */
  key: string;
  season: number;
  round: number;
  pickPosition: "early" | "mid" | "late" | "unknown";
  /** "2027 1st", or "2027 1st (early)" when the slot is known. */
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
  /** Lock this player onto the incoming side ("what would it take?"). */
  targetPlayerId: string | null;
  /** Lock this player onto the outgoing side ("what can I get?"). */
  offerPlayerId: string | null;
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

/** What a league returns to a surface: the best deal, plus what is behind it. */
export type TradeFinderResult = {
  suggestions: TradeSuggestion[];
  /** Counterparties the engine could actually evaluate. */
  consideredTeams: number;
  /** True when no projections were available, so lineup impact is unavailable. */
  lineupUnavailable: boolean;
};
