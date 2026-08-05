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

/** What the reader is trying to do. Weights the ranking; never fabricates data. */
export type TradeGoal =
  | "balanced"
  | "win-now"
  | "get-younger"
  | "add-picks"
  | "consolidate"
  | "add-depth";

export const TRADE_GOALS: { key: TradeGoal; label: string; blurb: string }[] = [
  {
    key: "balanced",
    label: "Best available",
    blurb: "Whatever helps most, however it helps.",
  },
  {
    key: "win-now",
    label: "Win now",
    blurb: "Points in the starting lineup this season, age be damned.",
  },
  {
    key: "get-younger",
    label: "Get younger",
    blurb: "Trade the age curve down without giving away the roster.",
  },
  {
    key: "add-picks",
    label: "Add picks",
    blurb: "Turn players into future draft capital.",
  },
  {
    key: "consolidate",
    label: "Consolidate",
    blurb: "Two good pieces for one better one.",
  },
  {
    key: "add-depth",
    label: "Add depth",
    blurb: "One big name for two starters.",
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
  /** Competitor / Mid Tier / Rebuilder. Null when the league has no Power Pulse. */
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
  acceptance: AcceptanceBand;
  /** Internal rank score. Exposed for tests and debugging, not for display. */
  score: number;
  /** One sentence naming the deal. */
  headline: string;
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
