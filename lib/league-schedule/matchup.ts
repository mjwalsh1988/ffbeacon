/**
 * One matchup, both lineups, everything the detail page renders.
 *
 * Pure. Every roster row, projection row, accuracy row and defense split
 * arrives as plain data, so this file can be reasoned about and tested without
 * a database. lib/league-schedule/data.ts does the fetching.
 *
 * The rule that shapes almost every branch below: a projection and a result are
 * not the same kind of number, and neither is a zero. `actual` is populated
 * once there is a result to report, which is a final week or a week with points
 * already on the board, so nothing downstream can print a result for a game
 * nobody has played. A missing projection stays null rather
 * than becoming a zero, because a zero reads as an answer and would quietly
 * drag a team total down. That is the same distinction projectPlayerWeek makes
 * when it returns null, and it survives all the way to the cell.
 *
 * Projections are still computed on a settled week, because the lineup table
 * prints the projection beside the result. Which of the two a cell shows is the
 * view's decision, not this file's.
 *
 * DISPLAYING A RESULT AND GRADING ONE ARE DIFFERENT SWITCHES. `resultsVisible`
 * turns live scores on the moment a game starts; `isFinal` is what the optimal
 * lineup, the bench gap and every swap sentence still wait for. Grading a
 * Sunday afternoon against partial scores would tell a manager they left forty
 * points on the bench because three of their starters kick off at four.
 *
 * THE BENCH RETROSPECTIVE IS GRADED ON RESULTS, NOT ON PROJECTIONS. "You left
 * 18.4 points on your bench in week 3" is a claim about a week that has been
 * played, and answering it from the same projections that were wrong enough to
 * make the manager sit the player is not an answer. On a final week the optimal
 * lineup, the gap, and every swap sentence are all built from `actualByPlayer`,
 * which lib/league-schedule/lineups.ts loads precisely because Sleeper's
 * `players_points` covers the bench. Unplayed weeks keep the projection path.
 * `gradePoints` below is the one switch between them, so the total and the
 * swaps can never end up graded on different halves of the same week.
 *
 * Every player projection goes through lib/power-pulse/project.ts. There is no
 * second model here. If the Schedule page and the Power Pulse page ever printed
 * different numbers for the same player, one of them would be lying and a user
 * would have no way to tell which.
 */

import type { ScoringSettings } from "@/lib/league-scoring";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import {
  buildOptimalLineup,
  pulseEligibility,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import type {
  AccuracyRow,
  DefenseRow,
  PlayerRow,
  ProjectionRow,
} from "@/lib/power-pulse/load";
import { winProbability } from "@/lib/power-pulse/math";
import {
  projectPlayerWeek,
  reliabilityMultiplier,
} from "@/lib/power-pulse/project";
import { slotEligibility } from "@/lib/power-pulse/types";
// The one test for "has this week started". lib/league-lineups/status.ts
// imports nothing, so reaching for it here closes no cycle, and a second copy
// of the rule is how the Lineups board and this page would end up disagreeing
// about whether a Sunday is under way.
import { hasLivePoints } from "@/lib/league-lineups/status";
import type { SetLineupEntry } from "./lineups";
import type {
  BenchUpgrade,
  MatchupSide,
  MatchupSlotEntry,
  MatchupView,
  SchedulePlayer,
  ScheduleSlot,
} from "./types";

/** How many swaps the upgrade panel lists before it stops. */
export const BENCH_UPGRADE_LIMIT = 4;

/**
 * The smallest gain worth printing. Below half a point the swap sits inside the
 * model's own noise, and listing it invites a manager to churn their lineup for
 * nothing.
 */
export const BENCH_UPGRADE_MIN_GAIN = 0.5;

export type MatchupSideInput = {
  sleeperRosterId: number;
  rosterRowId: string | null;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };
  pulseRank: number | null;
  /** Sleeper ids, positionally aligned to `slots`, from readSetLineup. */
  setLineup: SetLineupEntry[];
  /** Every rostered sleeper id. */
  allPlayerSleeperIds: string[];
  /** Sleeper ids on IR. Cannot start. */
  reserveSleeperIds: string[];
  /** Sleeper ids on the taxi squad. Cannot start. */
  taxiSleeperIds: string[];
  /** Actual points this side scored. Null when the week is not final. */
  actualTotal: number | null;
  /**
   * The league's own published points for this side, whatever state the week is
   * in. On a live week this is the running score.
   *
   * Separate from `actualTotal` on purpose: that one is final-only and feeds the
   * retrospective, this one feeds the display. Optional, and a caller that
   * leaves it out gets null rather than a zero.
   */
  officialPoints?: number | null;
  /** Actual per-player points, from readRosteredPlayerPoints. */
  actualByPlayer: Map<string, number>;
};

