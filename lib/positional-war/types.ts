/**
 * Shared shapes for the Positional WAR engine.
 *
 * Positional WAR answers "how scarce is this position in this league". It is
 * PLAYER-INDEPENDENT: every player is evaluated against a league-average
 * reference team and a league-average opponent, and the model reads no roster.
 * That is what makes a curve shareable between two leagues with identical
 * settings, and it is what stops a trade from moving a scarcity curve.
 *
 * It is deliberately NOT the same metric as projected wins. Projected wins is
 * team-specific: it asks what a move does to ONE roster, through the season
 * simulation, and it lives in lib/power-pulse/what-if.ts and
 * lib/faab/marginal.ts. The two numbers legitimately disagree, and that
 * disagreement is the point. A league where QB1 carries 0.65 Positional WAR
 * still gives a reader who already starts QB2 almost no wins added by
 * acquiring him.
 *
 * NAMING RULE. The token "WAR" names exactly one metric in this product, the
 * player-independent positional one, and it carries the word "Positional"
 * adjacent to it on first use in any surface. Nothing that measures one
 * specific roster may be called WAR, in code, in copy, in a column name, or in
 * a chart axis.
 */

import type { PulsePosition } from "@/lib/power-pulse/types";

export type { PulsePosition };

/** One plotted player on one position's curve. */
export type WarCurvePoint = {
  playerId: string;
  /**
   * Stored because two consumers join a curve against rosters.player_ids, which
   * holds Sleeper ids: the team overlay and the Trade Ideas note. Nullable, so
   * a player with no Sleeper mapping still belongs on the curve; he simply can
   * never match a roster.
   */
  sleeperId: string | null;
  slug: string;
  name: string;
  team: string | null;
  /**
   * Sleeper's injury designation, verbatim. Null when healthy.
   *
   * Carried onto the curve because the overlay marks a player on IR or the
   * taxi squad rather than filtering him out: the model is player-independent,
   * so an injured RB1 still holds a real rank, and a reader who owns him wants
   * to see exactly that. A readout that named him without his designation
   * would contradict what every other surface in the product tells the same
   * reader about the same player.
   */
  injuryStatus: string | null;
  /** Rank within position by descending season WAR. 1 is the best. */
  positionRank: number;
  /** Season WAR, three decimals. Sum of the weekly win-probability differences. */
  war: number;
  /** Season points above replacement, one decimal. */
  pointsAboveReplacement: number;
  /** Mean over the weeks in the window for which a projection exists. */
  projectedPointsPerWeek: number;
  /** Mean replacement level over the window. */
  replacementPointsPerWeek: number;
  /** How many of the window's weeks he has a projection for. */
  weeksProjected: number;
};

/** Per-week diagnostics for one position, so the model is inspectable. */
export type WeeklyDiagnostic = {
  week: number;
  /** How many players at this position the merged fill seated that week. */
  seatedCount: number;
  /** Best benched player at this position that week. */
  replacement: number;
  /** Mean points of the seated players at this position that week. */
  avgSeated: number;
  /** max(0, avgSeated - replacement). The anti-double-count term. */
  deficit: number;
  /** League-average optimal lineup total that week. */
  muRef: number;
  /** League-average optimal lineup spread that week. */
  sigmaRef: number;
};

/**
 * Everything a SURFACE needs to draw or describe one position's curve.
 *
 * Split out from PositionCurve because every consumer of a curve, the chart
 * geometry, the OG card, the summaries, the overlay and the rail, needs
 * exactly these fields and none of them needs `weeklyDiagnostics`. The read
 * path (lib/league-positional-war-data.ts) therefore does not select that
 * column, and typing consumers against this rather than against PositionCurve
 * is what lets it not select it. A full PositionCurve is assignable here, so
 * the writer and the engine hand their values straight to the same functions.
 */
export type PlottableCurve = {
  position: PulsePosition;
  /**
   * How many players at this position this league starts, from the BYE-FREE
   * structural fill. An integer, not a fraction. Drives the x-axis, every
   * label, the depth cap, and every sentence of copy. Never the weekly count.
   */
  structuralDemand: number;
  /** Averaged across the window. */
  replacementPoints: number | null;
  avgSeatedPoints: number | null;
  deficit: number | null;
  /**
   * True when the projectable pool at this position is thinner than the league
   * starts, so replacement level fell back to the minimum seated points. Never
   * a fabricated zero: a zero replacement would hand every player at that
   * position an invented edge.
   */
  shallowPool: boolean;
  warRank1: number | null;
  /**
   * WAR of the player at positionRank === structuralDemand.
   *
   * Deliberately NOT zero. Replacement level is weekly and the axis is
   * structural, so the last player this league starts beats the weekly
   * replacement in most weeks and carries a small positive WAR. The chart marks
   * x = 1.0 with this real value rather than asserting a zero.
   */
  warAtDemand: number | null;
  /** First rank where WAR falls below cliffThreshold * warRank1. */
  cliffRank: number | null;
  curve: WarCurvePoint[];
};

/**
 * Everything STORED for one position in one league season: the plottable
 * fields plus the engine's per-week working. The diagnostics exist for
 * debugging a league's replacement level after the fact, so they are written
 * and kept; nothing renders them.
 */
export type PositionCurve = PlottableCurve & {
  weeklyDiagnostics: WeeklyDiagnostic[];
};

/** The league facts the engine needs. No roster, by design. */
export type WarLeagueInput = {
  season: number;
  /** Startable slot tokens for ONE team, from startingSlots(). */
  slots: string[];
  teamCount: number;
  fromWeek: number;
  toWeek: number;
};

/** One projectable player in the universe, with his week-by-week output. */
export type WarPlayerInput = {
  playerId: string;
  sleeperId: string | null;
  slug: string;
  name: string;
  team: string | null;
  position: PulsePosition;
  /** Sleeper's injury designation, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /**
   * Keyed by week. A missing week is a bye or an unpublished projection and
   * contributes nothing. It is never a zero: a zero would drag his average down
   * every bye and would sum into a total somebody believes.
   */
  byWeek: Map<number, { points: number; sigma: number }>;
};

/** The whole pure-function input to computeCurves(). */
export type WarInput = {
  league: WarLeagueInput;
  players: WarPlayerInput[];
  settings: {
    displayDepthMultiple: number;
    minDisplayDepth: number;
    cliffThreshold: number;
    clampBelowReplacement: boolean;
  };
};

/** What computeCurves() returns. */
export type WarResult = {
  curves: PositionCurve[];
  /** Positions this league starts but Sleeper does not project, for the footnote. */
  excludedSlots: string[];
};
