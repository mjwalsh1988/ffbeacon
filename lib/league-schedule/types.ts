/**
 * Shared shapes for the League Pulse Schedule section.
 *
 * Everything here is plain JSON: no Maps, no Dates, no class instances. The
 * schedule board and the matchup detail are both server components handing data
 * to client components, and anything that does not survive that boundary would
 * fail at render rather than at compile.
 *
 * The one rule that shows up in nearly every field below: A PROJECTION AND A
 * RESULT ARE NOT THE SAME KIND OF NUMBER, and neither is a zero. A player with
 * no published projection gets `null`, not `0`, because a zero looks like an
 * answer and would quietly drag a team total down. A week that has been played
 * carries `actual` and no projection; a week that has not carries the reverse.
 */

/** Position groups, in the order the matchup view renders them. */
export type SlotGroup =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "FLEX"
  | "SUPERFLEX"
  | "IDP"
  | "K"
  | "DEF";

/** One startable slot in a league, resolved for display. */
export type ScheduleSlot = {
  /** The raw roster_positions token: "RB", "SUPER_FLEX", "IDP_FLEX". */
  token: string;
  /** Short visible label: "RB", "SUPERFLEX", "W/T". */
  label: string;
  /** Spelled out for a screen reader: "wide receiver or tight end flex". */
  description: string;
  group: SlotGroup;
  /** False for IDP, which Sleeper publishes no projections for. */
  projectable: boolean;
  /** Index in the league's own slot order. Ties break on this, so RB1 stays above RB2. */
  order: number;
};

/** One player as the matchup view shows them. */
export type SchedulePlayer = {
  /** FF Beacon player uuid. Null when the roster holds a Sleeper id we cannot resolve. */
  playerId: string | null;
  sleeperId: string;
  name: string;
  position: string;
  /** NFL team code. */
  team: string | null;
  /** Sleeper injury_status, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /** NFL opponent that week, "SF". Null on a bye or when unpublished. */
  nflOpponent: string | null;
  /**
   * True when this player's team is at HOME that week, false on the road, null
   * when we could not find out.
   *
   * Null is a real third state and the UI has to respect it. Neither the weekly
   * projections nor the weekly stats carry a venue marker (both give `opponent`
   * as a bare code), so this comes from Sleeper's published season schedule, and
   * a failed or missing schedule fetch leaves it null. Printing "vs" on a null
   * would claim a home game for every road game, which is the reason the first
   * version of this feature printed no venue at all.
   */
  nflIsHome: boolean | null;
  /**
   * Opponent-strength multiplier applied, 1.0 when neutral. Null when the slot
   * is unprojectable or the player has no projection.
   */
  opponentMultiplier: number | null;
  /** How often this player met or beat their projection, 0 to 1. */
  beatRate: number | null;
  /** Weeks played over weeks projected, 0 to 1. */
  availability: number | null;
  /** Recency-weighted reliability multiplier. */
  reliability: number | null;
  /** Projected points in the league's own scoring, fully adjusted. Null = no opinion. */
  projected: number | null;
  /** Spread of the weekly outcome. Null alongside a null projection. */
  sigma: number | null;
  /** What they actually scored. Non-null only on a final week. */
  actual: number | null;
  /** True when the player sits on IR or the taxi squad. */
  isInactive: boolean;
};

/** One filled or empty slot on one side of a matchup. */
export type MatchupSlotEntry = {
  slot: ScheduleSlot;
  /** Null when the manager left the slot empty. */
  player: SchedulePlayer | null;
};

/** A swap the manager could make to score more that week. */
export type BenchUpgrade = {
  /** Who to start. */
  inPlayer: SchedulePlayer;
  /**
   * Who they replace, and in which slot. An unfilled slot is carried by a
   * stand-in named "an empty slot" whose every number is null, because filling
   * a hole is an upgrade and the panel that renders this puts the name straight
   * into a sentence.
   */
  outPlayer: SchedulePlayer;
  slotLabel: string;
  /** Projected points gained by this one swap, on its own. */
  gain: number;
  /**
   * True when the incoming player is on IR or the taxi squad, so starting them
   * needs a roster move first. Sleeper will not let you simply slot them in.
   */
  requiresMove: boolean;
};

/** One team's half of a matchup. */
export type MatchupSide = {
  sleeperRosterId: number;
  rosterRowId: string | null;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };
  /** Power Pulse rank in this league. Null when the cache has no row. */
  pulseRank: number | null;
  slots: MatchupSlotEntry[];
  /** Sum of the set lineup's projections. Excludes unprojectable slots. */
  projectedTotal: number | null;
  /** Combined spread for the set lineup. */
  sigma: number | null;
  /** What the side actually scored. Non-null only on a final week. */
  actualTotal: number | null;
  /**
   * The best legal lineup, for comparison against the set one. Graded on the
   * same basis as the week: actual points once the week is final, projections
   * before then. A settled week's retrospective has to be answered with results.
   */
  optimalTotal: number | null;
  /**
   * optimalTotal minus what the set lineup was worth on the same basis, floored
   * at zero. On a final week that reads "you left 12.4 points on your bench";
   * before then, "12.4 projected points are sitting on it".
   */
  pointsLeftOnBench: number | null;
  /** Best single swaps available, strongest first. */
  benchUpgrades: BenchUpgrade[];
  /** Filled slots with no projection available. Drives the honest-total footnote. */
  unprojectedSlots: number;
};

