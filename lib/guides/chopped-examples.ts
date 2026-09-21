/**
 * The teaching examples behind the chopped league guide's diagrams.
 *
 * THREE KINDS OF NUMBER LIVE HERE AND EVERY EXPORT SAYS WHICH IT IS.
 *
 *   - PRODUCT CODE ON INVENTED TEAMS. buildConsistencyRows and
 *     buildByeClusterRows run simulateSurvival from lib/chopped/survival.ts,
 *     the same function the FAAB calculator runs on a real chopped league,
 *     over rosters nobody owns. The arithmetic is the product's. The teams
 *     are made up, and the figures' captions say so.
 *   - EXACT ARITHMETIC. buildFieldRows is a subtraction: one roster leaves
 *     the league every week, so the field and the wire are the two halves of
 *     a fixed eighteen. No simulation, and no assumption beyond one chop a
 *     week.
 *   - SHIPPED CONFIGURATION. The price, pace and danger ladders are read from
 *     DEFAULT_FAAB_SETTINGS.chopped rather than typed out, so a figure cannot
 *     drift from the calculator it describes. An admin can change all three,
 *     which is why every caption says "by default".
 *
 * WHY THE SIMULATIONS HOLD THE WEEKLY MEAN FIXED. Both of them are arguments
 * about SHAPE, and a difference in average points would answer them before
 * the simulator ran. Every team in buildConsistencyRows scores the same
 * WEEK_MEAN every week and differs only in spread, so the gap in survival is
 * the spread and nothing else. The bye-cluster roster is identical to the
 * field except in one week. That is the whole claim in each case, and pinning
 * the mean is what makes the answer mean anything.
 *
 * The seed is fixed, so a figure does not move between builds, and the run
 * count is high enough that only the third decimal is still wandering.
 */

import { simulateSurvival, type SurvivalTeam } from "@/lib/chopped/survival";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";

/** The format's own recommended size: Sleeper suggests eighteen. */
export const TEAMS = 18;
/** Sleeper chops one roster a week. */
export const CHOPPED_PER_WEEK = 1;
/** A full fantasy season, which is as long as a chopped league can run. */
export const SEASON_WEEKS = 17;
/** Illustration only. An average weekly score for a starting lineup. */
export const WEEK_MEAN = 105;

const SEED = 20260921;
const RUNS = 6000;

const ALL_WEEKS = Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1);

/* ------------------------------------------------------------------ *
 * 1. The field and the wire, which are the same eighteen rosters
 * ------------------------------------------------------------------ */

export type FieldRow = {
  week: number;
  /** Rosters still playing once the week resolved. */
  alive: number;
  /** Rosters that have been chopped, and are therefore on the wire. */
  released: number;
  /** True in the first week the wire holds more rosters than the league. */
  crossover: boolean;
};

/**
 * Exact. One roster leaves every week, so alive plus released is always
 * TEAMS, and the crossover is the week released first exceeds alive. The
 * point of drawing it is that both halves move at once: the league gets
 * harder to finish last in at exactly the rate the wire gets better.
 */
export function buildFieldRows(): FieldRow[] {
  let seen = false;
  return ALL_WEEKS.map((week) => {
    const released = Math.min(week * CHOPPED_PER_WEEK, TEAMS - 1);
    const alive = TEAMS - released;
    const crossover = !seen && released > alive;
    if (crossover) seen = true;
    return { week, alive, released, crossover };
  });
}

/* ------------------------------------------------------------------ *
 * 2. Same points, different spread
 * ------------------------------------------------------------------ */

export type ConsistencyGroup = {
  key: "steady" | "average" | "spiky";
  label: string;
  /** Weekly standard deviation, in fantasy points. Illustration. */
  sigma: number;
  what: string;
};

/**
 * Three kinds of roster, six of each, all scoring WEEK_MEAN on average. The
 * middle spread is the one the guide's other survival figure already uses,
 * so the two diagrams describe the same imagined league.
 */
