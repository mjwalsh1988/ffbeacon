/**
 * Shared shapes for the Power Pulse engine.
 *
 * Power Pulse estimates expected competitive performance: how many games a team
 * should win from here. It is deliberately separate from the trade-value power
 * rankings. Draft picks contribute nothing, because a 2028 first cannot start
 * for you in week 4.
 */

/** Positions that can occupy a starting slot and that Sleeper projects. */
export type PulsePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export const PULSE_POSITIONS: PulsePosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Sleeper roster_positions slot tokens mapped to the positions that can fill
 * them. Unlike the value engine, Power Pulse DOES value K and DEF: they score
 * real points every week, and this is a scoring model rather than an asset
 * model. Bench, IR, and taxi slots are excluded by absence.
 */
export const PULSE_SLOT_ELIGIBILITY: Record<string, PulsePosition[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DST: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"],
  WR_TE: ["WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  WRRB_WRT: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  Q_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: [],
};

/** Slot tokens that never hold an active starter. */
export const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI", "NA"]);

/** One rostered player, resolved and ready to project. */
export type PulsePlayer = {
  playerId: string;
  sleeperId: string;
  name: string;
  position: PulsePosition;
  team: string | null;
  /** Sleeper injury_status, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /** Sleeper depth_chart_order, 1 = top of the position room. */
  depthOrder: number | null;
  /** Recency-weighted reliability multiplier from player_projection_accuracy. */
  reliability: number;
  /** How often this player met or beat their projection, 0 to 1. */
  beatRate: number | null;
  /** Weeks played over weeks projected, 0 to 1. */
  availability: number | null;
  /** Spread of actual over projected. Drives the variance model. */
  ratioStdev: number | null;
  /** True when this player sits on IR or the taxi squad and cannot start. */
  isInactive: boolean;
};

/** A player's projected output for one week, after every adjustment. */
export type PulseWeekProjection = {
  week: number;
  /** Projected points in the league's own scoring, fully adjusted. */
  points: number;
  /** Before opponent, reliability, and injury adjustments. Used for drivers. */
  rawPoints: number;
  /** Standard deviation of the weekly outcome. */
  sigma: number;
  /** NFL opponent for that week. Null when the player is on bye. */
  opponent: string | null;
  /** Opponent-strength multiplier applied, 1.0 when neutral. */
  opponentMultiplier: number;
};

/** Everything the engine knows about one player across the remaining season. */
export type PulsePlayerOutlook = {
  player: PulsePlayer;
  /** Keyed by week. A missing week is a bye or an unpublished projection. */
  byWeek: Map<number, PulseWeekProjection>;
};

/** One filled starting slot in a simulated lineup. */
export type LineupSlot = {
  /** The roster_positions token this slot came from. */
  slot: string;
  eligible: PulsePosition[];
  playerId: string | null;
  points: number;
  sigma: number;
};

/** A team's projected lineup for one week. */
export type WeekLineup = {
  week: number;
  slots: LineupSlot[];
  /** Sum of the optimal lineup's projected points. */
  optimalPoints: number;
  /** Combined standard deviation for the lineup. */
  sigma: number;
  /** Points from the lineup the manager actually has set, when known. */
  actualPoints: number | null;
  /** Players with a projection who did not make the optimal lineup. */
  benchedPoints: number;
};

/** One team, fully evaluated. */
export type TeamOutlook = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  players: PulsePlayerOutlook[];
  weeks: WeekLineup[];
  /** Mean projected points per remaining week. */
  meanPoints: number;
  /** Standard deviation of the weekly team score. */
  sigma: number;
  /** Optimal-lineup points a manager is currently leaving on the bench. */
  lineupPointsLost: number | null;
  /** Set lineup points over optimal lineup points, 0 to 1. */
  lineupEfficiency: number | null;
  /** Average reliability of the projected starters, weighted by their points. */
  reliability: number;
  /** Mean opponent projected points across remaining weeks. */
  scheduleStrength: number;
  /** Projected points lost if the single best starter at each position misses. */
  depthDropoff: number;
  /** Recent actual over expected, in-season only. Null before any games. */
  form: number | null;
  /** Per-position projected starter output per week. */
  positionPoints: Record<PulsePosition, number>;
};

/** One head-to-head week from league_matchups. */
export type ScheduleWeek = {
  week: number;
  /** sleeper_roster_id to opponent sleeper_roster_id. Missing = bye or unpaired. */
  opponents: Map<number, number>;
  isFinal: boolean;
};

/** Simulation output for one team. */
export type SimulationResult = {
  expectedWins: number;
  playoffOdds: number;
  byeOdds: number;
  titleOdds: number;
  lastPlaceOdds: number;
};
