/**
 * Shared shapes for Trade Ideas' impact model.
 *
 * Trade Finder answers "what should I offer". This answers the question a reader
 * asks next, and the one a builder has to answer for a trade nobody suggested:
 * what does this deal actually DO to my team?
 *
 * Two measurements, deliberately kept apart, because they routinely disagree and
 * the disagreement is the interesting part:
 *
 *   VALUE  what the assets are worth, in the league's format from the reader's
 *          chosen source. A rebuilding team wants this to go up.
 *   WINS   the optimal starting lineup, week by week against the real remaining
 *          schedule, run through the same Monte Carlo season Power Pulse uses.
 *          A contending team wants this to go up.
 *
 * A deal that adds value and costs wins is not a bad deal. It is a bad deal for
 * a contender and a good one for a rebuilder, and saying so is the whole point.
 *
 * Everything here is plain JSON so it crosses the server action boundary intact.
 */

import type { PulsePosition } from "@/lib/power-pulse/types";
import type { TeamStatusKey } from "@/lib/league-team-status";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";

/** Where a pick sits in its round, as draft_pick_values buckets them. */
export type PickSlot = "early" | "mid" | "late" | "unknown";

/** One asset in a proposed trade, as the client submits it. */
export type BuildAsset =
  | { kind: "player"; playerId: string }
  | {
      kind: "pick";
      season: number;
      round: number;
      pickPosition: PickSlot;
      /**
       * Sleeper roster id of the pick's ORIGINAL owner, which is what makes one
       * 2027 1st a different asset to another. Optional because every link
       * written before this field existed omits it, and those still resolve by
       * season and round the way they always did.
       */
      originalRosterId?: number;
    };

/**
 * A trade to evaluate.
 *
 * `incoming` and `outgoing` are from the READER's point of view: incoming is
 * what they receive, outgoing is what they send. Every downstream sign follows
 * from that, so a positive `valueDelta` on `mine` always means the reader gained
 * value, on every surface.
 */
export type TradeProposal = {
  myRosterId: number;
  theirRosterId: number;
  incoming: BuildAsset[];
  outgoing: BuildAsset[];
};

/** One asset, resolved and priced. */
export type ResolvedAsset =
  | {
      kind: "player";
      playerId: string;
      sleeperId: string | null;
      name: string;
      position: string;
      team: string | null;
      value: number;
      age: number | null;
      /** Projected points per week under this league's scoring. Null = unpublished. */
      projPoints: number | null;
      /** On IR or taxi, so they cannot fill a starting slot. */
      isInactive: boolean;
    }
  | {
      kind: "pick";
      key: string;
      /** Full plain-text label: "2027 R1 Early (via @handle)". */
      label: string;
      season: number;
      round: number;
      pickPosition: PickSlot;
      /** Who it came from. The fact that decides the slot and the one a manager
       *  asks about. */
      originalRosterId: number;
      isOwnPick: boolean;
      originalOwnerHandle: string | null;
      originalTeamName: string | null;
      /** True when the slot is our projection rather than a published order. */
      positionEstimated: boolean;
      value: number;
    };

/** What one remaining week looks like before and after the trade. */
export type WeekImpact = {
  week: number;
  opponentRosterId: number | null;
  opponentName: string | null;
  beforeMean: number;
  afterMean: number;
  /** afterMean minus beforeMean. */
  delta: number;
  winProbBefore: number | null;
  winProbAfter: number | null;
};

/** What the trade does to one team. */
export type TeamImpact = {
  rosterId: number;
  teamName: string;
  /**
   * Which band this team is in. The logic key, not the words: the words change
   * with the league type (Rebuilder in dynasty, Longshot in redraft) and the
   * reasons below have to branch on the band, not on what it is called.
   */
  statusKey: TeamStatusKey | null;
  /**
   * The band as prose, for sentences that put it after an indefinite article.
   * Null when the league has no Power Pulse.
   */
  statusLabel: string | null;
  /** Power Pulse rank in this league, before the trade. */
  pulseRank: number | null;

  valueBefore: number;
  valueAfter: number;
  valueDelta: number;
  /** Value-weighted change in average age. Negative means younger. */
  ageDelta: number | null;
  pickCountDelta: number;

  /** Optimal-lineup points per remaining week. Null when no projections exist. */
  lineupBefore: number | null;
  lineupAfter: number | null;
  lineupDelta: number | null;
  weeks: WeekImpact[];
  weeksImproved: number;
  weeksWorsened: number;
  /** Weeks an incoming player actually cracks the lineup, keyed by player id. */
  incomingStartWeeks: Record<string, number>;

  projectedWinsBefore: number | null;
  projectedWinsAfter: number | null;
  playoffOddsBefore: number | null;
  playoffOddsAfter: number | null;
  titleOddsBefore: number | null;
  titleOddsAfter: number | null;

  /** Per-position starter output per week, before and after. */
  positionBefore: Record<string, number>;
  positionAfter: Record<string, number>;

  incoming: ResolvedAsset[];
  outgoing: ResolvedAsset[];
};

/**
 * One reason this trade helps or hurts.
 *
 * Deliberately the same shape as PowerPulseDriver, so the same tone styling
 * renders both and a reader who has seen the Power Pulse drivers already knows
 * what a tone means here.
 *
 * `kind` is a stable key. It is what the tests assert on, and it is what lets a
 * surface decide to feature one reason without matching on prose.
 */
export type TradeReason = {
  kind: TradeReasonKind;
  /** The short line. Four or five words. */
  label: string;
  /** The sentence, with the number in it. */
  detail: string;
  tone: "good" | "bad" | "neutral";
};

export type TradeReasonKind =
  | "lineup-gain"
  | "lineup-loss"
  | "lineup-flat"
  | "starts-often"
  | "starts-rarely"
  | "swings-weeks"
  | "schedule-timing"
  | "odds"
  | "value-gain"
  | "value-loss"
  | "younger"
  | "older"
  | "picks-in"
  | "picks-out"
  | "depth-cost"
  | "fills-hole"
  | "direction-fit"
  | "direction-clash"
  | "grade"
  | "their-side";

/** Why a figure is missing, so a surface can say so rather than show a zero. */
export type ImpactGaps = {
  /** No weekly projections loaded, so lineup impact is unavailable. */
  lineup: boolean;
  /** No remaining regular-season games, so odds are unavailable. */
  simulation: boolean;
  /** Redraft, or no pick values published for this source. */
  picks: boolean;
};

/** The whole answer. */
export type TradeImpact = {
  mine: TeamImpact;
  theirs: TeamImpact;
  reasons: TradeReason[];
  /** Things that would make a number above misleading if left unsaid. */
  caveats: string[];
  /** Signal Check's second opinion on FF Beacon values. Null when unavailable. */
  grade: SuggestionGrade | null;
  gaps: ImpactGaps;
  /** Remaining regular-season weeks the lineup figures cover. */
  weeksConsidered: number;
  /**
   * Whether a roster carries forward. Age is a currency in a dynasty league and
   * a fact about a person in a one-year one, so the asset notes only spend it
   * where it buys something.
   */
  isDynasty: boolean;
  formatDisplay: string;
  sourceDisplay: string;
  pickSourceDisplay: string | null;
};

/** What the server action hands back. */
export type EvaluateTradeResponse =
  | { ok: true; impact: TradeImpact }
  | { ok: false; error: string; retryable?: boolean };

/** Positions the lineup model can fill. Re-exported so callers need one import. */
export type { PulsePosition };
