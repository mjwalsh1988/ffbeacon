/**
 * League leaders and the league-wide headline, for the Decisions page.
 *
 * Pure. Takes the view rows, returns plain data. No React, no formatting
 * decisions beyond the number itself, so the cards and the tiles can be
 * restyled without touching which team wins what.
 *
 * MODELLED ON `buildPulseLeaders` in lib/league-power-pulse-data.ts, and for
 * the same reason: a ranking table answers "who is first" and cannot answer
 * "who is the most interesting". The superlatives are where a reader finds
 * their own league's story, and they are the part people screenshot.
 *
 * ABSOLUTE RULE: A LEADER IS ONLY EVER AWARDED ON EVIDENCE. Every category
 * below returns nothing at all rather than a winner when the thing it measures
 * has not happened: no trades in the league means no best trader, a league
 * whose draft was never captured has no draft award, and a league with too few
 * finished weeks to rank has no lineup awards. Handing a trophy to whoever came
 * top of a column of zeroes is how a page that claims every figure is checkable
 * stops being believed.
 *
 * TIES ARE BROKEN BY ROSTER ID, not left to sort order. Two teams on the same
 * figure would otherwise swap the award between page loads, which reads as the
 * number moving when nothing has changed.
 */

import type { LedgerViewTeam } from "@/lib/league-manager-ledger-data";

/** One superlative, ready to render. */
export type LedgerLeader = {
  /** Drives the icon and accent in the card. */
  id: LedgerLeaderId;
  title: string;
  /** The figure, already formatted, because the card prints it verbatim. */
  value: string;
  /** One sentence naming what the figure is. Every word cites the number. */
  blurb: string;
  team: {
    sleeperRosterId: number;
    teamName: string;
    ownerLabel: string | null;
    ownerAvatarId: string | null;
  };
};

export type LedgerLeaderId =
  | "sharpest"
  | "most-left"
  | "games-given-away"
  | "best-waivers"
  | "best-trade"
  | "best-draft"
  | "carried"
  | "overachiever";

function pts(value: number): string {
  return value.toFixed(1);
}

function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

function identity(team: LedgerViewTeam): LedgerLeader["team"] {
  return {
    sleeperRosterId: team.sleeperRosterId,
    teamName: team.teamName,
    ownerLabel: team.ownerLabel,
    ownerAvatarId: team.ownerAvatarId,
  };
}

/**
 * The team with the highest `score`, among those `eligible` admits.
 *
 * Returns null when nothing is eligible, which is what makes every award
 * conditional on evidence rather than on somebody being least bad.
 */
function best(
  teams: LedgerViewTeam[],
  eligible: (team: LedgerViewTeam) => boolean,
  score: (team: LedgerViewTeam) => number,
): LedgerViewTeam | null {
  let winner: LedgerViewTeam | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const team of teams) {
    if (!eligible(team)) continue;
    const value = score(team);
    if (!Number.isFinite(value)) continue;
    if (
      value > bestScore ||
      (value === bestScore && winner !== null && team.sleeperRosterId < winner.sleeperRosterId)
    ) {
      winner = team;
      bestScore = value;
    }
  }
  return winner;
}

