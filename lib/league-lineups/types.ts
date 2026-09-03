/**
 * Shared shapes for the League Pulse Lineups section.
 *
 * WHAT THIS SECTION IS FOR, AND HOW IT DIFFERS FROM SCHEDULES
 *   Schedules answers "who am I playing and what will that cost me": two teams,
 *   side by side, one matchup at a time. Lineups answers "am I starting the
 *   right nine people": ONE team, in depth, with the bench beside the starters
 *   and every number behind each of them.
 *
 *   The two share every primitive rather than each having their own. The slot
 *   list is lib/league-schedule/slots.ts alignedStartingSlots. The set lineup is
 *   lib/league-schedule/lineups.ts readSetLineup. The optimal fill is
 *   lib/power-pulse/lineup.ts buildOptimalLineup. Every projection is
 *   lib/power-pulse/project.ts projectPlayerWeek. So a player's projection on
 *   this page and the same player's projection on the matchup page are the same
 *   number by construction, not by two models happening to agree.
 *
 * `LineupPlayer` EXTENDS `SchedulePlayer` ON PURPOSE. The player detail dialog
 * (components/league-schedule/player-detail-dialog.tsx) already renders every
 * field of the smaller shape, so extending it means this section reuses that
 * dialog outright and adds its own rows rather than shipping a second one that
 * would drift.
 *
 * THE NULL RULE, INHERITED AND RESTATED: a projection and a result are not the
 * same kind of number, and neither is a zero. A player with no published
 * projection carries null, never 0, because a zero looks like a forecast of
 * nothing and would sum into a total. Every figure added here follows it:
 * Positional WAR, the implied team total and the beat rate are all null when we
 * do not hold them, and every surface says so in words.
 *
 * THE NAMING RULE (CLAUDE.md, Positional WAR): the token "WAR" names exactly
 * one metric, the player-independent positional one, and it carries the word
 * "Positional" adjacent to it on first use in any surface. `positionalWar`
 * below is that metric, read from `league_positional_war_cache`. Nothing in
 * this file measures one roster and calls itself WAR: the team-specific
 * quantities are `projected`, `pointsGained` and `pointsLeftOnBench`.
 */

import type { SchedulePlayer, ScheduleSlot, SlotGroup } from "@/lib/league-schedule/types";
import type { WeekStatus } from "./status";
import type { WeekRecap } from "./recap";
import type { GameEnvironment, EnvironmentTier } from "@/lib/nfl-game-environment";
import type { TeamStatus } from "@/lib/league-team-status";

/** Where a player is sitting on the roster right now. */
export type RosterSlotKind = "starter" | "bench" | "reserve" | "taxi";

/**
 * One player, with everything this section knows about him.
 *
 * Assignable to `SchedulePlayer`, so anything that renders one of those renders
 * one of these.
 */
export type LineupPlayer = SchedulePlayer & {
  /** Where he sits on the roster right now. */
  rosterSlot: RosterSlotKind;
  /**
   * The startable slot he currently occupies, "RB" or "W/T". Null on the bench,
   * on injured reserve and on the taxi squad.
   */
  startingSlotLabel: string | null;
  /** Index into the league's own slot order. Null unless he is starting. */
  startingSlotOrder: number | null;
  /**
   * Season Positional WAR from `league_positional_war_cache`, and his rank
   * within his position. Null when the curve has not been built for this
   * league, or when he is not on it.
   *
   * PLAYER-INDEPENDENT, and the UI must not present it as "what he is worth to
   * this team". It measures how scarce his position is and where he sits in it,
   * against a league-average reference roster that is not this one.
   */
  positionalWar: number | null;
  positionalWarRank: number | null;
  /** How many players at his position the curve holds, so "4th of 61" is sayable. */
  positionalWarPoolSize: number | null;
  /** His NFL game this week: total, spread, implied team total, venue. */
  environment: GameEnvironment | null;
  /** The band that implied total falls in, against the week's own average. */
  environmentTier: EnvironmentTier | null;
};

