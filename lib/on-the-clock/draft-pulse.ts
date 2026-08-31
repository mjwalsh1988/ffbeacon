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
 *
 * SAME WEEKS AS POWER PULSE, WHICH THEY WERE NOT
 * The board carries every week it has projections for, weeks 1 to 18, and it is
 * shared across every league that scores the same way, so it cannot know where
 * any one league's regular season ends. This averaged all eighteen of them while
 * Power Pulse averaged the fourteen regular season weeks, and the gap was not
 * cosmetic: weeks 15 to 18 carry no NFL byes, so including them fills every
 * lineup every week and quietly hides the bye-week thinness that separates a
 * deep roster from a top-heavy one. Measured across one twelve-team league it
 * moved teams by 0.1 to 2.3 points a week and swapped two pairs of ranks.
 *
 * `throughWeek` is the league's last regular season week, and the caller reads
 * it from the same playoff_week_start Power Pulse uses. Absent, every week on
 * the board is used, which is the old behaviour and is right for a caller that
 * genuinely has no schedule.
 *
 * AN EMPTY STARTING SLOT IS NOT WORTH ZERO
 * It used to be. A team that finished a redraft draft without a tight end was
 * scored as though that slot would stay empty all season, which took eight or
 * nine points a week off it and produced a bad grade for a draft that was fine:
 * the best unrostered tight end is a waiver claim away and is usually within a
 * couple of points of the one you would have drafted. Pass `waiverPool` and
 * every unfilled slot is scored at the best freely available player instead.
 * See lib/on-the-clock/waiver-replacement.ts, including why this stays correctly
 * brutal in a superflex dynasty where no startable quarterback is available.
 */

