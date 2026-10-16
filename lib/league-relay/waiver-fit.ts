/**
 * What a wire move actually did to the roster that made it.
 *
 * The waiver review used to judge a claim from the player alone: his projection,
 * his market value, the bid. That says whether he is any good. It does not say
 * whether he is any good FOR THIS TEAM, which is the only thing the joke can
 * fairly be about. A 12-point running back is a great claim for a team starting
 * a 6-point one and a waste of budget for a team with three better backs.
 *
 * So this answers it the way the FAAB tool and Trade Ideas do, with the same
 * optimizer (lib/power-pulse/lineup.ts buildOptimalLineup): build the best
 * lineup for each of the next few weeks without the move, build it again with
 * it, and compare. From the two builds come every fact the review is allowed to
 * use:
 *
 *   - how many of those weeks the new player starts, and this week in particular
 *   - how many points a week the move adds to (or takes off) the best lineup
 *   - whether a player who was dropped had been starting
 *   - whether the new player starts THIS week because a regular starter at his
 *     position has no projection this week or is listed as out, which is the bye-week and injury
 *     cover case and deserves credit rather than a "he is only a backup" jab
 *
 * Nothing here is a guess. A week a player has no projection for is a week he is
 * not a candidate (a bye or an unpublished projection), never a zero, and the
 * cover case is only claimed when the regular starter is visibly in the lineup in
 * another week of the window and visibly unavailable in this one.
 *
 * Pure: plain data in, plain data out.
 */

import {
  buildOptimalLineup,
  type LineupCandidate,
  type SlotEligibilityMap,
} from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";

/** One player, projected for each week of the window. */
export interface FitPlayer {
  sleeperId: string;
  /** FF Beacon player id, which is what the optimizer keys on. */
  playerId: string;
  name: string;
  position: PulsePosition;
  /** Every position he may be seated as. Set only with the IDP switch on. */
  eligible?: readonly PulsePosition[];
  /** Sleeper's designation, verbatim. Null when healthy. */
  injuryStatus: string | null;
  /** Adjusted projection per week. A missing week is a bye or unpublished. */
  byWeek: Map<number, { points: number; sigma: number }>;
}

export interface WaiverFitInput {
  /** Projectable starting slot tokens, in league order. */
  slots: string[];
  slotMap?: SlotEligibilityMap;
  /** The window, ascending. The first entry is "this week". */
  weeks: number[];
  /** Every startable player on the roster, minus anyone in added or dropped. */
  base: FitPlayer[];
  /** Arrivals who can start (not parked on injured reserve or the taxi squad). */
  added: FitPlayer[];
  /** Departures. */
  dropped: FitPlayer[];
}

export interface WaiverFit {
  /** Weeks in the window. */
  weeksConsidered: number;
  /** The first week of the window. */
  thisWeek: number;
  /**
   * The arrival who starts most often, with ties going to the higher projection
   * this week. Null when no arrival had a projection in any week, in which case
   * we have nothing to say about his role and say nothing.
   */
  lead: {
    name: string;
    position: string;
    starts: number;
    startsThisWeek: boolean;
    /** Projected points this week. Null on a bye. */
    thisWeekPoints: number | null;
  } | null;
  /** Mean change in best-lineup points per week across the window. */
  lineupDelta: number;
  /** The same, for this week alone. */
  thisWeekDelta: number;
  /** The departure who had been starting most, when one had started at all. */
  droppedStarter: { name: string; starts: number } | null;
  /**
   * Departures we actually measured (projected in the window) who started in
   * none of it. Only these may be described as "not starting anyway": a player
   * the comparison never saw has had nothing checked.
   */
  droppedBench: string[];
  /**
   * Why the lead starts this week, when it is cover for somebody. "absent"
   * means the regular has no projection this week, which is almost always a bye
   * but could be an unpublished projection, so the words never say "bye".
   * `status` is already in reader's words ("on injured reserve", not "IR").
   */
  cover: { name: string; reason: "absent" | "injury"; status: string | null } | null;
}

