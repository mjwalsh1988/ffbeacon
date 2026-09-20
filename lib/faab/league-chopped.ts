/**
 * Pricing a waiver claim in a chopped, guillotine, death or knockout league.
 *
 * A different game with the same currency, and the old calculator was playing
 * the wrong one. It read Sleeper's type 3 as a keeper league (3 is at least
 * 1), ran the keeper cut guard over a roster nobody keeps, counted eliminated
 * teams as rivals with money, and simulated a head-to-head playoff race in a
 * league that has no playoffs and no opponent.
 *
 * What actually decides a bid here:
 *
 *   SURVIVAL, not playoff odds. The lowest score in the whole league each
 *   week is eliminated. The question is never "does this win me the matchup",
 *   it is "does this keep me off the bottom".
 *
 *   A SHRINKING FIELD. Every elimination puts a whole roster back on waivers
 *   and takes a bidder out of the room. Prices fall as the season goes on,
 *   hard: Fantasy Life's 2024 guillotine medians have the same player losing
 *   22% to 77% of his price between about 13 teams alive and about 6.
 *
 *   SUBSTITUTES. Several starters arrive at once, so a rival who loses this
 *   auction has somewhere else to spend, which is why a chopped league's
 *   prices are softer than the same contest in a redraft league.
 *
 * This module owns the chopped branch end to end. It reads the same caches as
 * everything else and computes none of them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  aliveFraction as aliveFractionOf,
  choppedWeeks,
  isAliveRoster,
  resolveFinalWeek,
} from "@/lib/chopped/league";
import { priceByAliveFraction } from "@/lib/chopped/price";
import { simulateSurvival, type SurvivalTeam } from "@/lib/chopped/survival";
import type { ChoppedRead, ChoppedSettings, FaabSettings } from "./types";

type ServiceClient = SupabaseClient<Database>;

/** How much budget a manager should still be holding by now. */
export function paceFor(
  currentWeek: number,
  holdPct: number,
  settings: ChoppedSettings,
): ChoppedRead["pace"] {
  const target =
    settings.paceTargets.find((t) => t.throughWeek >= currentWeek) ??
    settings.paceTargets[settings.paceTargets.length - 1];
  const targetHoldPct = target?.holdPct ?? 0;
  const gap = holdPct - targetHoldPct;
  const status: ChoppedRead["pace"]["status"] =
    Math.abs(gap) <= 10 ? "on-pace" : gap > 0 ? "ahead" : "behind";
  return { holdPct, targetHoldPct, status };
}

/**
 * How much this signing is worth, on a 0 to 1 scale.
 *
 * Three questions, weighted: does it keep me alive THIS week, does it win me
 * the league, and how many more weeks does it buy. The first matters most
 * because being chopped ends everything else, and the last exists so a
 * roster that is safe this week still values a real upgrade.
 */
export function choppedStrength(
  before: { pChoppedThisWeek: number; pWin: number; expectedWeeksAlive: number },
  after: { pChoppedThisWeek: number; pWin: number; expectedWeeksAlive: number },
  settings: ChoppedSettings,
): number {
  const clamp01 = (n: number) => Math.min(1.25, Math.max(0, n));
  const surviveGain = (before.pChoppedThisWeek - after.pChoppedThisWeek) * 100;
  const winGain = (after.pWin - before.pWin) * 100;
  const weeksGain = after.expectedWeeksAlive - before.expectedWeeksAlive;

  const w = settings.strengthWeights;
  const total =
    w.surviveThisWeek * clamp01(surviveGain / Math.max(1e-6, settings.bigSurvivePoints)) +
    w.winLeague * clamp01(winGain / Math.max(1e-6, settings.bigWinPoints)) +
    w.weeksAlive * clamp01(weeksGain / Math.max(1e-6, settings.bigWeeksAlive));

  return Math.min(1, Math.max(0, total));
}

/**
 * How much more a rival in danger will bid.
 *
 * A team one bad week from elimination is not shopping for value. Scaled by
 * the most endangered team in the league, so the multiplier means the same
 * thing in a tight league as in a lopsided one.
 */