export const CONSISTENCY_GROUPS: ConsistencyGroup[] = [
  {
    key: "steady",
    label: "Steady",
    sigma: 16,
    what: "Every starter has a role. A bad week is dull rather than disastrous.",
  },
  {
    key: "average",
    label: "Average",
    sigma: 26,
    what: "A normal roster. Some dependable starters and real week-to-week noise.",
  },
  {
    key: "spiky",
    label: "Boom or bust",
    sigma: 38,
    what: "Deep threats and touchdown-dependent backs. Wins some weeks by forty.",
  },
];

export type ConsistencyRow = {
  key: ConsistencyGroup["key"];
  label: string;
  sigma: number;
  what: string;
  /** Chance of posting the league's lowest score in week 1. */
  pChoppedWeek1: number;
  /** Weeks survived out of SEASON_WEEKS, averaged over runs. */
  weeksAlive: number;
  /** Chance of being the last roster standing. */
  pWin: number;
  /** Week number to the chance of still being alive after it. */
  pAliveAfter: Map<number, number>;
};

const PER_GROUP = TEAMS / 3;

export function buildConsistencyRows(): ConsistencyRow[] {
  const teams: SurvivalTeam[] = [];
  CONSISTENCY_GROUPS.forEach((group, gi) => {
    for (let k = 0; k < PER_GROUP; k += 1) {
      teams.push({
        rosterId: gi * PER_GROUP + k + 1,
        seasonPoints: 0,
        weeks: new Map(ALL_WEEKS.map((w) => [w, { mean: WEEK_MEAN, sigma: group.sigma }])),
      });
    }
  });

  const results = simulateSurvival(teams, ALL_WEEKS, {
    runs: RUNS,
    seed: SEED,
    choppedPerWeek: CHOPPED_PER_WEEK,
  });

  // Averaged across the six rosters in each group. Six identical teams are
  // six samples of the same question, so averaging them is six times the runs
  // rather than a blend of different things.
  return CONSISTENCY_GROUPS.map((group, gi) => {
    let pChoppedWeek1 = 0;
    let weeksAlive = 0;
    let pWin = 0;
    const alive = new Map<number, number>(ALL_WEEKS.map((w) => [w, 0]));
    for (let k = 0; k < PER_GROUP; k += 1) {
      const r = results.get(gi * PER_GROUP + k + 1);
      if (!r) continue;
      pChoppedWeek1 += r.pChoppedThisWeek;
      weeksAlive += r.expectedWeeksAlive;
      pWin += r.pWin;
      for (const w of ALL_WEEKS) {
        alive.set(w, (alive.get(w) ?? 0) + (r.pAliveAfter.get(w) ?? 0));
      }
    }
    for (const w of ALL_WEEKS) alive.set(w, (alive.get(w) ?? 0) / PER_GROUP);
    return {
      key: group.key,
      label: group.label,
      sigma: group.sigma,
      what: group.what,
      pChoppedWeek1: pChoppedWeek1 / PER_GROUP,
      weeksAlive: weeksAlive / PER_GROUP,
      pWin: pWin / PER_GROUP,
      pAliveAfter: alive,
    };
  });
}

/* ------------------------------------------------------------------ *
 * 3. The scheduled disaster
 * ------------------------------------------------------------------ */

/** The week the imagined cluster lands on. */
export const CLUSTER_WEEK = 9;
/** Points the three missing starters would have scored. Illustration. */
export const CLUSTER_DROP = 30;

export type ClusterRow = {
  key: "cluster" | "spread";
  label: string;
  /** Chance of being chopped in CLUSTER_WEEK, given the roster reached it. */
  pChoppedInClusterWeek: number;
  weeksAlive: number;
  pWin: number;
};

/**
 * One roster has three starters sharing a bye, so it scores CLUSTER_DROP
 * fewer points in that one week. Everything else about it, every other week
 * included, is identical to the seventeen rosters around it. So the whole
 * difference the simulator reports is the one week, which is the argument the
 * lesson makes in words.
 */