/** Everything a tick needs to run the comparison for any of its moves. */
export interface WireFitContext {
  slots: string[];
  slotMap: SlotEligibilityMap;
  /** The window, ascending. The first entry is this week. */
  weeks: number[];
  /** Per Sleeper roster id: who can start, and who is parked (IR or taxi). */
  rosters: Map<number, { startable: string[]; parked: Set<string> }>;
  /** Projected players, keyed by Sleeper id. */
  players: Map<string, FitPlayer>;
}

/** One move's fit, plus the arrivals who went straight onto IR or the taxi squad. */
export interface MoveFit {
  fit: WaiverFit | null;
  /** Names of arrivals who are parked and cannot start without another move. */
  parked: string[];
}

/**
 * The comparison for one move, from the tick's shared context.
 *
 * The roster read is whatever Sleeper holds NOW, which may be from before or
 * after the move was synced, so the move is taken back out of it first: the
 * starting point is the roster without anybody who moved, "before" adds the
 * departures back and "after" adds the arrivals. Either order of sync gives the
 * same answer.
 */
export function fitForMove(
  ctx: WireFitContext | null,
  rosterId: number,
  addedIds: string[],
  droppedIds: string[],
): MoveFit {
  const roster = ctx?.rosters.get(rosterId);
  if (!ctx || !roster) return { fit: null, parked: [] };

  const moved = new Set([...addedIds, ...droppedIds]);
  const resolve = (ids: string[]) =>
    ids.map((id) => ctx.players.get(id)).filter((p): p is FitPlayer => Boolean(p));

  const parked = resolve(addedIds.filter((id) => roster.parked.has(id))).map((p) => p.name);
  const fit = computeWaiverFit({
    slots: ctx.slots,
    slotMap: ctx.slotMap,
    weeks: ctx.weeks,
    base: resolve(roster.startable.filter((id) => !moved.has(id))),
    added: resolve(addedIds.filter((id) => !roster.parked.has(id))),
    // A departure who was not going to play cannot have been costing the
    // lineup anything. The roster is normally read AFTER the move has synced,
    // so his IR slot is already gone from `parked`; the injury designation is
    // the part that survives, and it is checked as well.
    dropped: resolve(droppedIds.filter((id) => !roster.parked.has(id))).filter(
      (p) => !isUnavailable(p.injuryStatus),
    ),
  });
  return { fit, parked };
}

/** Designations that mean a player is not going to play this week. */
const UNAVAILABLE = new Set(["OUT", "IR", "DOUBTFUL", "PUP", "SUS", "SUSPENDED", "NA", "COV"]);

function isUnavailable(status: string | null): boolean {
  return Boolean(status && UNAVAILABLE.has(status.toUpperCase()));
}

/** A designation in the words a reader would use. Never a bare code like "NA". */
function statusWords(status: string): string {
  const words: Record<string, string> = {
    OUT: "out",
    IR: "on injured reserve",
    DOUBTFUL: "doubtful",
    PUP: "on the PUP list",
    SUS: "suspended",
    SUSPENDED: "suspended",
  };
  return words[status.toUpperCase()] ?? "unavailable";
}

function candidate(p: FitPlayer, week: number): LineupCandidate | null {
  const proj = p.byWeek.get(week);
  if (!proj) return null;
  return {
    playerId: p.playerId,
    position: p.position,
    ...(p.eligible ? { eligible: p.eligible } : {}),
    points: proj.points,
    sigma: proj.sigma,
  };
}

function candidatesFor(players: FitPlayer[], week: number): LineupCandidate[] {
  return players.map((p) => candidate(p, week)).filter((c): c is LineupCandidate => c !== null);
}

function lineupIds(slots: ReturnType<typeof buildOptimalLineup>["slots"]): Set<string> {
  const out = new Set<string>();
  for (const s of slots) if (s.playerId) out.add(s.playerId);
  return out;
}

/**
 * Run the comparison. Null when there is no window or no slot to fill, which is
 * the off-season and the leagues the model cannot project.
 */
