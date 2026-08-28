/**
 * Shared shapes for Would You Rather.
 *
 * TWO DTOs, AND THE LINE BETWEEN THEM IS THE GAME.
 *
 * `WyrRound` is what a reader is allowed to see BEFORE they vote: the trade,
 * the league it came from, and nothing else. No values, no verdict, no margin,
 * no winner. `WyrReview` is everything that is revealed after the vote lands.
 *
 * That split is enforced by where each one is built, not by discipline. The
 * round is rendered on the server and only its own fields cross the wire; the
 * review is assembled by the vote route and returned in that route's response,
 * AFTER the vote row is written. Passing the review down as a prop to a client
 * component would serialize it into the flight payload of the page, where a
 * reader could read the answer out of view-source before pressing a button.
 * That is the same trap the Signal Scout leaderboard rail had to be pulled back
 * out of, so it is worth naming here rather than rediscovering.
 *
 * NOBODY IS NAMED. The two managers are Team A and Team B everywhere: on the
 * page, in the Discord poll, and in every sentence of the review. The league's
 * own name is shown, and its format is shown, because those are what make the
 * trade readable. Sleeper display names, usernames, avatars and team names are
 * never loaded into these shapes at all, so there is nothing to leak.
 */

import type { FormatTag } from "@/lib/league-format-tags";
import type { BuilderView } from "@/lib/signal-check/builder-view";

export type WyrSide = "a" | "b";

/** Which pool of trades a round was drawn from. */
export type WyrTradeKind = "regular" | "startup";

/** One thing one side receives. */
export interface WyrAsset {
  /** Stable within a round: `${side}-${index}`. Used to join review data on. */
  key: string;
  kind: "player" | "pick";
  name: string;
  /** "RB, BUF" for a player; "Draft pick (early)" for a pick. */
  detail: string | null;
  /** Drives the headshot. Null for a pick and for an unmapped player. */
  sleeperId: string | null;
  /** Round number, for the pick glyph. Null for a player. */
  round: number | null;
  /**
   * Set when this asset moved as a dynasty STARTUP draft pick and became the
   * player taken at that seat. Both facts are shown, because the reader is
   * being asked to judge what actually changed hands.
   */
  startupPick: {
    /** The seat, as "1.04". */
    label: string;
    /** True when the seat is still open and the player is the ADP expectation. */
    simulated: boolean;
  } | null;
}

/** Everything a reader sees before voting. Nothing here hints at an answer. */
export interface WyrRound {
  tradeId: string;
  leagueName: string;
  season: number | null;
  week: number | null;
  /** Plain-language structural format, e.g. "12-team dynasty superflex PPR". */
  derivedLabel: string;
  /** Roster-shape chips: team count, Start N, SF, per-position counts. */
  formatTags: FormatTag[];
  /** Scoring chips: PPR, TEP, per-position bonuses. */
  scoringTags: FormatTag[];
  kind: WyrTradeKind;
  /** The startup draft season these picks belong to. Null on a regular trade. */
  startupSeason: number | null;
  /** "Agreed before the startup draft", when we know. */
  startupTimingLabel: string | null;
  /** When Sleeper recorded the trade, ISO. Rendered in Eastern. */
  tradedAt: string | null;
  sides: Record<WyrSide, WyrAsset[]>;
}

/** The community tally, split by where the votes came from. */
export interface WyrTally {
  a: number;
  b: number;
  total: number;
  /** Of the totals above, how many arrived through a Discord poll. */
  discordA: number;
  discordB: number;
  /** Rounded to a whole percent, and forced to sum to 100 when total > 0. */
  pctA: number;
  pctB: number;
}

/** Positional WAR for one traded player, in the league the trade happened in. */
export interface WyrWarNote {
  position: string;
  positionRank: number;
  structuralDemand: number;
  war: number;
  pointsAboveReplacement: number;
  projectedPointsPerWeek: number;
  replacementPointsPerWeek: number;
  weeksProjected: number;
  injuryStatus: string | null;
}

/** Value movement for one traded player. */
export interface WyrTrendNote {
  value: number | null;
  /** Null when the trends table says there is not enough history to claim one. */
  change30d: number | null;
  /** Overall rank today, derived from the rank 30 days ago and its change. */
  overallRank: number | null;
}

/** How one of the two teams is doing, right now, in its own league. */
export interface WyrTeamNote {
  side: WyrSide;
  record: { wins: number; losses: number; ties: number } | null;
  powerPulse: number | null;
  pulseRank: number | null;
  projectedWins: number | null;
  projectedLosses: number | null;
  playoffOdds: number | null;
  titleOdds: number | null;
  valueRank: number | null;
  /** Contender / Bubble / Rebuilder, or null when there is no Pulse rank. */
  statusLabel: string | null;
  /** One sentence saying why the team landed in that band. */
  statusReason: string | null;
  /** How many teams the ranks above are out of. */
  teamCount: number;
}

/** Everything revealed once the vote is in. */
export interface WyrReview {
  tradeId: string;
  /** The side this reader picked. */
  yourSide: WyrSide;
  /** True when the vote was already on record and this call changed nothing. */
  alreadyVoted: boolean;
  tally: WyrTally;
  /**
   * The full Signal Check read, exactly as /tools/signal-check would produce
   * it for the same trade in the same format. Null when Signal Check is off or
   * the league's format has no published values, in which case the review says
   * so rather than showing an empty card.
   */
  verdict: BuilderView | null;
  /**
   * One sentence comparing where the crowd landed against where Signal Check
   * landed. A deterministic template: every figure in it is on the same screen.
   */
  crowdVsModel: string | null;
  /** Keyed by WyrAsset.key. Absent for picks and unmapped players. */
  war: Record<string, WyrWarNote>;
  /**
   * Whether this LEAGUE has Positional WAR curves at all.
   *
   * A different fact from whether a given player is on one, and the UI needs
   * both: a league with no curves has one reason that applies to everybody in
   * the trade, while a league WITH curves that does not carry this player means
   * he sits past the depth it starts at his position, which is a real finding.
   *
   * Null when the admin has switched the Positional WAR block off, which is a
   * third thing again and must not be reported as either of the other two.
   */
  leagueHasWarCurves: boolean | null;
  /** Keyed by WyrAsset.key. */
  trends: Record<string, WyrTrendNote>;
  /** Null when the league has no Power Pulse rows yet. */
  teams: WyrTeamNote[] | null;
  /** Footnotes the verdict card carries: missing values, estimated picks. */
  notes: string[];
}

/** What the vote route returns. */
export type WyrVoteResponse =
  | { ok: true; review: WyrReview; guestVotesRemaining: number | null }
  | { ok: false; error: WyrErrorCode; guestVotesRemaining?: number | null };

export type WyrErrorCode =
  | "game_disabled"
  | "guest_play_disabled"
  | "guest_limit_reached"
  | "rate_limited"
  | "not_found"
  | "bad_request"
  | "pool_empty"
  | "server_error";

/** What the next-round route returns. */
export type WyrNextResponse =
  | { ok: true; round: WyrRound; guestVotesRemaining: number | null }
  | { ok: false; error: WyrErrorCode; guestVotesRemaining?: number | null };