/** One startable slot with whoever is in it. */
export type LineupSlotEntry = {
  slot: ScheduleSlot;
  /** Null when the manager left the slot empty. */
  player: LineupPlayer | null;
};

/** A block of slots the page renders together: all the RB slots, all the flexes. */
export type LineupGroup = {
  group: SlotGroup;
  label: string;
  entries: LineupSlotEntry[];
  /** Sum of the projections in this block. Null when nothing in it is projected. */
  projected: number | null;
  /** How many filled slots in this block carry no projection. */
  unprojected: number;
};

/**
 * One swap the optimiser would make.
 *
 * These come from a single optimal fill, so unlike a list of independent
 * "biggest upgrade" suggestions they are internally consistent: applying all of
 * them at once produces exactly `optimalTotal`, and `pointsGained` sums to
 * `pointsLeftOnBench`. That is the whole reason the optimiser is run once and
 * diffed rather than asked one player at a time.
 */
export type LineupMove = {
  /** Who to start. */
  inPlayer: LineupPlayer;
  /**
   * Who comes out, and null when the slot was simply empty. Nullable here,
   * unlike lib/league-schedule/types.ts BenchUpgrade, because this section
   * writes the sentence itself and "Fill the empty FLEX with Waddle" reads
   * better than naming a stand-in player who does not exist.
   */
  outPlayer: LineupPlayer | null;
  slotLabel: string;
  slotDescription: string;
  /** Projected points this one move adds. Always positive. */
  pointsGained: number;
  /** True when the incoming player is on IR or the taxi squad. */
  requiresRosterMove: boolean;
};

/** The optimiser's verdict for one week. */
export type LineupOptimization = {
  /** What the lineup as set is projected to score. Null when nothing is projected. */
  setTotal: number | null;
  /** What the best legal lineup is projected to score. */
  optimalTotal: number | null;
  /** optimalTotal minus setTotal, floored at zero. */
  pointsLeftOnBench: number | null;
  /**
   * setTotal over optimalTotal, 0 to 1. Null when either is missing or the
   * optimum is zero. 1.0 means the lineup is already the best one available.
   */
  efficiency: number | null;
  /**
   * Every change worth listing, biggest gain first.
   *
   * FILTERED BY `MIN_MOVE_GAIN`, so this list can be empty while
   * `pointsLeftOnBench` is not zero, and the gains in it can sum to less than
   * that figure. `unlistedGain` carries the difference. A panel that showed the
   * gap and this list without the remainder would be printing two numbers that
   * do not reconcile and offering no reason.
   */
  moves: LineupMove[];
  /**
   * Points the optimiser found in swaps too small to be worth listing.
   *
   * Zero in the ordinary case. Non-zero means the lineup is close enough to
   * optimal that the remaining moves sit inside the model's own noise, which is
   * a different thing from being optimal and is said out loud rather than
   * rounded away.
   */
  unlistedGain: number;
  /**
   * Filled starting slots whose holder could not be graded on the same basis as
   * everyone else, so they are excluded from BOTH totals.
   *
   * Almost always zero. Non-zero means a roster is holding a Sleeper id our
   * players table has not caught up with, and the honest response is to leave
   * him out of the numerator and the denominator alike and say how many slots
   * that was, rather than to count him on one side and silently understate the
   * optimum on the other.
   */
  ungradedSlotCount: number;
  /**
   * True when the optimum could not be worked out at all (no projections
   * anywhere on the roster). Distinct from an empty `moves` list, which means
   * the lineup IS optimal, and the UI must not say the second when the first
   * is true.
   */
  unavailable: boolean;
};

/**
 * A player the roster could afford to lose.
 *
 * A LIST, NEVER A VERDICT, matching lib/faab/types.ts DropCandidate. The model
 * sees projected points and market value; it does not see the handcuff whose
 * stock just jumped, the rookie the manager is high on, or the player already
 * inside a trade. Naming one in a confident sentence reads as an instruction.
 */