export function computeWaiverFit(input: WaiverFitInput): WaiverFit | null {
  const { slots, slotMap, weeks, base, added, dropped } = input;
  if (weeks.length === 0 || slots.length === 0) return null;
  const thisWeek = weeks[0];

  const beforePool = [...base, ...dropped];
  const afterPool = [...base, ...added];

  const addedStarts = new Map<string, number>();
  for (const p of added) {
    if (p.byWeek.size > 0) addedStarts.set(p.playerId, 0);
  }
  const droppedStarts = new Map<string, number>();
  for (const p of dropped) droppedStarts.set(p.playerId, 0);

  let deltaSum = 0;
  let thisWeekDelta = 0;
  const beforeOtherWeeks = new Set<string>();
  let afterThisWeek = new Set<string>();

  for (const week of weeks) {
    const before = buildOptimalLineup(slots, candidatesFor(beforePool, week), slotMap);
    const after = buildOptimalLineup(slots, candidatesFor(afterPool, week), slotMap);
    const delta = after.total - before.total;
    deltaSum += delta;

    const beforeIds = lineupIds(before.slots);
    const afterIds = lineupIds(after.slots);
    if (week === thisWeek) {
      thisWeekDelta = delta;
      afterThisWeek = afterIds;
    } else {
      for (const id of beforeIds) beforeOtherWeeks.add(id);
    }
    for (const id of afterIds) {
      if (addedStarts.has(id)) addedStarts.set(id, (addedStarts.get(id) ?? 0) + 1);
    }
    for (const id of beforeIds) {
      if (droppedStarts.has(id)) droppedStarts.set(id, (droppedStarts.get(id) ?? 0) + 1);
    }
  }

  // The arrival who matters most: most starts, then the bigger projection now.
  let lead: WaiverFit["lead"] = null;
  for (const p of added) {
    const starts = addedStarts.get(p.playerId);
    if (starts === undefined) continue;
    const thisWeekPoints = p.byWeek.get(thisWeek)?.points ?? null;
    const better =
      !lead ||
      starts > lead.starts ||
      (starts === lead.starts && (thisWeekPoints ?? -1) > (lead.thisWeekPoints ?? -1));
    if (better) {
      lead = {
        name: p.name,
        position: p.position,
        starts,
        startsThisWeek: afterThisWeek.has(p.playerId),
        thisWeekPoints,
      };
    }
  }

  let droppedStarter: WaiverFit["droppedStarter"] = null;
  const droppedBench: string[] = [];
  for (const p of dropped) {
    const starts = droppedStarts.get(p.playerId) ?? 0;
    if (starts > 0 && (!droppedStarter || starts > droppedStarter.starts)) {
      droppedStarter = { name: p.name, starts };
    }
    if (starts === 0 && p.byWeek.size > 0) droppedBench.push(p.name);
  }

  // Cover: the lead starts this week, and a regular at his position (in the
  // best lineup in another week of the window, out of it this week) has no projection
  // this week or is listed as out. Both halves are visible in the data; neither is assumed.
  let cover: WaiverFit["cover"] = null;
  if (lead?.startsThisWeek) {
    const leadPosition = lead.position;
    let best: { player: FitPlayer; points: number } | null = null;
    for (const p of base) {
      if (p.position !== leadPosition) continue;
      // A regular (seated in another week of the window) who is out of THIS
      // week's lineup once the arrival is there. Not "out of the before
      // lineup": a starter listed as Out with nobody behind him is still seated
      // at zero before the move, which is exactly the hole the move fills.
      if (!beforeOtherWeeks.has(p.playerId) || afterThisWeek.has(p.playerId)) continue;
      const otherPoints = Math.max(
        0,
        ...weeks.filter((w) => w !== thisWeek).map((w) => p.byWeek.get(w)?.points ?? 0),
      );
      if (!best || otherPoints > best.points) best = { player: p, points: otherPoints };
    }
    if (best) {
      const status = best.player.injuryStatus;
      if (status && isUnavailable(status)) {
        cover = { name: best.player.name, reason: "injury", status: statusWords(status) };
      } else if (!best.player.byWeek.has(thisWeek)) {
        cover = { name: best.player.name, reason: "absent", status: null };
      }
    }
  }

  return {
    weeksConsidered: weeks.length,
    thisWeek,
    lead,
    lineupDelta: deltaSum / weeks.length,
    thisWeekDelta,
    droppedStarter,
    droppedBench,
    cover,
  };
}
