/**
 * What an empty starting slot is actually worth, which is never zero.
 *
 * THE PROBLEM THIS FIXES
 * A draft grade used to score an unfilled starting slot at nothing. In a redraft
 * league with fifteen roster spots and a live waiver wire, finishing a draft
 * without a tight end is a Tuesday morning errand, not a hole in the roster: the
 * best unrostered tight end is a claim away and he is usually within a couple of
 * points a week of the one you would have drafted. Scoring that slot as a zero
 * took eight or nine points a week off the team and produced a bad grade for a
 * draft that was fine.
 *
 * The same mechanic is correctly brutal in the leagues where it should be. In a
 * twelve-team superflex dynasty every startable quarterback is rostered, so the
 * best available one projects near nothing and an empty superflex slot really
 * does cost you the whole slot. Nothing here is format-aware, and it does not
 * need to be: the league's own roster depth decides how good the replacement is,
 * and scarcity falls out of that rather than being asserted.
 *
 * REPLACEMENT LEVEL, THE SAME IDEA POSITIONAL WAR ALREADY USES
 * The best freely available player at a position IS replacement level, by
 * definition. This module answers it per week, because a bye week genuinely
 * lowers what you can pick up and that is exactly the week you need someone.
 *
 * WHAT IT DELIBERATELY DOES NOT MODEL
 * Waiver priority and FAAB budgets. Two teams both short a tight end cannot both
 * sign the same one, and modelling who wins that claim would need a waiver order
 * we do not have and a bidding model nobody could check. Each team is offered
 * the same pool, walking DOWN it for a second hole at the same position so one
 * team never signs one player twice. The overlap between teams is a known,
 * bounded overstatement: it flatters a team by at most the gap between the first
 * and second player available at a position, which in the leagues where holes
 * are common is a fraction of a point.
 *
 * Pure. Everything arrives as plain data.
 */

import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import {
  PULSE_SLOT_ELIGIBILITY,
  type PulsePosition,
} from "@/lib/power-pulse/types";
import type { ProjectionBoard } from "./projection-board";
import { weekFor } from "./week-index";

/**
 * Players available at each position for one week, best first.
 *
 * Keyed by position rather than flattened, because a slot's eligibility is a
 * list of positions and the answer for a FLEX is the best of several lists.
 */
export type WaiverPool = Map<PulsePosition, LineupCandidate[]>;

/** How deep to keep each position's list. */
const POOL_DEPTH = 6;

/**
 * The unrostered players at each position for one week, best first.
 *
 * `rostered` is every player id owned by anyone in the league, which is what
 * makes this the WAIVER pool rather than the whole player pool. A draft in
 * progress has a small rostered set and a rich wire; a finished superflex
 * dynasty startup has the opposite, and the same code says so.
 */
export function buildWaiverPool(
  board: ProjectionBoard,
  week: number,
  rostered: ReadonlySet<string>,
): WaiverPool {
  const byPosition = new Map<PulsePosition, LineupCandidate[]>();

  for (const [playerId, player] of Object.entries(board.players)) {
    if (rostered.has(playerId)) continue;
    const w = weekFor(player, week);
    // A bye or an unpublished week is an absent player, not a zero. He cannot be
    // signed to fill this week's hole, which is the honest answer.
    if (!w) continue;
    const list = byPosition.get(player.position) ?? [];
    list.push({
      playerId,
      position: player.position,
      points: w.points,
      sigma: w.sigma,
    });
    byPosition.set(player.position, list);
  }

  for (const [position, list] of byPosition) {
    list.sort((a, b) => b.points - a.points);
    byPosition.set(position, list.slice(0, POOL_DEPTH));
  }
  return byPosition;
}

/**
 * One week of one team's lineup, with every empty slot filled from the wire.
 *
 * Walks the slots in the league's own order and takes the best eligible player
 * still unclaimed by THIS team this week. Returns what was added, so the caller
 * can report the assumption rather than quietly banking it: a reader who
 * finished a draft with no tight end deserves to be told we assumed he would
 * sign one, and which one.
 */
export function fillFromWaivers(
  slots: Array<{
    slot: string;
    playerId: string | null;
    points: number;
    sigma: number;
  }>,
  pool: WaiverPool,
): {
  /** Points added across every slot filled from the wire. */
  pointsAdded: number;
  /** Variance added, kept separate so the caller can combine it correctly. */
  varianceAdded: number;
  /** How many slots were filled this way. */
  slotsFilled: number;
  /**
   * Which players, in slot order, for the copy that explains the assumption and
   * for attributing the points to a position. The position matters: without it
   * a waiver fill lands in the weekly total but in no position bucket, and every
   * per-position share then sums to less than one.
   */
  signings: Array<{
    slot: string;
    playerId: string;
    position: PulsePosition;
    points: number;
  }>;
} {
  const claimed = new Set<string>();
  let pointsAdded = 0;
  let varianceAdded = 0;
  let slotsFilled = 0;
  const signings: Array<{
    slot: string;
    playerId: string;
    position: PulsePosition;
    points: number;
  }> = [];

  for (const slot of slots) {
    if (slot.playerId !== null) continue;
    const eligible = PULSE_SLOT_ELIGIBILITY[slot.slot] ?? [];

    let best: LineupCandidate | null = null;
    for (const position of eligible) {
      for (const candidate of pool.get(position) ?? []) {
        if (claimed.has(candidate.playerId)) continue;
        if (best === null || candidate.points > best.points) best = candidate;
        // The lists are sorted, so the first unclaimed entry is this position's
        // best and there is no reason to look further down it.
        break;
      }
    }

    // Nothing available at any eligible position. That is a real zero: the
    // position is exhausted league-wide, which is the case an empty slot was
    // always meant to describe.
    if (!best) continue;

    claimed.add(best.playerId);
    pointsAdded += best.points;
    varianceAdded += best.sigma * best.sigma;
    slotsFilled += 1;
    signings.push({
      slot: slot.slot,
      playerId: best.playerId,
      position: best.position,
      points: best.points,
    });
  }

  return { pointsAdded, varianceAdded, slotsFilled, signings };
}

/**
 * Every player id anyone in the league controls.
 *
 * The one input that turns a player pool into a waiver pool, and the reason this
 * needs no notion of format: a shallow redraft league leaves most of the league
 * unrostered, a deep dynasty leaves almost none of it, and the replacement level
 * that falls out is correct for both without either being named.
 */
export function rosteredPlayerIds(
  teams: Iterable<{ playerIds: string[] }>,
): Set<string> {
  const out = new Set<string>();
  for (const team of teams) {
    for (const id of team.playerIds) out.add(id);
  }
  return out;
}
