/**
 * One roster, one week: the starters, the bench, and the best lineup available.
 *
 * Pure. Every roster row, projection row, accuracy row, defense split and
 * betting line arrives as plain data, so this file can be reasoned about and
 * tested without a database. lib/league-lineups/data.ts does the fetching.
 *
 * THE OPTIMISER IS RUN ONCE AND DIFFED. That is the whole design of this file,
 * and it is what makes it different from lib/league-schedule/matchup.ts, which
 * lists the best INDEPENDENT single swaps and says out loud that their gains do
 * not sum to the total. Both are correct for their own question. A matchup card
 * wants "the one move that helps most"; a lineup page wants "the set of moves
 * that gets you to the best lineup", and those are not the same list. Taking
 * the first independent swap changes what the second is worth, so a page that
 * printed four of them beside a headline gap would be printing five numbers
 * that do not add up.
 *
 *   buildOptimalLineup returns which player it seated in which slot. Comparing
 *   that assignment against the lineup the manager actually set gives a set of
 *   moves that IS internally consistent: apply all of them and you have exactly
 *   the optimal lineup, and the gains sum to exactly `pointsLeftOnBench`.
 *
 * SLOT INDICES ARE NOT INTERCHANGEABLE, and getting this wrong puts players in
 * the wrong rows. There are two slot lists in play:
 *
 *   - `alignedStartingSlots` (lib/league-schedule/slots.ts): every non-bench
 *     token including the IDP ones, positionally aligned to Sleeper's own
 *     `starters` array. This is the list the page renders and the set lineup is
 *     read against.
 *   - The PROJECTABLE subset of it, which is what buildOptimalLineup is given,
 *     because offering an IDP slot to the fill would let a running back take it.
 *
 * `projectableSlotIndex` below maps a position in the second list back to a
 * position in the first, so a move the optimiser makes in "projectable slot 4"
 * is reported against the slot the reader can actually see.
 *
 * EVERY PROJECTION GOES THROUGH lib/power-pulse/project.ts. There is no second
 * model here. If this page and the Power Pulse page ever printed different
 * numbers for the same player, one of them would be lying and a reader would
 * have no way to tell which.
 */