export type BuildMatchupInput = {
  week: number;
  season: number;
  currentWeek: number;
  isFinal: boolean;
  slots: ScheduleSlot[];
  home: MatchupSideInput;
  away: MatchupSideInput | null;
  /** Sleeper id to resolved player. From lib/power-pulse/load.ts loadPlayers. */
  players: Map<string, PlayerRow>;
  /** FF Beacon player id plus week to projection row. Key is `playerId|week`. */
  projections: Map<string, ProjectionRow>;
  /** FF Beacon player id to accuracy row. */
  accuracy: Map<string, AccuracyRow>;
  defense: Map<string, DefenseRow>;
  defenseSeasons: number[];
  scoringSettings: ScoringSettings | null;
  settings: PowerPulseSettings;
  /**
   * A chopped (guillotine) league. Sleeper pairs its teams and the pairing
   * decides nothing: the lowest score in the whole league goes out, whoever it
   * played. Both lineups below are real and stay; the probability of one of
   * them beating the other is a fact about nothing.
   */
  chopped?: boolean;
  /**
   * Home and away for this season, keyed `${week}|${TEAM}`. Optional, and a
   * missing map means every player's venue reads as unknown rather than as home.
   */
  homeAwayByTeamWeek?: Map<string, boolean> | null;
  /**
   * The IDP switch, read once by the server loader (plan R-25). Absent or
   * false: defensive slots are not projected, not optimised and never offered
   * as a swap target, exactly as before. It must agree with the `projectable`
   * flags on `slots`, which the same loader built from the same switch.
   */
  idpEnabled?: boolean;
};

/** A proposed swap, before the greedy pass thins the list out. */
type UpgradeProposal = BenchUpgrade & { slotIndex: number };

/**
 * The outgoing half of an upgrade that fills an EMPTY slot.
 *
 * `BenchUpgrade.outPlayer` is not nullable, and the panel that renders it puts
 * the name straight into a sentence. So an unfilled slot needs something to
 * name, and it has to be something a reader recognises as the absence of a
 * player rather than a player: "Start Waddle over an empty slot in FLEX" is the
 * whole point of the entry. Every number on it is null, never zero, so nothing
 * downstream can add it into a total or print it as a score.
 *
 * A nullable outPlayer is the cleaner contract and would let the sentence drop
 * the "over" clause entirely. That is a change to components/, which this file
 * does not own.
 */
function emptySlotStandIn(slot: ScheduleSlot): SchedulePlayer {
  return {
    playerId: null,
    sleeperId: `empty-${slot.order}`,
    name: "an empty slot",
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
    actual: null,
    isInactive: false,
  };
}

