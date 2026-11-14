/**
 * The Manager Ledger calculation.
 *
 * Pure. Takes plain data, returns plain data, touches no database and no clock.
 * The orchestrator in lib/league-manager-ledger.ts does all the reading and
 * writing; this file does all the arithmetic, which is what makes it testable
 * without a league.
 *
 * WHAT IT DOES NOT DO, ON PURPOSE
 *   It computes no composite score. Every other model here resists the
 *   temptation to blend its own inputs into one number, and this one has four
 *   ledgers that are genuinely about different things: a manager can draft
 *   badly, trade well, and set a perfect lineup, and averaging those into a 74
 *   would destroy the only interesting thing about that season. So the output
 *   is four ledgers and four ranks, plus a fifth rank for total points scored,
 *   and the page puts them next to each other.
 *
 *   That fifth rank is what makes the page answer the question every league
 *   argues about. Scoring rank is the ROSTER. Efficiency rank is the MANAGER.
 *   The all-play luck figure the Schedule page already computes is the
 *   SCHEDULE. A team that is first in scoring and last in efficiency was
 *   carried; one that is last in scoring and first in efficiency got
 *   everything there was to get.
 */

import { MIN_WEEKS_FOR_RANK } from "./default-settings";
import {
  gradeWeek,
  planSlots,
  summarizeLineup,
  type LedgerPlayer,
  type WeekInput,
} from "./lineup";
import {
  buildDraftLedger,
  buildTradeLedger,
  buildWaiverLedger,
  LedgerIndex,
  roundBaselines,
  type DraftPickInput,
  type IndexedWeek,
  type TransactionInput,
} from "./moves";
import type { LedgerResult, LedgerSkip, LedgerTeam } from "./types";
import { DEFAULT_LEDGER_RULES, isRegularSeasonWeek, type LedgerRules } from "./rules";

/** One roster, as the engine reads it. */
export type EngineRoster = {
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
};

/** Everything one league season needs to be graded. */
export type EngineInput = {
  season: number;
  rosterPositions: string[];
  /**
   * The IDP switch, read once by the orchestrator (plan R-25, IDP-310). Absent
   * or false: defensive slots are ungradable, exactly as before. True: they are
   * graded on what their defenders actually scored.
   */
  idpEnabled?: boolean;
  rosters: EngineRoster[];
  /** One entry per (settled week, roster). */
  weeks: (WeekInput & { sleeperRosterId: number; startedIds: Set<string> })[];
  transactions: TransactionInput[];
  draftPicks: DraftPickInput[];
  players: Map<string, LedgerPlayer>;
  /** True when the league runs a FAAB budget, so a bid means something. */
  leagueHasFaab: boolean;
  /**
   * League kind, playoff start and median game (./rules.ts). Absent means a
   * plain league with no playoffs and no median game.
   */
  rules?: LedgerRules;
};

type EngineWeek = EngineInput["weeks"][number];

/** The median of a list, the mean of the middle two for an even count. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fit each settled week to the league's rules before it is graded.
 *
 *   Playoff weeks are flagged, so the record counts the regular season only.
 *   A median-game league gets each regular season week's median attached.
 *   A chopped league has no opponent: a roster that started nobody that week
 *   was already cut and is dropped, and every live roster is read against the
 *   cut line, the lowest score among the OTHER live rosters that week. Beat it
 *   and the week was survived.
 */
export function applyLedgerRules(weeks: EngineWeek[], rules: LedgerRules): EngineWeek[] {
  const live = rules.chopped ? weeks.filter((w) => w.startedIds.size > 0) : weeks;

  const byWeek = new Map<number, EngineWeek[]>();
  for (const w of live) {
    const list = byWeek.get(w.week) ?? [];
    list.push(w);
    byWeek.set(w.week, list);
  }

  return live.map((w) => {
    const regular = isRegularSeasonWeek(w.week, rules);
    const same = byWeek.get(w.week) ?? [];
    const out: EngineWeek = { ...w };
    if (!regular) out.playoff = true;
    if (rules.medianGame && regular) {
      out.medianPoints = median(same.map((s) => s.officialPoints));
    }
    if (rules.chopped) {
      const others = same
        .filter((s) => s.sleeperRosterId !== w.sleeperRosterId)
        .map((s) => s.officialPoints);
      out.opponentPoints = others.length > 0 ? Math.min(...others) : null;
    }
    return out;
  });
}

/**
 * Best ball sets its own lineup, so there is no lineup decision to grade. The
 * record stays (it is the league's own), and everything that measures a
 * lineup choice is cleared rather than reported as a perfect score.
 */
function withoutLineupGrading(lineup: LedgerTeam["lineup"]): LedgerTeam["lineup"] {
  return {
    ...lineup,
    pointsLeft: 0,
    efficiency: null,
    bestLineupRecord: { ...lineup.actualRecord },
    winsLeftOnBench: 0,
    weeks: lineup.weeks.map((w) => {
      const week = {
        ...w,
        pointsLeft: 0,
        bestLineupOutcome: w.outcome,
        biggestMiss: null,
      };
      if (w.medianOutcome !== undefined) week.bestLineupMedianOutcome = w.medianOutcome;
      return week;
    }),
  };
}

/**
 * Standard competition ranking over a list of values, highest first.
 *
 * Ties share a rank, and the next rank skips accordingly, which is what a
 * reader expects from a leaderboard. A null value is unranked rather than last:
 * a roster with too few graded weeks has not earned a position, and putting it
 * at the bottom would read as a verdict.
 */