import type { ScoringSettings } from "@/lib/league-scoring";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { buildOptimalLineup, type LineupCandidate } from "@/lib/power-pulse/lineup";
import type { AccuracyRow, DefenseRow, PlayerRow, ProjectionRow } from "@/lib/power-pulse/load";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { SLOT_GROUP_LABEL, SLOT_GROUP_ORDER } from "@/lib/league-schedule/slots";
import { PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import type { ScheduleSlot, SlotGroup } from "@/lib/league-schedule/types";
import {
  environmentTier,
  type GameEnvironment,
  type GameEnvironmentWeek,
} from "@/lib/nfl-game-environment";
import type {
  LineupGroup,
  LineupMove,
  LineupOptimization,
  LineupPlayer,
  LineupSlotEntry,
  RosterSlotKind,
} from "./types";

/**
 * The smallest gain worth listing as a move.
 *
 * Same threshold and same reasoning as BENCH_UPGRADE_MIN_GAIN in
 * lib/league-schedule/matchup.ts: below half a point the swap sits inside the
 * model's own noise, and listing it invites a manager to churn a lineup for
 * nothing. Moves under it are still counted in `pointsLeftOnBench`, which comes
 * from the fill rather than from this list, so the total stays honest and only
 * the advice is filtered.
 */
export const MIN_MOVE_GAIN = 0.5;

/** One player's positional WAR, keyed by Sleeper id, from the curve cache. */
export type PositionalWarEntry = {
  war: number;
  rank: number;
  poolSize: number;
};

export type BuildLineupInput = {
  week: number;
  season: number;
  currentWeek: number;
  isFinal: boolean;
  /** Every non-bench slot, in Sleeper's own order. */
  slots: ScheduleSlot[];
  /**
   * Sleeper ids positionally aligned to `slots`. "0" and any non-string mean an
   * empty slot; the array is NEVER filtered, because dropping an entry shifts
   * every slot below it up by one.
   */
  setStarterIds: (string | null)[];
  /** Every rostered Sleeper id, IR and taxi included. */
  allPlayerSleeperIds: string[];
  reserveSleeperIds: string[];
  taxiSleeperIds: string[];
  /** Sleeper id to resolved player. */
  players: Map<string, PlayerRow>;
  /** FF Beacon player id to this week's projection row. */
  projections: Map<string, ProjectionRow>;
  accuracy: Map<string, AccuracyRow>;
  defense: Map<string, DefenseRow>;
  defenseSeasons: number[];
  scoringSettings: ScoringSettings | null;
  settings: PowerPulseSettings;
  /** Actual per-player points, from a settled week. Empty before then. */
  actualByPlayer: Map<string, number>;
  /**
   * Whether a player's actual points should be CARRIED at all.
   *
   * DELIBERATELY SEPARATE FROM `isFinal`, which is the GRADING switch and must
   * not move. A week in progress has real points on the board and the page
   * shows them, but the optimum, the gap and every move stay graded on
   * projections until the week settles: grading a Sunday afternoon against
   * partial scores would tell a manager they left forty points on the bench
   * because three of their starters play at four o'clock.
   *
   * False before kickoff even though Sleeper has published the matchup row,
   * because that row is all zeros until somebody scores, and a roster of 0.0s
   * presented as results is worse than no results.
   */
  actualsVisible: boolean;
  /**
   * The league's own official score for this roster this week, from
   * `league_matchups.points`. Null before the week settles.
   *
   * PREFERRED OVER RE-ADDING THE PER-PLAYER POINTS, for the same reason
   * CLAUDE.md gives for the Manager Ledger: the official number is the one on
   * the league's scoreboard, and a total rebuilt from parts can miss it by a
   * tenth and make the page look wrong about a result everybody already knows.
   * The per-player map is still what grades the BENCH comparison, because that
   * is a question the scoreboard does not answer.
   */
  officialActualTotal: number | null;
  /** Home and away for this season, keyed `${week}|${TEAM}`. Null means unknown. */
  homeAwayByTeamWeek: Map<string, boolean> | null;
  /** This week's betting lines, by team code. */
  environment: GameEnvironmentWeek;
  /** Positional WAR by Sleeper id. Empty when the curve is not built. */
  positionalWar: Map<string, PositionalWarEntry>;
};

/** Two decimals, the precision fantasy points are quoted at everywhere. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Four decimals, so a ratio rendered as a whole percent cannot round the wrong way. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** A real Sleeper id. "0" is the empty-slot placeholder, not a player. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

/**
 * Build every rostered player once, then answer every question off that map.
 *
 * Exported for the tests, and because `data.ts` needs the same map to project
 * a free agent on identical terms.
 */
export function buildLineupPlayer(
  input: BuildLineupInput,
  sleeperId: string,
  rosterSlot: RosterSlotKind,
  startingSlot: ScheduleSlot | null,
): LineupPlayer {
  const row = input.players.get(sleeperId);
  // `|| input.isFinal` is a fence, not a fallback. A settled week ALWAYS shows
  // results, so `actualsVisible` false beside `isFinal` true is a caller bug;
  // left unguarded it would make `grade()` return null for every player, empty
  // the candidate pool and report `unavailable: true` on a week we have every
  // number for, which is a silent wrong answer rather than a crash.
  const actual =
    input.actualsVisible || input.isFinal
      ? (input.actualByPlayer.get(sleeperId) ?? null)
      : null;

  const base = {
    sleeperId,
    rosterSlot,
    startingSlotLabel: startingSlot?.label ?? null,
    startingSlotOrder: startingSlot?.order ?? null,
    isInactive: rosterSlot === "reserve" || rosterSlot === "taxi",
  };

  // A roster can hold a Sleeper id we have no players row for. The slot still
  // renders, named as unknown, because dropping it would shift every slot below
  // it up by one and put ten other players in the wrong place.
  if (!row) {
    return {
      ...base,
      playerId: null,
      name: "Unknown player",
      position: "",
      team: null,
      injuryStatus: null,
      nflOpponent: null,
      nflIsHome: null,
      opponentMultiplier: null,
      beatRate: null,
      availability: null,
      reliability: null,
      projected: null,
      sigma: null,
      actual,
      positionalWar: null,
      positionalWarRank: null,
      positionalWarPoolSize: null,
      environment: null,
      environmentTier: null,
    };
  }

  const accuracy = input.accuracy.get(row.playerId) ?? null;
  const reliability = reliabilityMultiplier(accuracy, input.settings);
  const projection = input.projections.get(row.playerId);

  // Built with the model's own eligibility rather than the slot's: the question
  // is "can this player be projected at all", not "which slot is he sitting in".
  // A player parked in an IDP slot therefore carries a projection here and none
  // in his lineup cell, which is the right answer for both readers.
  const projected = projectPlayerWeek({
    projection,
    subject: { position: row.position, injuryStatus: row.injuryStatus },
    accuracy,
    reliability,
    scoringSettings: input.scoringSettings,
    defense: input.defense,
    defenseSeasons: input.defenseSeasons,
    week: input.week,
    currentWeek: input.currentWeek,
    settings: input.settings,
  });

  const teamCode = row.team ? row.team.toUpperCase() : null;
  const env: GameEnvironment | null = teamCode
    ? (input.environment.byTeam.get(teamCode) ?? null)
    : null;
  const war = input.positionalWar.get(sleeperId) ?? null;

  return {
    ...base,
    playerId: row.playerId,
    name: row.name,
    position: row.position,
    team: row.team,
    injuryStatus: row.injuryStatus,
    nflOpponent: projection?.opponent ?? null,
    // Sleeper's published schedule first, because that is the answer the
    // matchup pages already use and two surfaces disagreeing about a venue is
    // worse than one of them being silent. The odds row is the fallback: it
    // names a home and an away team outright, so when it exists it knows.
    nflIsHome:
      (teamCode && input.homeAwayByTeamWeek
        ? (input.homeAwayByTeamWeek.get(`${input.week}|${teamCode}`) ?? null)
        : null) ?? (env ? env.isHome : null),
    opponentMultiplier: projected ? projected.opponentMultiplier : null,
    beatRate: accuracy?.beatRate ?? null,
    availability: accuracy?.availabilityRate ?? null,
    reliability,
    projected: projected ? projected.points : null,
    sigma: projected ? projected.sigma : null,
    actual,
    positionalWar: war ? war.war : null,
    positionalWarRank: war ? war.rank : null,
    positionalWarPoolSize: war ? war.poolSize : null,
    environment: env,
    environmentTier: environmentTier(env?.impliedTotal ?? null, input.environment.average),
  };
}

/**
 * Where each PROJECTABLE slot sits in the full, aligned slot list.
 *
 * buildOptimalLineup is handed only the projectable tokens, so its result is
 * indexed against that shorter list. Reporting a move against the wrong index
 * is how "start Waddle in FLEX" becomes "start Waddle at LB".
 */
export function projectableSlotIndex(slots: ScheduleSlot[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i].projectable) out.push(i);
  }
  return out;
}