function buildSide(
  input: BuildMatchupInput,
  side: MatchupSideInput,
  /**
   * True when real points are on the board anywhere in this matchup, so every
   * row should carry one. Decided once for the whole matchup rather than per
   * side, because a week is live or it is not: a side whose starters all play
   * the late game has not had a different Sunday from their opponent.
   */
  resultsVisible: boolean,
): MatchupSide {
  const reserve = new Set(side.reserveSleeperIds);
  const taxi = new Set(side.taxiSleeperIds);
  const idpEnabled = input.idpEnabled === true;
  const slotMap = slotEligibility(idpEnabled);
  /** Every position a resolved player may be seated as under the map in force. */
  const eligibleOf = (row: PlayerRow) =>
    idpEnabled ? pulseEligibility(row.position, row.eligible) : [row.position];

  /**
   * What a player actually scored, once there are results to report. The
   * per-player map from `players_points` wins because it covers the bench too;
   * the slot's own `starters_points` value is the fallback for a row whose map
   * is missing.
   *
   * Gated on `resultsVisible` rather than on `isFinal`, so a week in progress
   * carries live scores. Nothing that GRADES the week moves with it:
   * `gradePoints` below stays on `isFinal`, and so does `actualTotal`.
   */
  const actualFor = (
    sleeperId: string,
    fallback: number | null,
  ): number | null => {
    if (!resultsVisible) return null;
    const fromMap = side.actualByPlayer.get(sleeperId);
    if (fromMap !== undefined && Number.isFinite(fromMap)) return fromMap;
    return fallback;
  };

  const buildPlayer = (
    sleeperId: string,
    projectable: boolean,
    fallbackActual: number | null,
  ): SchedulePlayer => {
    const isInactive = reserve.has(sleeperId) || taxi.has(sleeperId);
    const actual = actualFor(sleeperId, fallbackActual);
    const row = input.players.get(sleeperId);

    // A roster can hold a Sleeper id we have no player row for. The slot still
    // renders, named as unknown, because dropping it would shift every slot
    // below it up by one and put ten other players in the wrong place.
    if (!row) {
      return {
        playerId: null,
        sleeperId,
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
        isInactive,
      };
    }

    const accuracy = input.accuracy.get(row.playerId) ?? null;
    const reliability = reliabilityMultiplier(accuracy, input.settings);
    const projection = input.projections.get(row.playerId + "|" + input.week);

    // A slot the map cannot fill never reaches projectPlayerWeek: a defensive
    // slot while the IDP switch is off, or a token nobody projects. Running the
    // model there would put a number in a slot the totals then leave out.
    const projected = projectable
      ? projectPlayerWeek({
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
        })
      : null;

    return {
      playerId: row.playerId,
      sleeperId,
      name: row.name,
      position: row.position,
      team: row.team,
      injuryStatus: row.injuryStatus,
      nflOpponent: projection?.opponent ?? null,
      // Null unless the schedule map actually answered. See SchedulePlayer.
      nflIsHome:
        row.team && input.homeAwayByTeamWeek
          ? input.homeAwayByTeamWeek.get(`${input.week}|${row.team.toUpperCase()}`) ?? null
          : null,
      opponentMultiplier: projected ? projected.opponentMultiplier : null,
      beatRate: accuracy?.beatRate ?? null,
      availability: accuracy?.availabilityRate ?? null,
      reliability,
      projected: projected ? projected.points : null,
      sigma: projected ? projected.sigma : null,
      actual,
      isInactive,
    };
  };

  // The set lineup, one entry per slot, in the league's own slot order. The
  // caller groups it for display with orderSlotsForDisplay; keeping alignment
  // order here is what makes both sides of the matchup line up row for row.
  const slotEntries: MatchupSlotEntry[] = input.slots.map((slot, i) => {
    const entry: SetLineupEntry | undefined = side.setLineup[i];
    const sleeperId = entry?.sleeperId ?? null;
    return {
      slot,
      player:
        sleeperId === null
          ? null
          : buildPlayer(
              sleeperId,
              slot.projectable,
              entry?.actualPoints ?? null,
            ),
    };
  });

  /**
   * The number this side is graded on for the bench comparison.
   *
   * A settled week is graded on what the player scored; an unplayed one on what
   * we think he will score. Everything that feeds the retrospective (the optimal
   * fill, the gap, and each swap's gain) runs through this one function, so
   * there is no way for the headline total to be a result while the sentences
   * under it are still projections.
   */
  const gradePoints = (player: SchedulePlayer): number | null =>
    input.isFinal ? player.actual : player.projected;

  /**
   * Who actually started this week. Decided before anything is graded, because
   * it changes two things below: a starter is eligible for the optimal fill
   * whatever today's IR or taxi list says, and a starter who has since left the
   * roster is still a candidate.
   *
   * The roster lists are CURRENT ones (Sleeper publishes no per-week history),
   * and week 2 is when week 1's injuries land on IR. Grading week 1 against
   * today's list counted the injured starter in "what you scored" and left him
   * out of "the best lineup you had", which understated the best lineup,
   * floored the bench gap at zero and paired swaps against a lineup missing a
   * player. The Lineups page and the Manager Ledger already follow this rule.
   */
  const startedIds = new Set<string>();
  for (const entry of slotEntries) {
    if (entry.player) startedIds.add(entry.player.sleeperId);
  }

  let projectedSum = 0;
  let variance = 0;
  let projectedCount = 0;
  let unprojectedSlots = 0;

  let gradedSum = 0;
  let gradedCount = 0;
  // The set lineup's graded points from slots the optimal fill cannot use. See
  // the optimalTotal comment below for why this term is written out at all.
  let unprojectableSetGraded = 0;

  for (const entry of slotEntries) {
    const player = entry.player;
    if (!player) continue;

    // Both totals count the same players. A starter with no players row cannot
    // enter the optimal fill (it needs his position), so his points stay out of
    // the set total too, rather than sitting in the numerator alone and
    // reporting a lineup that beat the best one available.
    const graded = player.playerId === null ? null : gradePoints(player);
    if (graded !== null) {
      gradedSum += graded;
      gradedCount += 1;
      if (!entry.slot.projectable) unprojectableSetGraded += graded;
    }

    if (player.projected === null) {
      unprojectedSlots += 1;
      continue;
    }
    projectedSum += player.projected;
    const playerSigma = player.sigma ?? 0;
    variance += playerSigma * playerSigma;
    projectedCount += 1;
  }

  const projectedTotal = projectedCount > 0 ? projectedSum : null;
  const sigma = projectedCount > 0 ? Math.sqrt(variance) : null;
  /** What the set lineup was worth on the grading basis. */
  const gradedSetTotal = gradedCount > 0 ? gradedSum : null;

  // Everyone on the roster, resolved and projected once. Built with
  // projectable=true, because the question here is "can this player be
  // projected at all", not "which slot are they sitting in". A player occupying
  // an IDP slot therefore carries a projection in this map and none in their
  // lineup cell, which is the right answer for both readers.
  //
  // The pool is the current roster PLUS everyone who started this week. On a
  // settled week Sleeper's players_points map is the roster as it stood that
  // week, so its keys join too; a player traded away since then is still the
  // player who was available to start.
  const rosterPlayers = new Map<string, SchedulePlayer>();
  const poolIds: string[] = [...side.allPlayerSleeperIds];
  for (const entry of slotEntries) {
    if (entry.player) poolIds.push(entry.player.sleeperId);
  }
  if (input.isFinal) poolIds.push(...side.actualByPlayer.keys());
  for (const sleeperId of poolIds) {
    if (!sleeperId || sleeperId === "0") continue;
    if (rosterPlayers.has(sleeperId)) continue;
    rosterPlayers.set(sleeperId, buildPlayer(sleeperId, true, null));
  }

  const candidates: LineupCandidate[] = [];
  for (const [sleeperId, player] of rosterPlayers) {
    const points = gradePoints(player);
    if (points === null) continue;
    // Today's IR and taxi lists bar a player from the fill unless he actually
    // started this week, in which case he plainly could be started.
    if (!startedIds.has(sleeperId) && (reserve.has(sleeperId) || taxi.has(sleeperId))) continue;
    const row = input.players.get(sleeperId);
    if (!row) continue;
    candidates.push({
      playerId: row.playerId,
      position: row.position,
      ...(idpEnabled ? { eligible: eligibleOf(row) } : {}),
      points,
      sigma: player.sigma ?? 0,
    });
  }

  /**
   * The best legal lineup, over the projectable slots only. An IDP slot cannot
   * be optimised, because nothing is projected for the positions that fill it,
   * and offering the slot to the fill would let a running back take it.
   *
   * On a settled week the candidates carry actual points, so this is the lineup
   * the manager could have set and what it would have scored, not a second
   * guess dressed up as one.
   *
   * The unprojectable slots' own set-lineup points get added back on so this
   * number and gradedSetTotal count the same slots. Today that term is always
   * zero on an unplayed week, because an unprojectable slot never receives a
   * projection in the first place. It is written out anyway: the two totals sit
   * next to each other on the page as "you set 112.3, your best lineup is
   * 118.4", and on a settled week an IDP slot DOES carry a real score, so the
   * subtraction depends on it.
   */
  const projectableTokens = input.slots
    .filter((s) => s.projectable)
    .map((s) => s.token);
  let optimalTotal: number | null = null;
  if (candidates.length > 0) {
    optimalTotal =
      buildOptimalLineup(projectableTokens, candidates, slotMap).total +
      unprojectableSetGraded;
  }

  const pointsLeftOnBench =
    optimalTotal !== null && gradedSetTotal !== null
      ? Math.max(0, optimalTotal - gradedSetTotal)
      : null;

  /**
   * Single swaps, each stated on its own.
   *
   * These gains DO NOT sum to pointsLeftOnBench, and the copy must never imply
   * they do. Taking the first swap changes what the second is worth: the
   * starter it displaced is now on the bench, and the slot it filled is no
   * longer open. pointsLeftOnBench comes from the optimal fill above and is the
   * real total; this list is the route to it, one legible move at a time.
   */
  const proposals: UpgradeProposal[] = [];
  for (const [sleeperId, inPlayer] of rosterPlayers) {
    if (startedIds.has(sleeperId)) continue;
    const inPoints = gradePoints(inPlayer);
    if (inPoints === null) continue;
    const row = input.players.get(sleeperId);
    if (!row) continue;

    // The cheapest slot this player could legally take. Displacing the weakest
    // eligible starter is the largest gain available to this player, and an
    // EMPTY eligible slot is cheaper still: it is worth zero, so filling it is
    // always the biggest move on the board.
    //
    // Skipping empty slots is what this loop used to do, and it produced the
    // worst possible advice for the one manager who most needed it. A team that
    // left a WR slot unfilled was told to bench its weakest starting WR, while
    // the hole itself went unmentioned even though the optimal fill above had
    // already counted it into pointsLeftOnBench. That is exactly the roster
    // where the gap and the swap list diverge hardest.
    let targetIndex = -1;
    let targetPlayer: SchedulePlayer | null = null;
    let targetPoints = 0;
    let foundTarget = false;
    for (let i = 0; i < slotEntries.length; i += 1) {
      const slotTakes = slotMap[slotEntries[i].slot.token] ?? [];
      if (!eligibleOf(row).some((position) => slotTakes.includes(position))) continue;

      const holder = slotEntries[i].player;
      // An occupied slot we cannot grade is not a target. Its holder scored or
      // projects something we do not know, and calling that zero would invent a
      // gain out of our own missing data.
      const holderPoints =
        holder === null ? 0 : holder.playerId === null ? null : gradePoints(holder);
      if (holderPoints === null) continue;

      if (!foundTarget || holderPoints < targetPoints) {
        targetIndex = i;
        targetPlayer = holder;
        targetPoints = holderPoints;
        foundTarget = true;
      }
    }
    if (!foundTarget) continue;

    const gain = inPoints - targetPoints;
    if (gain < BENCH_UPGRADE_MIN_GAIN) continue;

    proposals.push({
      inPlayer,
      outPlayer:
        targetPlayer ?? emptySlotStandIn(slotEntries[targetIndex].slot),
      slotLabel: slotEntries[targetIndex].slot.label,
      gain,
      // IR and taxi players are listed, because a manager can act on them, but
      // Sleeper will not let them into a lineup without a roster move first.
      requiresMove: inPlayer.isInactive,
      slotIndex: targetIndex,
    });
  }

  proposals.sort((a, b) => b.gain - a.gain);

  // Greedy over the sorted list, one proposal per slot. Each incoming player
  // already appears once by construction. Capping the outgoing side too makes
  // the panel read as a set of independent moves instead of four different ways
  // to bench the same player.
  const benchUpgrades: BenchUpgrade[] = [];
  const claimedSlots = new Set<number>();
  for (const proposal of proposals) {
    if (benchUpgrades.length >= BENCH_UPGRADE_LIMIT) break;
    if (claimedSlots.has(proposal.slotIndex)) continue;
    claimedSlots.add(proposal.slotIndex);
    benchUpgrades.push({
      inPlayer: proposal.inPlayer,
      outPlayer: proposal.outPlayer,
      slotLabel: proposal.slotLabel,
      gain: proposal.gain,
      requiresMove: proposal.requiresMove,
    });
  }

  return {
    sleeperRosterId: side.sleeperRosterId,
    rosterRowId: side.rosterRowId,
    teamName: side.teamName,
    ownerHandle: side.ownerHandle,
    ownerAvatarId: side.ownerAvatarId,
    record: side.record,
    pulseRank: side.pulseRank,
    slots: slotEntries,
    projectedTotal,
    sigma,
    actualTotal: input.isFinal ? side.actualTotal : null,
    scoredTotal: resultsVisible ? (side.officialPoints ?? side.actualTotal) : null,
    optimalTotal,
    pointsLeftOnBench,
    benchUpgrades,
    unprojectedSlots,
  };
}