export function buildLedgerLeaders(teams: LedgerViewTeam[]): LedgerLeader[] {
  const out: LedgerLeader[] = [];
  if (teams.length === 0) return out;

  const ranked = (team: LedgerViewTeam) => team.efficiencyRank !== null;
  const total = teams.length;

  const sharpest = best(teams, ranked, (t) => t.efficiency ?? 0);
  if (sharpest && sharpest.efficiency !== null) {
    out.push({
      id: "sharpest",
      title: "Sharpest lineups",
      value: `${Math.round(sharpest.efficiency * 100)}%`,
      blurb: "Started more of their own roster's points than anyone.",
      team: identity(sharpest),
    });
  }

  const mostLeft = best(teams, ranked, (t) => t.pointsLeft);
  if (mostLeft) {
    out.push({
      id: "most-left",
      title: "Most points left behind",
      value: pts(mostLeft.pointsLeft),
      blurb:
        mostLeft.pointsLeftPerWeek === null
          ? "Points left on the bench."
          : `Points left on the bench, ${pts(mostLeft.pointsLeftPerWeek)} a week.`,
      team: identity(mostLeft),
    });
  }

  // Only awarded when a game actually turned on it. Nobody is handed this for
  // topping a column of zeroes.
  const givenAway = best(
    teams,
    (t) => ranked(t) && t.winsLeftOnBench > 0,
    (t) => t.winsLeftOnBench,
  );
  if (givenAway) {
    out.push({
      id: "games-given-away",
      title: "Most wins left behind",
      value: String(givenAway.winsLeftOnBench),
      blurb: "Losses their own bench would have won.",
      team: identity(givenAway),
    });
  }

  const waivers = best(
    teams,
    (t) => t.waiverMoves > 0 && t.waiverPointsStarted > 0,
    (t) => t.waiverPointsStarted,
  );
  if (waivers) {
    out.push({
      id: "best-waivers",
      title: "Best off waivers",
      value: pts(waivers.waiverPointsStarted),
      blurb: `Points started from ${waivers.waiverMoves} pickup${waivers.waiverMoves === 1 ? "" : "s"}. ${waivers.waiverHits} made the lineup.`,
      team: identity(waivers),
    });
  }

  const trader = best(
    teams,
    (t) => t.tradeCount > 0 && t.tradeNet > 0,
    (t) => t.tradeNet,
  );
  if (trader) {
    out.push({
      id: "best-trade",
      title: "Won the trades",
      value: signed(trader.tradeNet),
      blurb: `Points in minus points out over ${trader.tradeCount} trade${trader.tradeCount === 1 ? "" : "s"}.${trader.tradeAnyPicks ? " Picks not counted." : ""}`,
      team: identity(trader),
    });
  }

  const drafter = best(
    teams,
    (t) => t.draftPicks > 0 && t.draftAboveBaseline > 0,
    (t) => t.draftAboveBaseline,
  );
  if (drafter) {
    out.push({
      id: "best-draft",
      title: "Best draft",
      value: signed(drafter.draftAboveBaseline),
      blurb: `Points above what the room took in the same rounds, over ${drafter.draftPicks} picks.`,
      team: identity(drafter),
    });
  }

  // The two that ARE the page. Both need a real gap, so a league where every
  // manager ranks about where their roster does gets neither, which is the
  // correct thing to say about that league.
  const gapOf = (t: LedgerViewTeam) =>
    t.efficiencyRank === null || t.scoringRank === null
      ? Number.NaN
      : t.scoringRank - t.efficiencyRank;

  const overachiever = best(
    teams,
    (t) => Number.isFinite(gapOf(t)) && gapOf(t) >= 2,
    gapOf,
  );
  if (overachiever && overachiever.efficiencyRank !== null && overachiever.scoringRank !== null) {
    out.push({
      id: "overachiever",
      title: "Most out of the least",
      value: `${overachiever.scoringRank} to ${overachiever.efficiencyRank}`,
      blurb: `${ordinalish(overachiever.scoringRank)} of ${total} on points, ${ordinalish(overachiever.efficiencyRank)} on decisions. Squeezing a lot out of a little.`,
      team: identity(overachiever),
    });
  }

  const carried = best(
    teams,
    (t) => Number.isFinite(gapOf(t)) && gapOf(t) <= -2,
    (t) => -gapOf(t),
  );
  if (carried && carried.efficiencyRank !== null && carried.scoringRank !== null) {
    out.push({
      id: "carried",
      title: "Carried by the roster",
      value: `${carried.scoringRank} to ${carried.efficiencyRank}`,
      blurb: `${ordinalish(carried.scoringRank)} of ${total} on points, ${ordinalish(carried.efficiencyRank)} on decisions. The roster is doing the work.`,
      team: identity(carried),
    });
  }

  return out;
}

/** "1st", "2nd", "12th". Local so this file stays free of component imports. */
function ordinalish(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The three league-wide figures the page leads with. */
export type LedgerHeadline = {
  /** Games lost across the league that the losing bench would have won. */
  winsLeftOnBench: number;
  /** Every point every manager left on a bench, added up. */
  pointsLeft: number;
  /** Mean share started, across the teams that have enough weeks to rank. */
  averageEfficiency: number | null;
  /** How many finished weeks these figures cover. */
  gradedWeeks: number;
};

export function buildLedgerHeadline(
  teams: LedgerViewTeam[],
  gradedWeeks: number,
): LedgerHeadline {
  let winsLeftOnBench = 0;
  let pointsLeft = 0;
  let efficiencySum = 0;
  let efficiencyCount = 0;

  for (const team of teams) {
    winsLeftOnBench += team.winsLeftOnBench;
    pointsLeft += team.pointsLeft;
    // Averaged over the RANKED teams only. A roster with two finished weeks has
    // a real efficiency but not a comparable one, and letting it into a league
    // average would move a headline figure by an amount that says nothing.
    if (team.efficiencyRank !== null && team.efficiency !== null) {
      efficiencySum += team.efficiency;
      efficiencyCount += 1;
    }
  }

  return {
    winsLeftOnBench,
    pointsLeft: Math.round(pointsLeft * 10) / 10,
    averageEfficiency: efficiencyCount > 0 ? efficiencySum / efficiencyCount : null,
    gradedWeeks,
  };
}