export function dangerBoost(
  pChopped: number,
  worstPChopped: number,
  settings: ChoppedSettings,
): number {
  if (worstPChopped <= 0) return 1;
  const share = Math.min(1, Math.max(0, pChopped / worstPChopped));
  return 1 + settings.dangerWeight * share;
}

export { priceByAliveFraction };

export type ChoppedContext = {
  /** Every roster still in the league, the reader included. */
  aliveRosterIds: number[];
  startCount: number;
  currentWeek: number;
  /** Weekly mean and spread per roster, from the shared projection path. */
  weeklyByRoster: Map<number, Map<number, { mean: number; sigma: number }>>;
  /** The reader's own weekly distributions with the signing made. */
  weeklyAfter: Map<number, { mean: number; sigma: number }>;
  seasonPointsByRoster: Map<number, number>;
  myRosterId: number;
  /** Remaining budget per alive roster, in dollars. */
  budgetByRoster: Map<number, number>;
  totalBudget: number;
  /** Free agents at his position projecting nearly as well as he does. */
  substitutes: number;
  releaseCutoffWeek: number | null;
  seed: number;
};

export type ChoppedOutcome = {
  read: ChoppedRead;
  /** The share of the FULL budget he is worth to this roster, 0 to 100. */
  worthPct: number;
  /** Scales rival participation down when substitutes are available. */
  participationScale: number;
  /** Per roster, how much harder they will bid because of their own danger. */
  dangerBoostByRoster: Map<number, number>;
  /** The default goal: danger flips the page to "make sure I win". */
  goalDefault: "value" | "sure";
};

/**
 * The chopped branch of the model.
 *
 * Pure: every figure it needs is handed in, so it can be tested without a
 * client and cannot accidentally trigger a compute on any cache.
 */
