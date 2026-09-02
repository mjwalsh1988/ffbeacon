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
  summariseLineup,
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
  rosters: EngineRoster[];
  /** One entry per (settled week, roster). */
  weeks: (WeekInput & { sleeperRosterId: number; startedIds: Set<string> })[];
  transactions: TransactionInput[];
  draftPicks: DraftPickInput[];
  players: Map<string, LedgerPlayer>;
  /** True when the league runs a FAAB budget, so a bid means something. */
  leagueHasFaab: boolean;
};

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
  const plan = planSlots(input.rosterPositions);
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

  const byRoster = new Map<number, WeekInput[]>();
  for (const week of input.weeks) {
    const list = byRoster.get(week.sleeperRosterId) ?? [];
    list.push(week);
    byRoster.set(week.sleeperRosterId, list);
  }

  const teams: LedgerTeam[] = input.rosters.map((roster) => {
    const weeks = (byRoster.get(roster.sleeperRosterId) ?? [])
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((week) => gradeWeek(plan, week, input.players));

    return {
      sleeperRosterId: roster.sleeperRosterId,
      teamName: roster.teamName,
      ownerHandle: roster.ownerHandle,
      lineup: summariseLineup(weeks),
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
  // Scoring uses the OFFICIAL totals, so it matches the league's own standings
  // rather than the gradable subset the efficiency figure is built on.
  const scoringRanks = rankDesc(
    teams.map((t) =>
      t.lineup.weeksGraded > 0
        ? t.lineup.weeks.reduce((sum, w) => sum + w.officialPoints, 0)
        : null,
    ),
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