export function rankDesc(values: (number | null)[]): (number | null)[] {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .filter(
      (entry): entry is { value: number; index: number } =>
        entry.value !== null,
    )
    .sort((a, b) => b.value - a.value);

  const out: (number | null)[] = values.map(() => null);
  let rank = 0;
  let seen = 0;
  let previous: number | null = null;
  for (const entry of indexed) {
    seen += 1;
    if (previous === null || entry.value !== previous) {
      rank = seen;
      previous = entry.value;
    }
    out[entry.index] = rank;
  }
  return out;
}

/**
 * Grade one league season.
 *
 * Returns a skip rather than an empty result when there is nothing to grade,
 * so the caller can record an honest reason instead of storing a page full of
 * zeroes that would read as a real answer about a league that has not played.
 */
export function computeLedger(input: EngineInput): LedgerResult | LedgerSkip {
  if (input.rosters.length === 0) {
    return { skipped: "no rosters stored for this league" };
  }
  const plan = planSlots(input.rosterPositions, input.idpEnabled === true);
  if (plan.gradableTokens.length === 0) {
    return { skipped: "league has no startable slots this model can grade" };
  }
  if (input.weeks.length === 0) {
    return { skipped: "no settled weeks yet this season" };
  }

  const indexed: IndexedWeek[] = input.weeks.map((week) => ({
    week: week.week,
    sleeperRosterId: week.sleeperRosterId,
    playerPoints: week.playerPoints,
    startedIds: week.startedIds,
  }));
  const index = new LedgerIndex(indexed);
  const baselines = roundBaselines(input.draftPicks, index);

  // The index above reads every settled row, because ownership is ownership
  // whatever the week. The lineup grading below reads the weeks fitted to the
  // league's rules.
  const rules = input.rules ?? DEFAULT_LEDGER_RULES;
  const ruledWeeks = applyLedgerRules(input.weeks, rules);

  const byRoster = new Map<number, WeekInput[]>();
  for (const week of ruledWeeks) {
    const list = byRoster.get(week.sleeperRosterId) ?? [];
    list.push(week);
    byRoster.set(week.sleeperRosterId, list);
  }

  const teams: LedgerTeam[] = input.rosters.map((roster) => {
    const weeks = (byRoster.get(roster.sleeperRosterId) ?? [])
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((week) => gradeWeek(plan, week, input.players));

    const lineup = summarizeLineup(weeks);
    return {
      sleeperRosterId: roster.sleeperRosterId,
      teamName: roster.teamName,
      ownerHandle: roster.ownerHandle,
      lineup: rules.bestBall ? withoutLineupGrading(lineup) : lineup,
      waivers: buildWaiverLedger(
        roster.sleeperRosterId,
        input.transactions,
        index,
        input.players,
        input.leagueHasFaab,
      ),
      trades: buildTradeLedger(
        roster.sleeperRosterId,
        input.transactions,
        index,
        input.players,
      ),
      draft: buildDraftLedger(
        roster.sleeperRosterId,
        input.draftPicks,
        baselines,
        index,
        input.players,
      ),
      efficiencyRank: null,
      waiverRank: null,
      tradeRank: null,
      draftRank: null,
      scoringRank: null,
    };
  });

  // Efficiency is withheld from the leaderboard until there is enough of a
  // season to be evidence about a manager. The ledger itself is still computed
  // and still shown; only the rank is null, and the page says why.
  const efficiencyRanks = rankDesc(
    teams.map((t) =>
      t.lineup.weeksGraded >= MIN_WEEKS_FOR_RANK ? t.lineup.efficiency : null,
    ),
  );
  const waiverRanks = rankDesc(
    teams.map((t) => (t.waivers.moves > 0 ? t.waivers.pointsStarted : null)),
  );
  const tradeRanks = rankDesc(
    teams.map((t) => (t.trades.trades > 0 ? t.trades.net : null)),
  );
  const draftRanks = rankDesc(
    teams.map((t) => (t.draft.picks > 0 ? t.draft.aboveBaseline : null)),
  );
  // Scoring uses the OFFICIAL totals over the REGULAR SEASON, so it matches
  // the league's own standings rather than the gradable subset the efficiency
  // figure is built on, and a team does not climb it by playing extra
  // playoff games.
  const scoringRanks = rankDesc(
    teams.map((t) => {
      const regular = t.lineup.weeks.filter((w) => !w.playoff);
      return regular.length > 0
        ? regular.reduce((sum, w) => sum + w.officialPoints, 0)
        : null;
    }),
  );

  teams.forEach((team, i) => {
    team.efficiencyRank = efficiencyRanks[i];
    team.waiverRank = waiverRanks[i];
    team.tradeRank = tradeRanks[i];
    team.draftRank = draftRanks[i];
    team.scoringRank = scoringRanks[i];
  });

  const gradedWeeks = [...new Set(input.weeks.map((w) => w.week))].sort(
    (a, b) => a - b,
  );

  return {
    season: input.season,
    gradedWeeks,
    gradableSlots: plan.gradableTokens,
    ungradableSlots: plan.ungradableTokens,
    teams,
  };
}

/** Narrowing helper, so callers do not repeat the `in` check. */
export function isLedgerSkip(
  value: LedgerResult | LedgerSkip,
): value is LedgerSkip {
  return "skipped" in value;
}
