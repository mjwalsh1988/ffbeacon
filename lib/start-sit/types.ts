/**
 * Shared shapes for the start/sit engine (lib/start-sit/).
 *
 * The module answers one question: of these two to eight players, which K
 * should a reader start this week. It introduces NO new model. Every number
 * a StartSitProjection carries comes from a function that already exists and
 * is already used by Power Pulse, Lineups, FAAB and Trade Ideas:
 * projectPlayerWeek, reached through lib/projections/read.ts
 * loadAdjustedProjections, and winProbability from lib/power-pulse/math.ts
 * for the confidence figure. This module's job is to ask those functions the
 * start/sit question and say the answer in words.
 *
 * PROJECTION SOURCE CONTRACT. The source is resolved once, by
 * loadAdjustedProjections (which calls resolveProjectionSourceForWindow), for
 * the single-week window the board evaluates. Every label shown to a reader
 * ("Projections: Sleeper") is projectionSourceDisplay() of the resolved slug
 * carried on StartSitVerdict.projectionSource, never a hardcoded word and
 * never the no-argument currentProjectionSourceCached(), which answers a
 * different question. That slug is part of every cache key that outlives a
 * flip: the toughest-calls cache and the share image's cache key both carry
 * it, so a source switch cannot serve one engine's numbers under the other's
 * label for the life of a stale cache entry.
 *
 * A player with points null (bye, unpublished week, an unprojectable
 * position) is always benched and never counted toward K. This is the same
 * rule loadAdjustedProjections callers already follow elsewhere in the
 * product; a null is an absence, never a zero.
 *
 * THIS IS NOT A SLOT MODEL. The reader has already decided which lineup slot
 * they are filling (a flex decision between an RB and a WR is the ordinary
 * case), so ranking is the unconstrained top K of N by projected points. The
 * lineup optimiser in lib/power-pulse/lineup.ts solves a different problem
 * (fill every slot at once under PULSE_SLOT_ELIGIBILITY) and is not reused
 * here; inventing an "any position" token in that eligibility table just to
 * bypass its slot logic would defeat the point of having it.
 *
 * MAX_START_SIT_PLAYERS exists because every added player costs the same
 * reads a Beacon Breakdown side costs today: values, trends, rankings,
 * finishes, projections for the remaining season, accuracy, reliability
 * weeks, market, stats. Eight is also the point past which a row of player
 * cards stops being readable at any width. It is a named constant so the copy
 * that states the limit reads the same number the loader enforces.
 */

import type { PulsePosition } from "@/lib/power-pulse/types";
import type { GameEnvironment, EnvironmentTier } from "@/lib/nfl-game-environment";

export type { PulsePosition, GameEnvironment, EnvironmentTier };

/** Fewest players a comparison can hold. Below this there is nothing to compare. */
export const MIN_START_SIT_PLAYERS = 2;

/**
 * Most players a comparison can hold. Every added player costs a full Beacon
 * Breakdown side's worth of reads; this is the point past which the row of
 * cards stops being readable and the request stops being cheap. Copy that
 * states the limit reads this constant rather than a repeated literal.
 */
export const MAX_START_SIT_PLAYERS = 8;

/** Default value for ?start=K: how many of the N players the reader starts. */
export const DEFAULT_START_COUNT = 1;

/** One player entered into the comparison, before any week's numbers are attached. */
export type StartSitCandidate = {
  playerId: string; // players.id
  slug: string;
  sleeperId: string | null;
  name: string;
  position: PulsePosition; // QB RB WR TE K DEF; anything else is refused at load
  team: string | null;
  injuryStatus: string | null; // players.metadata.sleeper.injury_status
};

/**
 * One candidate's numbers for the selected week, under the resolved
 * projection source and the reader's format. Every field is nullable and a
 * null is read as an absence, never a zero: a bye week, an unpublished
 * projection, a defence rank with no split yet, a beat rate with too few
 * graded weeks, an environment with no line published yet.
 */
export type StartSitProjection = {
  playerId: string;
  week: number;
  points: number | null; // adjusted, under the resolved scoring; null = absent week (bye, unpublished)
  rawPoints: number | null;
  sigma: number | null;
  floor: number | null; // max(0, points - sigma)
  ceiling: number | null; // points + sigma
  opponent: string | null;
  opponentMultiplier: number | null;
  defenseRankVsPosition: number | null;
  beatRate: number | null;
  availabilityRate: number | null;
  weeksGraded: number;
  environment: GameEnvironment | null;
  environmentTier: EnvironmentTier | null;
  onBye: boolean;
  availability: "projected" | "out" | null; // player_weekly_projections.availability, verbatim
};

/**
 * How close the K-th starter is to the first benched player, as a word.
 * Thresholds live in lib/start-sit/confidence.ts: 0.65 and up is "clear",
 * 0.55 to 0.65 is "lean", under 0.55 is "toss-up", and a null confidence
 * (either side missing a sigma) is "unmeasured".
 */
export type StartSitCallLabel = "clear" | "lean" | "toss-up" | "unmeasured";

/** The computed answer for one board: who starts, who sits, and why. */
export type StartSitVerdict = {
  week: number;
  season: number;
  startCount: number;
  starters: string[]; // playerIds, descending points
  bench: string[]; // playerIds, descending points
  marginPoints: number | null; // starters[last].points - bench[0].points, among players who have points
  confidence: number | null; // P(starters[last] > bench[0]); null when either sigma is null
  callLabel: StartSitCallLabel;
  reasons: string[]; // deterministic templates, lib/start-sit/reasons.ts
  /**
   * The one-sentence verdict, role="status" on the board and the headline of
   * the share image (section 2.5 item 1, section 2.10). Built from
   * buildStartSitVerdictLine in lib/start-sit/reasons.ts, except when no
   * candidate has points for the week (every player on bye, out or
   * unprojected): then it says plainly there is nothing to compare rather
   * than printing an empty sentence.
   */
  verdictLine: string;
  projectionSource: string; // the resolved slug, for the label
};