export type DropOption = {
  player: LineupPlayer;
  /**
   * Rest-of-season projected points per week. Null when he has no projection
   * left at all, which is itself the strongest reason he is on this list.
   */
  restOfSeasonPerWeek: number | null;
  /** Market value in the league's own format, for the dynasty caution. Null when unpriced. */
  value: number | null;
  /** One plain line saying why he is here. Never an instruction. */
  note: string;
};

/** Why the free agent panel holds what it holds. See `LineupView.waiversState`. */
export type WaiverState = "ok" | "past-week" | "no-format" | "throttled";

/** Why a free agent is worth a look, framed by what this team is playing for. */
export type WaiverFit = "start-now" | "depth" | "upside";

export const WAIVER_FIT_LABEL: Record<WaiverFit, string> = {
  "start-now": "Starts this week",
  depth: "Bench depth",
  upside: "Worth stashing",
};

/** One available player worth naming. */
export type WaiverSuggestion = {
  player: LineupPlayer;
  fit: WaiverFit;
  /**
   * Projected points this week that he would add to the OPTIMAL lineup. Zero
   * when he does not crack it, and the copy says so rather than hiding him.
   */
  pointsAdded: number;
  /** Which slot he would take, when he cracks the lineup. */
  slotLabel: string | null;
  /** Overall rank in the reader's current format and source. */
  overallRank: number | null;
  /** One plain line saying why he is here, in this league, for this team. */
  note: string;
};