/** A whole matchup, both sides. */
export type MatchupView = {
  week: number;
  season: number;
  isFinal: boolean;
  /** True when this is the live NFL week, so numbers are still moving. */
  isCurrent: boolean;
  home: MatchupSide;
  /** Null when the roster is unpaired that week. */
  away: MatchupSide | null;
  /** Probability the home side outscores the away side. Null on a final week. */
  homeWinProb: number | null;
  /** True when the league publishes IDP slots we cannot project. */
  hasUnprojectableSlots: boolean;
};

/** One matchup as the week board and the team season list show it. */
export type ScheduleMatchup = {
  /** Sleeper's pairing key. Null when the roster is unpaired. */
  matchupId: number | null;
  week: number;
  isFinal: boolean;
  home: ScheduleMatchupSide;
  away: ScheduleMatchupSide | null;
  /** Probability the home side wins. Null on a final week or with no cache. */
  homeWinProb: number | null;
};

export type ScheduleMatchupSide = {
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };
  pulseRank: number | null;
  /** Actual points. Non-null only on a final week. */
  actual: number | null;
  /**
   * Projected points from the Power Pulse cache, which is the OPTIMAL lineup.
   * The same number the Power Pulse tab ranks on, so the two never disagree.
   */
  projectedOptimal: number | null;
  /** Spread that goes with projectedOptimal. */
  sigma: number | null;
  /**
   * Points the manager is leaving on the bench, from the Power Pulse cache.
   * Non-null on the CURRENT week only: the cache holds one figure per team,
   * graded against the lineup set right now, so it says nothing about week 11.
   */
  pointsLeftOnBench: number | null;
  /**
   * True when this side won a final week. False covers three different things,
   * so it is not enough on its own to label an outcome: a loss, a tie, and a
   * roster with no opponent. Check `ScheduleMatchup.away === null` for the bye
   * before falling through to "Tied".
   */
  won: boolean;
};

/** One week of the schedule. */
export type ScheduleWeekView = {
  week: number;
  isFinal: boolean;
  isCurrent: boolean;
  /** True when week >= the league's playoff_week_start. */
  isPlayoffWeek: boolean;
  matchups: ScheduleMatchup[];
};

/** A team, for the pickers and the insight panels. */
export type ScheduleTeam = {
  sleeperRosterId: number;
  rosterRowId: string;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  pulseRank: number | null;
  /** Remaining strength of schedule, opponent points per week. */
  sosPoints: number | null;
  /** 1 is the HARDEST remaining schedule. */
  sosRank: number | null;
};

/** Everything the schedule board renders from. */
export type ScheduleBoard = {
  season: number;
  currentWeek: number;
  playoffWeekStart: number;
  weeks: ScheduleWeekView[];
  teams: ScheduleTeam[];
  /** Weeks Sleeper never answered for. Non-empty means the slate is incomplete. */
  missingWeeks: number[];
  /** True when Sleeper has published no slate at all for this league. */
  noScheduleYet: boolean;
  /** True when no Power Pulse row exists, so projections are unavailable. */
  projectionsUnavailable: boolean;
};

/** One row of the strength-of-schedule panel. */
export type SosRow = {
  sleeperRosterId: number;
  teamName: string;
  /** Sleeper handle, shown under the name. Team names change; handles do not. */
  ownerHandle: string | null;
  /** Opponent points per remaining week. */
  remainingPoints: number | null;
  /** 1 is the hardest remaining schedule. */
  remainingRank: number | null;
  /** Average points scored by opponents already faced. Null before any games. */
  playedPoints: number | null;
  /** 1 is the hardest schedule so far. */
  playedRank: number | null;
};

/** One row of the luck panel. */
export type LuckRow = {
  sleeperRosterId: number;
  teamName: string;
  /** Sleeper handle, shown under the name. Team names change; handles do not. */
  ownerHandle: string | null;
  record: { wins: number; losses: number; ties: number };
  /** Wins if this team had played every other team every week. */
  allPlayWins: number;
  allPlayLosses: number;
  /** Real win rate minus all-play win rate. Positive means lucky. */
  luck: number;
  /** 1 is the luckiest. */
  luckRank: number;
  /** Rank by total points scored, 1 is the most. */
  pointsRank: number;
};

/** The closest and least close game in one week. */
export type WeekSpotlight = {
  week: number;
  closest: ScheduleMatchup | null;
  mismatch: ScheduleMatchup | null;
};

/** A run of consecutive weeks, with how hard it is. */
export type ScheduleStretch = {
  startWeek: number;
  endWeek: number;
  /** Average opponent projected points across the run. */
  opponentPoints: number;
};

/** How often two teams meet. */
export type HeadToHeadCount = {
  sleeperRosterId: number;
  opponentRosterId: number;
  opponentName: string;
  meetings: number[];
};