/** Group the starting slots into the blocks the page renders. */
export function groupStartingSlots(entries: LineupSlotEntry[]): LineupGroup[] {
  const buckets = new Map<SlotGroup, LineupSlotEntry[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.slot.group) ?? [];
    list.push(entry);
    buckets.set(entry.slot.group, list);
  }

  return SLOT_GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => {
    // Inside a block the league's own slot order decides, so RB1 stays above
    // RB2 in a league that lists them that way.
    const rows = (buckets.get(group) ?? []).sort((a, b) => a.slot.order - b.slot.order);
    let projected = 0;
    let projectedCount = 0;
    let unprojected = 0;
    for (const row of rows) {
      if (!row.player) continue;
      if (row.player.projected === null) {
        unprojected += 1;
        continue;
      }
      projected += row.player.projected;
      projectedCount += 1;
    }
    return {
      group,
      label: SLOT_GROUP_LABEL[group],
      entries: rows,
      projected: projectedCount > 0 ? projected : null,
      unprojected,
    };
  });
}

export type BuiltLineup = {
  groups: LineupGroup[];
  bench: LineupPlayer[];
  reserve: LineupPlayer[];
  taxi: LineupPlayer[];
  optimization: LineupOptimization;
  /** Every rostered player, by Sleeper id, for the callers that need one. */
  bySleeperId: Map<string, LineupPlayer>;
  actualTotal: number | null;
  unprojectedSlotCount: number;
  unprojectableSlotCount: number;
  /**
   * Exactly what was handed to `buildOptimalLineup`, and exactly what came
   * back.
   *
   * Exported so the free agent panel can measure a pickup against THIS
   * baseline rather than assembling its own. Rebuilding the candidate list at
   * a second call site is how the two quietly diverge: this one already
   * excludes IR, the taxi squad, anyone with no graded number, and anyone
   * currently sitting in a slot the fill is not allowed to use, and every one
   * of those exclusions would have to be remembered again. A "+4.2" measured
   * against a different baseline than the optimum on the same screen is a
   * number that cannot be checked.
   *
   * Empty and null respectively when there was nothing to fill.
   */
  fillCandidates: LineupCandidate[];
  fillTokens: string[];
  fillTotal: number | null;
  /**
   * The Sleeper ids the optimal fill actually seated.
   *
   * Exported because the cut list needs "who is starting in the best lineup"
   * and the MOVE LIST cannot answer it: moves are filtered by MIN_MOVE_GAIN, so
   * a player the fill seats by a third of a point is seated and unlisted at the
   * same time. Deriving the set from the moves left exactly that player
   * available to be offered as a cut on the same screen that was starting him.
   */
  optimalSleeperIds: string[];
};

