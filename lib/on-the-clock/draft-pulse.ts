/**
 * Draft Pulse: how strong is the team you are drafting, in points.
 *
 * For every team, fill the league's real starting lineup with the best of what
 * they have drafted (plus their dynasty pre-draft roster) for every remaining
 * week, and take the mean. The number is projected optimal starting-lineup points
 * per week, ranked within the league and shown on the same 1 to 99 scale Power
 * Pulse uses.
 *
 * IT IS NOT POWER PULSE, AND THE DIFFERENCE MATTERS
 * Power Pulse answers "how many games should this team win from here", which
 * needs a remaining schedule to simulate against. A startup draft has no schedule
 * at all: the league has never played a week and Sleeper has published nothing.
 * CLAUDE.md forbids computing or caching a Power Pulse without a real remaining
 * slate, because scoring an empty one returns 0.0 projected wins and 0%/100%
 * playoff odds for every team, which reads as a real answer and is not one.
 *
 * So Draft Pulse publishes points and a rank. No expected wins, no playoff odds,
 * no projected finish, and nothing is ever written to league_power_pulse_cache.
 * The naming is deliberate so the two can never be confused in code or in copy.
 *
 * Pure. Every projection arrives precomputed from projection-board.ts, which runs
 * the Power Pulse model, so a Draft Pulse number and a Power Pulse number can
 * never disagree about what a player is projected to do.
 */

import { buildOptimalLineup, lineupSigma, startingSlots, type LineupCandidate } from "@/lib/power-pulse/lineup";
import { mean, rankDescending, round, zScores, zToDisplay } from "@/lib/power-pulse/math";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import type { PlayerProjection, ProjectionBoard } from "./projection-board";
import { weekFor } from "./week-index";

/** Bump when the meaning of a Draft Pulse score changes. */
export const DRAFT_PULSE_VERSION = "otc-pulse-1";

/** One team's roster as the draft currently stands. */
export interface DraftPulseTeamInput {
  rosterId: number;
  /** FF Beacon player ids the team controls right now. Order is irrelevant. */
  playerIds: string[];
}

export interface DraftPulseTeam {
  rosterId: number;
  /** Projected optimal starting-lineup points per remaining week. */
  meanStartingPoints: number;
  /** Weekly spread of that lineup, for the volatility award. */
  sigma: number;
  /** 1 = best in the league. Never a projected finish. */
  rank: number;
  /** Within-league 1 to 99 display score, same scale as Power Pulse. */
  score: number;
  /** Projected starter points per week by position. */
  positionPoints: Record<PulsePosition, number>;
  /** The still-empty or weakest starting slot, named by its Sleeper token. */
  weakestSlot: string | null;
  /** Points-weighted beat rate of the projected starters. Null when no sample. */
  starterBeatRate: number | null;
  /** Points-weighted availability of the projected starters. Null when no sample. */
  starterAvailability: number | null;
  /**
   * Points-weighted weeks of projection history behind those starters. The
   * reliability awards gate on it: a beat rate over one week is a number, not
   * evidence.
   */
  starterWeeksPlayed: number | null;
  /** How many of the team's players carried a projection. */
  projectedCount: number;
  /** How many did not, so the UI can say "based on 14 of 16". */
  unprojectedCount: number;
  /** Starting slots actually filled in the average week. */
  startersFilled: number;
}

export interface DraftPulseResult {
  version: string;
  /** The league's startable slot tokens, in the league's own order. */
  slots: string[];
  /** Weeks the average was taken over. */
  weeks: number[];
  teams: DraftPulseTeam[];
  /** True when the league's roster_positions were unavailable and we guessed. */
  slotsEstimated: boolean;
}

export interface DraftPulseInput {
  teams: DraftPulseTeamInput[];
  /** The league's roster_positions, verbatim. Empty falls back to `fallbackSlots`. */
  rosterPositions: string[];
  /**
   * Slot tokens to use when the league's roster_positions were never captured.
   * The caller derives these from the draft's slots_* counts.
   */
  fallbackSlots: string[];
  board: ProjectionBoard;
  display: { min: number; max: number; sharpness: number };
}

const ZERO_POSITION_POINTS: Record<PulsePosition, number> = {
  QB: 0,
  RB: 0,
  WR: 0,
  TE: 0,
  K: 0,
  DEF: 0,
};

/** Candidates for one week from a set of player ids. Absent players are skipped. */
export function candidatesForWeek(
  playerIds: string[],
  board: ProjectionBoard,
  week: number,
): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const id of playerIds) {
    const p = board.players[id];
    if (!p) continue;
    const w = weekFor(p, week);
    if (!w) continue; // bye or unpublished: an absent week, never a zero
    out.push({ playerId: id, position: p.position, points: w.points, sigma: w.sigma });
  }
  return out;
}

/**
 * Compute Draft Pulse for every team. Deterministic and side-effect free.
 *
 * A team with nothing drafted scores zero and ranks last, which is correct
 * before its first pick and self-corrects on the very next one. That is
 * different from the degenerate Power Pulse case the rules forbid, because zero
 * points from zero players is a true statement, whereas 0.0 projected wins from
 * a full roster with no schedule is not.
 */