import {
  buildOptimalLineup,
  lineupSigma,
  startingSlots,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import {
  mean,
  rankDescending,
  round,
  zScores,
  zToDisplay,
} from "@/lib/power-pulse/math";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import type { PlayerProjection, ProjectionBoard } from "./projection-board";
import { weekFor } from "./week-index";
import { buildWaiverPool, fillFromWaivers } from "./waiver-replacement";

/** Bump when the meaning of a Draft Pulse score changes. */
export const DRAFT_PULSE_VERSION = "otc-pulse-3";

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
  /** Starting slots filled in the average week, from the roster or the wire. */
  startersFilled: number;
  /**
   * Slots filled from the WIRE in the average week. Zero for a team whose own
   * roster covers its lineup. Reported rather than folded in silently, because a
   * reader is entitled to know an assumption was made on their behalf.
   */
  waiverFilledSlots: number;
  /**
   * Points per week that come from those waiver fills, as a share of the total.
   * This is what roster construction is now scored on: not how many holes a team
   * has, but how much of its projected output depends on players it does not own.
   */
  waiverPointsShare: number;
  /** The wire signings assumed for the upcoming week, for the explanatory copy. */
  assumedSignings: Array<{ slot: string; playerId: string; points: number }>;
  /**
   * The single worst bye week: how many of the team's would-be starters are
   * absent at once, and when.
   *
   * Everyone has the same number of bye weeks. What differs is whether they
   * land together, and a team that loses four starters in week 9 has a real
   * problem that a team losing one a week for four weeks does not. Computed
   * here because the weekly loop already knows who is missing.
   */
  worstByeWeek: { week: number; startersMissing: number } | null;
  /**
   * Points-weighted average opponent multiplier across the projected starters,
   * over every week in the window. Below 1 is a harder run of defenses than
   * average, above 1 an easier one.
   *
   * This is OUR opponent-strength data, from nfl_defense_vs_position, which is
   * the one thing here no other draft tool can say.
   */
  scheduleStrength: number | null;
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
  /**
   * Last regular season week to average over, from the league's own
   * playoff_week_start minus one. Weeks past it are dropped so a Draft Pulse
   * covers the same span as a Power Pulse. Omit only when no schedule is known.
   */
  throughWeek?: number;
  /**
   * Every player id anyone in the league controls, so an unfilled slot can be
   * scored at the best player still available rather than at zero. Omit to keep
   * the old behaviour, which a caller with no view of the wider league should.
   */
  rosteredPlayerIds?: ReadonlySet<string>;
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
    out.push({
      playerId: id,
      position: p.position,
      points: w.points,
      sigma: w.sigma,
    });
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
  const through = input.throughWeek;
  const weeks =
    through === undefined
      ? input.board.weeks
      : input.board.weeks.filter((w) => w <= through);

  // The unrounded mean per team, captured alongside the display value so the
  // ordering below is decided by the model rather than by the rounding.
  const rawMeans: number[] = [];

  // The waiver pool depends only on (board, week, rostered set), and all three
  // are constant across teams. Built once per week here rather than inside the
  // team loop, where it was rescanning the whole board and resorting six lists
  // 168 times for a twelve-team league instead of 14.
  const poolByWeek = new Map<number, ReturnType<typeof buildWaiverPool>>();
  if (input.rosteredPlayerIds) {
    for (const week of weeks) {
      poolByWeek.set(
        week,
        buildWaiverPool(input.board, week, input.rosteredPlayerIds),
      );
    }
  }

  const teams: DraftPulseTeam[] = input.teams.map((team) => {
    const known: PlayerProjection[] = [];
    let unprojected = 0;
    for (const id of team.playerIds) {
      const p = input.board.players[id];
      if (p) known.push(p);
      else unprojected += 1;
    }

    if (slots.length === 0 || weeks.length === 0 || known.length === 0) {
      rawMeans.push(0);
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
        waiverFilledSlots: 0,
        waiverPointsShare: 0,
        assumedSignings: [],
        worstByeWeek: null,
        scheduleStrength: null,
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
    const waiverCounts: number[] = [];
    let waiverPointsTotal = 0;
    let assumedSignings: DraftPulseTeam["assumedSignings"] = [];
    let worstByeWeek: DraftPulseTeam["worstByeWeek"] = null;
    let oppWeighted = 0;
    let oppWeight = 0;

    // Who this team would start if nobody were ever on bye, so a week's absences
    // can be counted against the players that actually matter rather than
    // against a roster's deep bench.
    const coreStarters = new Set(
      known
        .slice()
        .sort((a, b) => b.pointsPerWeek - a.pointsPerWeek)
        .slice(0, slots.length)
        .map((p) => p.playerId),
    );
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

      // Anything the roster could not cover is scored at the best player still
      // available league-wide, which is what the manager will actually do.
      const pool = poolByWeek.get(week);
      const wire =
        pool && lineup.slots.some((slot) => slot.playerId === null)
          ? fillFromWaivers(lineup.slots, pool)
          : null;

      weeklyTotals.push(lineup.total + (wire?.pointsAdded ?? 0));
      const ownSigma = lineupSigma(lineup.slots);
      weeklySigmas.push(
        wire ? Math.sqrt(ownSigma * ownSigma + wire.varianceAdded) : ownSigma,
      );
      waiverCounts.push(wire?.slotsFilled ?? 0);
      waiverPointsTotal += wire?.pointsAdded ?? 0;
      if (week === weeks[0]) assumedSignings = wire?.signings ?? [];

      let missing = 0;
      for (const id of coreStarters) {
        if (!weekFor(input.board.players[id], week)) missing += 1;
      }
      if (
        missing > 0 &&
        (worstByeWeek === null || missing > worstByeWeek.startersMissing)
      ) {
        worstByeWeek = { week, startersMissing: missing };
      }

      for (const s of lineup.slots) {
        if (!s.playerId) continue;
        const w = weekFor(input.board.players[s.playerId], week);
        if (!w) continue;
        oppWeighted += w.oppMult * s.points;
        oppWeight += s.points;
      }

      const perPosition: Record<PulsePosition, number> = {
        ...ZERO_POSITION_POINTS,
      };
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
      // Waiver fills belong in the position buckets as well as in the weekly
      // total. Left out, every per-position share summed to one minus the
      // team's waiver dependence, and the awards built on those shares then
      // rewarded the roster with the biggest hole.
      for (const signing of wire?.signings ?? []) {
        perPosition[signing.position] += signing.points;
      }
      filledCounts.push(filled + (wire?.slotsFilled ?? 0));
      for (const pos of PULSE_POSITIONS)
        positionTotals[pos].push(perPosition[pos]);
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

    const positionPoints: Record<PulsePosition, number> = {
      ...ZERO_POSITION_POINTS,
    };
    for (const pos of PULSE_POSITIONS)
      positionPoints[pos] = round(mean(positionTotals[pos]), 1);

    rawMeans.push(mean(weeklyTotals));
    return {
      rosterId: team.rosterId,
      meanStartingPoints: round(mean(weeklyTotals), 1),
      sigma: round(mean(weeklySigmas), 1),
      rank: 0,
      score: 0,
      positionPoints,
      weakestSlot,
      starterBeatRate:
        beatWeight > 0 ? round(beatWeighted / beatWeight, 3) : null,
      starterAvailability:
        availWeight > 0 ? round(availWeighted / availWeight, 3) : null,
      starterWeeksPlayed:
        weeksWeight > 0 ? round(weeksWeighted / weeksWeight, 1) : null,
      projectedCount: known.length,
      unprojectedCount: unprojected,
      // Two decimals, not one. The grade's roster-construction component is a
      // curve over this number divided by the slot count, and at one decimal a
      // twelve-team league lands on exactly two values, 9.9 and 10.0. That is a
      // one percent difference, and the curve was turning it into a 49-point
      // component gap carrying nearly a fifth of every team's grade.
      startersFilled: round(mean(filledCounts), 2),
      waiverFilledSlots: round(mean(waiverCounts), 2),
      waiverPointsShare:
        weeklyTotals.length > 0 && mean(weeklyTotals) > 0
          ? round(
              waiverPointsTotal / weeklyTotals.length / mean(weeklyTotals),
              4,
            )
          : 0,
      assumedSignings,
      worstByeWeek,
      scheduleStrength:
        oppWeight > 0 ? round(oppWeighted / oppWeight, 4) : null,
    };
  });

  // Ranked and z-scored on the UNROUNDED mean, the same correction Power Pulse
  // made for the same reason: meanStartingPoints is rounded to a tenth for
  // display, and two teams the model separates by 0.04 points would otherwise
  // tie, leaving a table with two fourths and no fifth in an order decided by
  // whatever sequence the rows arrived in.
  const ranks = rankDescending(rawMeans);
  const zs = zScores(rawMeans);
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
export function fallbackSlotsFromDraftSettings(
  settings: Record<string, number>,
): string[] {
  const n = (k: string) =>
    Number.isFinite(settings[k]) && settings[k] > 0 ? settings[k] : 0;
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