/**
 * The whole lineup, built from plain data.
 *
 * `isFinal` switches the grading basis from projections to results everywhere
 * at once, exactly as lib/league-schedule/matchup.ts does: on a settled week
 * the optimum, the gap and every move are all built from what players ACTUALLY
 * scored, because "you left 18 points on your bench in week 3" is a claim about
 * a week that has been played, and answering it with the same projections that
 * were wrong enough to make the manager bench him is not an answer.
 */
export function buildLineup(input: BuildLineupInput): BuiltLineup {
  const reserve = new Set(input.reserveSleeperIds.filter(validPlayerId));
  const taxi = new Set(input.taxiSleeperIds.filter(validPlayerId));

  // Which slot, if any, each starter is currently sitting in. Built from the
  // POSITIONAL array, so an empty slot leaves a gap rather than shifting
  // everyone up.
  const startingSlotBySleeperId = new Map<string, ScheduleSlot>();
  input.slots.forEach((slot, index) => {
    const id = input.setStarterIds[index];
    if (!validPlayerId(id)) return;
    // A duplicate id in the starters array (Sleeper has produced them) keeps
    // its FIRST slot, so two rows never claim the same player is in two places.
    if (!startingSlotBySleeperId.has(id)) startingSlotBySleeperId.set(id, slot);
  });

  const bySleeperId = new Map<string, LineupPlayer>();
  const rosterIds = input.allPlayerSleeperIds.filter(validPlayerId);
  for (const sleeperId of rosterIds) {
    if (bySleeperId.has(sleeperId)) continue;
    const startingSlot = startingSlotBySleeperId.get(sleeperId) ?? null;
    const kind: RosterSlotKind = startingSlot
      ? "starter"
      : reserve.has(sleeperId)
        ? "reserve"
        : taxi.has(sleeperId)
          ? "taxi"
          : "bench";
    bySleeperId.set(sleeperId, buildLineupPlayer(input, sleeperId, kind, startingSlot));
  }

  // A starter Sleeper lists who is not in `players` on the roster row: rare,
  // but it happens right after a waiver claim, and the slot has to render.
  for (const [sleeperId, slot] of startingSlotBySleeperId) {
    if (bySleeperId.has(sleeperId)) continue;
    bySleeperId.set(sleeperId, buildLineupPlayer(input, sleeperId, "starter", slot));
  }

  const slotEntries: LineupSlotEntry[] = input.slots.map((slot, index) => {
    const id = input.setStarterIds[index];
    return {
      slot,
      player: validPlayerId(id) ? (bySleeperId.get(id) ?? null) : null,
    };
  });

  /**
   * The number a player is graded on. One switch for the whole file, so the
   * headline total and the sentences under it can never end up graded on
   * different halves of the same week.
   */
  const grade = (player: LineupPlayer | null): number | null => {
    if (!player) return null;
    return input.isFinal ? player.actual : player.projected;
  };

  /**
   * A starter we cannot put in the candidate pool cannot be counted in the set
   * total either.
   *
   * BOTH SIDES OF THE COMPARISON COME FROM THE SAME POOL. That is the same
   * absolute rule CLAUDE.md states for the Manager Ledger, and it exists
   * because of exactly this failure: a roster can hold a Sleeper id our
   * `players` table has not caught up with, and such a player still carries an
   * `actual` from Sleeper's own per-player points. Counting his points in the
   * numerator while the optimal fill cannot use him in the denominator
   * understates the optimum, floors the gap at zero, clamps efficiency to 1,
   * and makes the panel say "you set the best lineup you had" about a week it
   * could not measure.
   *
   * The pool is therefore decided FIRST, and the set lineup is scored by
   * looking each starter up in it.
   */
  const gradableSleeperIds = new Set<string>();
  for (const [sleeperId, player] of bySleeperId) {
    if (grade(player) === null) continue;
    if (!input.players.get(sleeperId)) continue;
    gradableSleeperIds.add(sleeperId);
  }

  let setSum = 0;
  let setCount = 0;
  let unprojectedSlotCount = 0;
  /** Graded points from slots the optimal fill is not allowed to touch. */
  let unprojectableSetGraded = 0;
  /** Filled slots whose holder could not be graded on the shared basis. */
  let ungradedSlotCount = 0;

  for (const entry of slotEntries) {
    const player = entry.player;
    if (player) {
      const graded = gradableSleeperIds.has(player.sleeperId) ? grade(player) : null;
      if (graded !== null) {
        setSum += graded;
        setCount += 1;
        if (!entry.slot.projectable) unprojectableSetGraded += graded;
      } else {
        ungradedSlotCount += 1;
      }
      if (player.projected === null) unprojectedSlotCount += 1;
    }
  }

  const setTotal = setCount > 0 ? setSum : null;

  const projectableIndex = projectableSlotIndex(input.slots);
  const projectableTokens = projectableIndex.map((i) => input.slots[i].token);

  /**
   * Who is currently in a PROJECTABLE starting slot.
   *
   * The optimal fill is only offered the projectable slots, so the comparison
   * has to be against the same subset. Someone parked in an IDP slot is not in
   * this set and is excluded from the candidate pool below, which keeps
   * `unprojectableSetGraded` exactly right and makes it impossible to produce
   * the one piece of advice Sleeper would refuse to carry out.
   */
  const seatedNow = new Set<string>();
  const inUnprojectableSlot = new Set<string>();
  for (let i = 0; i < input.slots.length; i += 1) {
    const player = slotEntries[i].player;
    if (!player) continue;
    if (input.slots[i].projectable) seatedNow.add(player.sleeperId);
    else inUnprojectableSlot.add(player.sleeperId);
  }

  // Candidates for the fill: everyone who could legally be started and carries
  // a graded number. IR and taxi are excluded, because Sleeper will not let
  // them into a lineup without a roster move, and an optimum that seats one is
  // an optimum the manager cannot actually set.
  const candidates: LineupCandidate[] = [];
  const candidateBySleeperId = new Map<string, LineupPlayer>();
  for (const [sleeperId, player] of bySleeperId) {
    if (player.isInactive) continue;
    if (inUnprojectableSlot.has(sleeperId)) continue;
    if (!gradableSleeperIds.has(sleeperId)) continue;
    const points = grade(player);
    if (points === null) continue;
    const row = input.players.get(sleeperId);
    if (!row) continue;
    candidates.push({
      playerId: row.playerId,
      position: row.position,
      points,
      sigma: player.sigma ?? 0,
    });
    candidateBySleeperId.set(row.playerId, player);
  }

  const moves: LineupMove[] = [];
  let optimalTotal: number | null = null;
  /** Every pair's gain, including the ones too small to list. */
  let totalPairedGain = 0;
  /** Who the fill seated, whether or not a move was listed for them. */
  const optimalSleeperIds: string[] = [];

  let baseFillTotal: number | null = null;

  if (candidates.length > 0 && projectableTokens.length > 0) {
    const fill = buildOptimalLineup(projectableTokens, candidates);
    // The fill's OWN total, before the unprojectable slots are added back on.
    // That add-back is a constant shared by both sides of any comparison, so
    // the raw number is the one a with-him fill is measured against.
    baseFillTotal = fill.total;

    // The unprojectable slots' own set-lineup points are added back on so this
    // total and setTotal count the same slots. On an unplayed week that term is
    // always zero (an unprojectable slot never receives a projection), but on a
    // settled week an IDP slot DOES carry a real score, and the subtraction
    // below depends on it.
    optimalTotal = fill.total + unprojectableSetGraded;

    /**
     * THE DIFF IS ON LINEUP MEMBERSHIP, NOT ON SLOT ASSIGNMENT, and that
     * distinction is the difference between advice and noise.
     *
     * The fill is free to seat the same nine players in different slots than
     * the manager did: RB1 and RB2 swap places, a receiver moves from WR2 to
     * the flex. None of that changes the score by a single point, and a page
     * that reported it would tell a manager to make four "changes" worth zero
     * and bury the one that is worth eleven. So the comparison is which
     * PLAYERS are in the lineup, and reshuffling is silently ignored because it
     * genuinely does not matter.
     *
     * EACH INCOMING PLAYER IS PAIRED WITH AN OUTGOING ONE WHO COULD ACTUALLY
     * HOLD HIS SLOT, cheapest such starter first. Pairing purely by value
     * (biggest addition against weakest starter) was the first version and it
     * produced sentences that were not moves: in a QB and RB lineup where both
     * are being upgraded, it printed "start the running back over the
     * quarterback" and attached a gain that belonged to neither swap. Slot
     * eligibility is what makes the sentence describe something a manager can
     * do in Sleeper.
     *
     * An incoming player with no eligible outgoing partner left is filling a
     * slot that is empty or freed, and his whole score is the gain.
     *
     * The gains over ALL pairs sum to exactly `pointsLeftOnBench`: every point
     * of difference between the two lineups is one player in or one player out,
     * and the pairing only decides how that difference is attributed. The
     * DISPLAYED list is filtered by MIN_MOVE_GAIN, so it can sum to less; the
     * remainder is reported as `unlistedGain` rather than quietly dropped.
     */
    const seatedOptimal: Array<{ player: LineupPlayer; points: number; slotIndex: number }> = [];
    for (let i = 0; i < fill.slots.length; i += 1) {
      const filled = fill.slots[i];
      if (!filled.playerId) continue;
      const player = candidateBySleeperId.get(filled.playerId);
      if (!player) continue;
      seatedOptimal.push({ player, points: filled.points, slotIndex: projectableIndex[i] });
    }

    const optimalIds = new Set(seatedOptimal.map((s) => s.player.sleeperId));
    optimalSleeperIds.push(...optimalIds);

    const incoming = seatedOptimal
      .filter((s) => !seatedNow.has(s.player.sleeperId))
      .sort((a, b) => b.points - a.points);

    const outgoing: Array<{ player: LineupPlayer; points: number; taken: boolean }> = [];
    for (let i = 0; i < input.slots.length; i += 1) {
      if (!input.slots[i].projectable) continue;
      const player = slotEntries[i].player;
      if (!player) continue;
      if (optimalIds.has(player.sleeperId)) continue;
      // A benched starter we cannot grade contributes an unknown, not a zero.
      // Pairing an incoming player against him would invent a gain out of our
      // own missing data, so he is dropped from the pairing and the empty-slot
      // branch below (his slot is effectively vacant to us) applies instead.
      const points = gradableSleeperIds.has(player.sleeperId) ? grade(player) : null;
      if (points === null) continue;
      outgoing.push({ player, points, taken: false });
    }
    // Cheapest first, so an incoming player takes the least valuable starter
    // he is allowed to replace.
    outgoing.sort((a, b) => a.points - b.points);

    for (const inbound of incoming) {
      const slot = input.slots[inbound.slotIndex];
      const eligible = PULSE_SLOT_ELIGIBILITY[slot.token] ?? [];

      // The cheapest unpaired starter who could legally hold this slot. Falling
      // back to the cheapest unpaired starter of any position keeps the totals
      // exact in the odd shapes where no eligible partner is left; the common
      // case is the eligible one, and it is what makes the sentence true.
      let outbound = outgoing.find((o) => !o.taken && eligible.includes(o.player.position as never));
      if (!outbound) outbound = outgoing.find((o) => !o.taken);
      if (outbound) outbound.taken = true;

      const gained = inbound.points - (outbound?.points ?? 0);
      totalPairedGain += gained;
      if (gained < MIN_MOVE_GAIN) continue;

      moves.push({
        inPlayer: inbound.player,
        outPlayer: outbound?.player ?? null,
        slotLabel: slot.label,
        slotDescription: slot.description,
        pointsGained: gained,
        // Always false today: an inactive player is never a candidate, so the
        // optimiser cannot seat one. Carried anyway because the field is what
        // the UI branches on, and the day IR players are offered to the fill
        // behind a toggle, this is the line that has to change rather than the
        // component.
        requiresRosterMove: inbound.player.isInactive,
      });
    }
  }

  moves.sort((a, b) => b.pointsGained - a.pointsGained);

  // ROUNDED, for the same reason lib/manager-ledger/lineup.ts rounds: summing
  // floats and subtracting gives a perfect week 1.4e-14 points left on the
  // bench and an efficiency of 0.9999999999, which renders as "0.0" beside a
  // panel that has already decided the lineup is not optimal.
  const pointsLeftOnBench =
    optimalTotal !== null && setTotal !== null
      ? Math.max(0, round2(optimalTotal - setTotal))
      : null;

  const efficiency =
    optimalTotal !== null && setTotal !== null && optimalTotal > 0
      ? Math.min(1, round4(setTotal / optimalTotal))
      : null;

  const listedGain = moves.reduce((total, m) => total + m.pointsGained, 0);

  const optimization: LineupOptimization = {
    setTotal,
    optimalTotal,
    pointsLeftOnBench,
    efficiency,
    moves,
    // What the pairing found but the display threshold held back. The panel
    // says so rather than letting the headline gap and the listed moves
    // disagree with no explanation.
    unlistedGain: round2(Math.max(0, totalPairedGain - listedGain)),
    ungradedSlotCount,
    unavailable: optimalTotal === null,
  };

  const byProjection = (a: LineupPlayer, b: LineupPlayer): number => {
    const av = grade(a);
    const bv = grade(b);
    // A player with no number sorts last, never as a zero: he might be a bye
    // week starter, and putting him below a genuine 0.0 says something we do
    // not know.
    if (av === null && bv === null) return a.name.localeCompare(b.name);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };

  const bench: LineupPlayer[] = [];
  const reserveList: LineupPlayer[] = [];
  const taxiList: LineupPlayer[] = [];
  for (const player of bySleeperId.values()) {
    if (player.rosterSlot === "bench") bench.push(player);
    else if (player.rosterSlot === "reserve") reserveList.push(player);
    else if (player.rosterSlot === "taxi") taxiList.push(player);
  }
  bench.sort(byProjection);
  reserveList.sort(byProjection);
  taxiList.sort(byProjection);

  return {
    groups: groupStartingSlots(slotEntries),
    bench,
    reserve: reserveList,
    taxi: taxiList,
    optimization,
    bySleeperId,
    fillCandidates: candidates,
    fillTokens: projectableTokens,
    fillTotal: baseFillTotal,
    optimalSleeperIds,
    actualTotal: input.isFinal ? (input.officialActualTotal ?? setTotal) : null,
    unprojectedSlotCount,
    unprojectableSlotCount: input.slots.filter((s) => !s.projectable).length,
  };
}