export function computeDraftPulse(input: DraftPulseInput): DraftPulseResult {
  const fromLeague = startingSlots(input.rosterPositions);
  const slotsEstimated = fromLeague.length === 0;
  const slots = slotsEstimated ? input.fallbackSlots : fromLeague;
  const weeks = input.board.weeks;

  const teams: DraftPulseTeam[] = input.teams.map((team) => {
    const known: PlayerProjection[] = [];
    let unprojected = 0;
    for (const id of team.playerIds) {
      const p = input.board.players[id];
      if (p) known.push(p);
      else unprojected += 1;
    }

    if (slots.length === 0 || weeks.length === 0 || known.length === 0) {
      return {
        rosterId: team.rosterId,
        meanStartingPoints: 0,
        sigma: 0,
        rank: 0,
        score: 0,
        positionPoints: { ...ZERO_POSITION_POINTS },
        weakestSlot: slots[0] ?? null,
        starterBeatRate: null,
        starterAvailability: null,
        starterWeeksPlayed: null,
        projectedCount: known.length,
        unprojectedCount: unprojected,
        startersFilled: 0,
      };
    }

    const weeklyTotals: number[] = [];
    const weeklySigmas: number[] = [];
    const positionTotals: Record<PulsePosition, number[]> = {
      QB: [],
      RB: [],
      WR: [],
      TE: [],
      K: [],
      DEF: [],
    };
    // Points per slot across weeks, to name the weakest one.
    const slotTotals = slots.map(() => 0);
    const filledCounts: number[] = [];
    // Points-weighted accuracy accumulators over projected STARTERS only.
    let beatWeighted = 0;
    let beatWeight = 0;
    let availWeighted = 0;
    let availWeight = 0;
    let weeksWeighted = 0;
    let weeksWeight = 0;

    for (const week of weeks) {
      const candidates = candidatesForWeek(team.playerIds, input.board, week);
      const lineup = buildOptimalLineup(slots, candidates);
      weeklyTotals.push(lineup.total);
      weeklySigmas.push(lineupSigma(lineup.slots));

      const perPosition: Record<PulsePosition, number> = { ...ZERO_POSITION_POINTS };
      let filled = 0;
      lineup.slots.forEach((slot, i) => {
        slotTotals[i] += slot.points;
        if (!slot.playerId) return;
        filled += 1;
        const p = input.board.players[slot.playerId];
        if (!p) return;
        perPosition[p.position] += slot.points;
        if (p.beatRate !== null) {
          beatWeighted += p.beatRate * slot.points;
          beatWeight += slot.points;
        }
        if (p.availability !== null) {
          availWeighted += p.availability * slot.points;
          availWeight += slot.points;
        }
        weeksWeighted += p.weeksPlayed * slot.points;
        weeksWeight += slot.points;
      });
      filledCounts.push(filled);
      for (const pos of PULSE_POSITIONS) positionTotals[pos].push(perPosition[pos]);
    }

    // The weakest slot is the one contributing the fewest points. An unfilled
    // slot contributes zero and therefore wins this automatically, which is the
    // answer a drafter wants ("you still have no tight end").
    let weakestSlot: string | null = null;
    let weakest = Infinity;
    slotTotals.forEach((total, i) => {
      if (total < weakest) {
        weakest = total;
        weakestSlot = slots[i];
      }
    });

    const positionPoints: Record<PulsePosition, number> = { ...ZERO_POSITION_POINTS };
    for (const pos of PULSE_POSITIONS) positionPoints[pos] = round(mean(positionTotals[pos]), 1);

    return {
      rosterId: team.rosterId,
      meanStartingPoints: round(mean(weeklyTotals), 1),
      sigma: round(mean(weeklySigmas), 1),
      rank: 0,
      score: 0,
      positionPoints,
      weakestSlot,
      starterBeatRate: beatWeight > 0 ? round(beatWeighted / beatWeight, 3) : null,
      starterAvailability: availWeight > 0 ? round(availWeighted / availWeight, 3) : null,
      starterWeeksPlayed: weeksWeight > 0 ? round(weeksWeighted / weeksWeight, 1) : null,
      projectedCount: known.length,
      unprojectedCount: unprojected,
      startersFilled: round(mean(filledCounts), 1),
    };
  });

  const values = teams.map((t) => t.meanStartingPoints);
  const ranks = rankDescending(values);
  const zs = zScores(values);
  teams.forEach((t, i) => {
    t.rank = ranks[i] ?? teams.length;
    t.score = zToDisplay(zs[i], input.display);
  });

  return { version: DRAFT_PULSE_VERSION, slots, weeks, teams, slotsEstimated };
}

/**
 * Build the fallback slot token list from a draft's slots_* counts, for leagues
 * whose league object we could not capture. Coarser than the real
 * roster_positions (every flex family collapses to FLEX), which is exactly why it
 * is the fallback and why the result carries slotsEstimated.
 */
export function fallbackSlotsFromDraftSettings(settings: Record<string, number>): string[] {
  const n = (k: string) => (Number.isFinite(settings[k]) && settings[k] > 0 ? settings[k] : 0);
  const out: string[] = [];
  const push = (token: string, count: number) => {
    for (let i = 0; i < count; i += 1) out.push(token);
  };
  push("QB", n("slots_qb"));
  push("RB", n("slots_rb"));
  push("WR", n("slots_wr"));
  push("TE", n("slots_te"));
  push("FLEX", n("slots_flex") + n("slots_rec_flex"));
  push("SUPER_FLEX", n("slots_super_flex"));
  push("K", n("slots_k"));
  push("DEF", n("slots_def"));
  return out;
}