/** Everything the Lineups page renders from. */
export type LineupView = {
  season: number;
  week: number;
  /** The live NFL week, so the page can say whether it is showing it. */
  currentWeek: number;
  /** True when the week has settled, so actual points are the headline. */
  isFinal: boolean;
  /**
   * Upcoming, in progress, final or not settled, plus the words for it.
   *
   * WHAT THE PAGE IS FOR, not decoration. `showsAdvice` turns the optimiser,
   * the waiver panel and the cut list on; `showsResults` turns the report on
   * and makes actual points the headline figure on every row. See ./status.ts.
   */
  weekStatus: WeekStatus;
  /**
   * The settled week, graded. Null until there is a result to grade.
   *
   * One week only. Anything that spans a season is the Manager Ledger's and is
   * read from its cache rather than recomputed (see ./season-data.ts).
   */
  recap: WeekRecap | null;
  /** True when `week` is the live week. */
  isCurrent: boolean;
  /**
   * True when Sleeper has published no matchup row for this week, so the
   * lineup shown is the roster's CURRENT starters rather than a lineup set for
   * this particular week.
   *
   * Said out loud on the page rather than left to be discovered. Before the
   * slate exists, "your week 4 lineup" and "your lineup right now" are the same
   * thing; once week 4 is published they are not, and a page that quietly
   * showed one while labelling it the other would be wrong in a way a reader
   * could not see.
   */
  usedRosterFallback: boolean;
  sleeperRosterId: number;
  rosterRowId: string;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };
  /** Power Pulse rank in this league. Null when the cache has no row. */
  pulseRank: number | null;
  /** Contender / Bubble / Rebuilder, which frames every recommendation. */
  status: TeamStatus | null;
  /** The starters, grouped by position block, in the league's own slot order. */
  groups: LineupGroup[];
  /** Everyone not in a starting slot, best projection first. */
  bench: LineupPlayer[];
  /** On injured reserve. Cannot start without a roster move. */
  reserve: LineupPlayer[];
  /** On the taxi squad. Same. */
  taxi: LineupPlayer[];
  optimization: LineupOptimization;
  dropOptions: DropOption[];
  waivers: WaiverSuggestion[];
  /** What the whole set lineup actually scored. Non-null only on a final week. */
  actualTotal: number | null;
  /**
   * Sleeper's own running total for a week IN PROGRESS. Null otherwise.
   *
   * DELIBERATELY SEPARATE FROM `actualTotal`, which stays null until the week
   * settles because it is the number the retrospective is graded on. This one
   * is display only. Without it the summary card fell back to
   * `optimization.setTotal` on a live week, which `grade()` builds from
   * PROJECTIONS while `isFinal` is false, so the biggest number on the page sat
   * under the word "Scored so far" and was a forecast.
   *
   * Null when Sleeper has published no total yet, and the card says so rather
   * than substituting a projection for it.
   */
  liveTotal: number | null;
  /** True when the league runs slots we publish no projections for (IDP). */
  hasUnprojectableSlots: boolean;
  /** How many such slots, for the footnote. */
  unprojectableSlotCount: number;
  /** Filled slots with no projection, for the honest-total footnote. */
  unprojectedSlotCount: number;
  /** The week's mean implied team total, so a badge can say "above average". */
  environmentAverage: number | null;
  /** True when no betting line is published for this week at all. */
  environmentUnavailable: boolean;
  /**
   * True when the Positional WAR curve has not been built for this league, so
   * every `positionalWar` is null for a reason the UI can name.
   */
  positionalWarUnavailable: boolean;
  /**
   * Why the free agent panel holds what it holds.
   *
   * A STATE RATHER THAN AN EMPTY LIST, because four different things produce
   * no suggestions and only one of them means "nothing available helps you":
   *
   *   ok         the search ran. An empty `waivers` list then genuinely means
   *              the wire has been picked over.
   *   past-week  the week has been played. Nobody can be claimed for it.
   *   no-format  no value source covers this league's scoring, so there is no
   *              ranked universe to subtract the rosters from.
   *   throttled  the meter refused this render (./rate-limit.ts).
   *
   * The panel must never print the first sentence when one of the other three
   * is true. That is the same rule the Manager Ledger's empty state follows and
   * the reason it is a state and not a boolean.
   */
  waiversState: WaiverState;
  /**
   * "sleeper" or "ffbeacon". Rendered as attribution so a reader can tell which
   * projection engine produced the numbers on the page.
   */
  projectionSource: string;
  /**
   * Who this team plays this week, for the lineup what-if's win probability.
   *
   * Null when there is nobody to play or nothing to project them with. The
   * what-if still runs in that case and still reports the points; it simply has
   * no win probability to report, and says so.
   */
  opponent: LineupOpponent | null;
};

/**
 * The team on the other side of this week's matchup, and what they project to
 * score.
 *
 * `projected` and `sigma` come from `league_power_pulse_cache.weekly`, the same
 * rows lib/league-schedule/data.ts reads for the same matchup, so the Schedules
 * board and the lineup what-if cannot disagree about the opponent. That number
 * is their BEST lineup rather than the one they have set: we do not grade
 * somebody else's bench, and a reader cannot set it anyway.
 *
 * Null on the view when Sleeper published no matchup for the week, when the
 * roster is unpaired, or when Power Pulse has not been built for this league.
 * Every one of those is a real state and the panel names it rather than
 * printing a win probability out of nothing.
 */
export type LineupOpponent = {
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  /** Their projected points for this week. Null when the cache holds no week. */
  projected: number | null;
  /** The spread around it. Null alongside `projected`. */
  sigma: number | null;
  /** What they actually scored. Non-null only on a settled week. */
  actual: number | null;
};

/** Every team, for the picker. */
export type LineupTeamOption = {
  sleeperRosterId: number;
  rosterRowId: string;
  teamName: string;
  ownerHandle: string | null;
  /**
   * Carried so the picker's option text can read "Team name (6-2)".
   *
   * A select whose options are names alone gives a reader nothing to choose
   * on, and the record is the one fact that distinguishes twelve teams at a
   * glance. It costs nothing: loadRosters already reads these three columns.
   */
  record: { wins: number; losses: number; ties: number };
};