export function computeChopped(
  context: ChoppedContext,
  settings: FaabSettings,
  playerMultiplier: number,
): ChoppedOutcome {
  const chopped = settings.chopped;
  const aliveCount = context.aliveRosterIds.length;
  const { finalWeek, finalWeekVerified } = resolveFinalWeek(context.currentWeek, aliveCount);
  const weeks = choppedWeeks(context.currentWeek, finalWeek);

  const teamsBefore: SurvivalTeam[] = context.aliveRosterIds.map((rosterId) => ({
    rosterId,
    seasonPoints: context.seasonPointsByRoster.get(rosterId) ?? 0,
    weeks: context.weeklyByRoster.get(rosterId) ?? new Map(),
  }));

  // The SAME SEED on both sides, deliberately. Every difference between the
  // two runs then belongs to the signing rather than to the dice, which is
  // the only way a two point swing means anything at all.
  const runs = chopped.runs;
  const before = simulateSurvival(teamsBefore, weeks, { runs, seed: context.seed });

  const teamsAfter: SurvivalTeam[] = teamsBefore.map((team) =>
    team.rosterId === context.myRosterId ? { ...team, weeks: context.weeklyAfter } : team,
  );
  const after = simulateSurvival(teamsAfter, weeks, { runs, seed: context.seed });

  const mineBefore = before.get(context.myRosterId);
  const mineAfter = after.get(context.myRosterId);
  const emptyResult = { pChoppedThisWeek: 0, pWin: 0, expectedWeeksAlive: 0 };
  const beforeRead = mineBefore
    ? {
        pChoppedThisWeek: mineBefore.pChoppedThisWeek,
        pWin: mineBefore.pWin,
        expectedWeeksAlive: mineBefore.expectedWeeksAlive,
      }
    : emptyResult;
  const afterRead = mineAfter
    ? {
        pChoppedThisWeek: mineAfter.pChoppedThisWeek,
        pWin: mineAfter.pWin,
        expectedWeeksAlive: mineAfter.expectedWeeksAlive,
      }
    : emptyResult;

  // Who is closest to the trapdoor. Rank 1 is the team most likely to go.
  const byDanger = [...before.values()].sort(
    (a, b) => b.pChoppedThisWeek - a.pChoppedThisWeek,
  );
  const dangerRank =
    byDanger.findIndex((r) => r.rosterId === context.myRosterId) + 1 || aliveCount;
  const worstPChopped = byDanger[0]?.pChoppedThisWeek ?? 0;

  const dangerBoostByRoster = new Map<number, number>();
  for (const result of before.values()) {
    dangerBoostByRoster.set(
      result.rosterId,
      dangerBoost(result.pChoppedThisWeek, worstPChopped, chopped),
    );
  }

  // Money, counting ALIVE TEAMS ONLY. An eliminated roster's unspent budget
  // is not money in the room, and counting it told a reader they were poor
  // in a league where everyone still playing was poorer.
  let moneyLeftInLeague = 0;
  const aliveBudgets: Array<{ rosterId: number; remaining: number }> = [];
  for (const rosterId of context.aliveRosterIds) {
    const remaining = context.budgetByRoster.get(rosterId) ?? 0;
    moneyLeftInLeague += remaining;
    aliveBudgets.push({ rosterId, remaining });
  }
  aliveBudgets.sort((a, b) => b.remaining - a.remaining);
  const myBudget = context.budgetByRoster.get(context.myRosterId) ?? 0;
  const yourMoneyRank =
    aliveBudgets.findIndex((b) => b.rosterId === context.myRosterId) + 1 || aliveCount;

  const fraction = aliveFractionOf(aliveCount, context.startCount);
  const strength = choppedStrength(beforeRead, afterRead, chopped);
  const worthPct = Math.min(
    100,
    Math.max(
      0,
      strength * chopped.maxPctFromUpgrade * playerMultiplier * priceByAliveFraction(fraction, chopped),
    ),
  );

  const holdPct = context.totalBudget > 0 ? (myBudget / context.totalBudget) * 100 : 0;

  return {
    read: {
      aliveCount,
      startCount: context.startCount,
      currentWeek: context.currentWeek,
      finalWeek,
      finalWeekVerified,
      before: beforeRead,
      after: afterRead,
      dangerRank,
      moneyLeftInLeague,
      yourShareOfMoney: moneyLeftInLeague > 0 ? myBudget / moneyLeftInLeague : 0,
      yourMoneyRank,
      pace: paceFor(context.currentWeek, holdPct, chopped),
      substitutes: context.substitutes,
      releaseCutoffWeek: context.releaseCutoffWeek,
    },
    worthPct,
    participationScale: 1 / (1 + chopped.substituteDiscount * Math.max(0, context.substitutes)),
    dangerBoostByRoster,
    goalDefault: beforeRead.pChoppedThisWeek >= chopped.dangerThreshold ? "sure" : "value",
  };
}

/** Rosters still in the league, read from what the sync already stored. */
export function aliveRosterIds(
  rosters: Array<{ sleeperRosterId: number; metadata?: unknown }>,
): number[] {
  return rosters
    .filter((roster) => {
      const meta = (roster.metadata ?? {}) as { settings?: Record<string, unknown> };
      return isAliveRoster(meta.settings ?? null);
    })
    .map((roster) => roster.sleeperRosterId);
}

/**
 * Who is still in the league, straight from the stored Sleeper roster.
 *
 * The Power Pulse roster loader does not select `metadata`, and it should not
 * start: every other caller would pay for a column only this feature reads.
 * One small query here instead.
 */
export async function loadAliveRosterIds(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<number[]> {
  const { data } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, metadata")
    .eq("league_id", leagueRowId);
  return aliveRosterIds(
    (data ?? []).map((row) => ({
      sleeperRosterId: Number(row.sleeper_roster_id),
      metadata: row.metadata,
    })),
  );
}

/** Season points per roster, for the survival tiebreak. */
export async function loadSeasonPoints(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const { data } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, points_for")
    .eq("league_id", leagueRowId);
  for (const row of data ?? []) {
    out.set(Number(row.sleeper_roster_id), Number(row.points_for ?? 0));
  }
  return out;
}