/** Build the whole matchup, both sides, from plain data. */
export function buildMatchupView(input: BuildMatchupInput): MatchupView {
  // A settled week always shows results. An unsettled one shows them the moment
  // anybody in the matchup scores, which is what makes a Sunday afternoon read
  // as a Sunday afternoon rather than as a table of forecasts nobody needs any
  // more. Both sides are consulted: a team whose whole lineup plays Monday night
  // has still had their opponent's Sunday happen to them.
  const resultsVisible =
    input.isFinal ||
    hasLivePoints(input.home.actualByPlayer) ||
    (input.away ? hasLivePoints(input.away.actualByPlayer) : false);

  const home = buildSide(input, input.home, resultsVisible);
  const away = input.away ? buildSide(input, input.away, resultsVisible) : null;

  // A settled week has a score on the board, so a win probability for it is not
  // a forecast, it is a distraction. An unpaired roster has nobody to beat. And
  // in a chopped league nobody is playing the person they were drawn against,
  // whatever the bracket-shaped page says.
  let homeWinProb: number | null = null;
  if (
    !input.chopped &&
    !input.isFinal &&
    away !== null &&
    home.projectedTotal !== null &&
    away.projectedTotal !== null
  ) {
    homeWinProb = winProbability(
      home.projectedTotal,
      home.sigma ?? 0,
      away.projectedTotal,
      away.sigma ?? 0,
    );
  }

  return {
    week: input.week,
    season: input.season,
    isFinal: input.isFinal,
    isCurrent: input.week === input.currentWeek && !input.isFinal,
    home,
    away,
    homeWinProb,
    hasUnprojectableSlots: input.slots.some((slot) => !slot.projectable),
    resultsVisible,
  };
}