export function buildByeClusterRows(): ClusterRow[] {
  const teams: SurvivalTeam[] = Array.from({ length: TEAMS }, (_, i) => ({
    rosterId: i + 1,
    seasonPoints: 0,
    weeks: new Map(
      ALL_WEEKS.map((w) => [
        w,
        {
          mean: i === 0 && w === CLUSTER_WEEK ? WEEK_MEAN - CLUSTER_DROP : WEEK_MEAN,
          sigma: CONSISTENCY_GROUPS[1].sigma,
        },
      ]),
    ),
  }));

  const results = simulateSurvival(teams, ALL_WEEKS, {
    runs: RUNS,
    seed: SEED,
    choppedPerWeek: CHOPPED_PER_WEEK,
  });

  const read = (rosterId: number, key: ClusterRow["key"], label: string): ClusterRow => {
    const r = results.get(rosterId)!;
    const before = r.pAliveAfter.get(CLUSTER_WEEK - 1) ?? 1;
    const after = r.pAliveAfter.get(CLUSTER_WEEK) ?? 0;
    return {
      key,
      label,
      // Conditional on reaching the week. An unconditional figure would mix in
      // the chance of having been chopped in weeks 1 to 8, which is the same
      // for both rosters and is not what the lesson is about.
      pChoppedInClusterWeek: before > 0 ? (before - after) / before : 0,
      weeksAlive: r.expectedWeeksAlive,
      pWin: r.pWin,
    };
  };

  return [
    read(1, "cluster", "Three starters on the same bye"),
    read(2, "spread", "The same starters, byes spread out"),
  ];
}

/* ------------------------------------------------------------------ *
 * 4. The three ladders the calculator actually applies
 * ------------------------------------------------------------------ */

const CHOPPED = DEFAULT_FAAB_SETTINGS.chopped;

/**
 * What the size of the surviving field does to a price, read straight off the
 * shipped defaults. Ordered high to low in the settings, which is both the
 * order priceByAliveFraction is matched in and the order a season moves
 * through.
 */
export const PRICE_BANDS = CHOPPED.priceByAliveFraction;

/** How much of the budget to still be holding, by week. Shipped defaults. */
export const PACE_TARGETS = CHOPPED.paceTargets;

/**
 * The 2024 guillotine champion's published ledger, as a share of a $1,000
 * budget. Quoted in the lesson's prose; here so the figure and the sentence
 * cannot disagree. Not ours, and not a target: one manager, one season.
 */
export const CHAMPION_LEDGER: { throughWeek: number; holdPct: number }[] = [
  { throughWeek: 4, holdPct: 96.9 },
  { throughWeek: 8, holdPct: 90.4 },
  { throughWeek: 12, holdPct: 24.0 },
  { throughWeek: 14, holdPct: 1.1 },
];

export type DangerRung = {
  key: "bottomTwo" | "nearCut" | "midPack" | "safe";
  label: string;
  multiplier: number;
  what: string;
};

/**
 * The multiplier the calculator's manual mode puts on a bid for where the
 * reader says they stand. The numbers are read from the defaults; the labels
 * and the sentences are the guide's, and they match the ladder in the prose.
 */
export const DANGER_RUNGS: DangerRung[] = [
  {
    key: "bottomTwo",
    label: "Bottom two this week",
    multiplier: CHOPPED.manualDangerMultipliers.bottomTwo,
    what: "You are bidding to stay in the league, so bid like it.",
  },
  {
    key: "nearCut",
    label: "Near the cut",
    multiplier: CHOPPED.manualDangerMultipliers.nearCut,
    what: "Pay over the odds for the floor, not for the ceiling.",
  },
  {
    key: "midPack",
    label: "Middle of the pack",
    multiplier: CHOPPED.manualDangerMultipliers.midPack,
    what: "No emergency. Buy the season, at a price you can repeat.",
  },
  {
    key: "safe",
    label: "Comfortably safe",
    multiplier: CHOPPED.manualDangerMultipliers.safe,
    what: "Let the desperate teams pay. Your money is worth more next week.",
  },
];
