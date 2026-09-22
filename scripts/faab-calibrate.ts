/**
 * What does the calculator actually recommend, and is it anywhere near what
 * real leagues pay?
 *
 * The replay in `lib/faab/replay.ts` grades the PRICE half of the ladder only,
 * because historical rosters are not stored and the worth half cannot be
 * reconstructed. That left the two halves that produce the printed number,
 * rival bid centres and the worth cap, with no measurement at all.
 *
 * This fills that gap the only way available: it builds synthetic auctions
 * whose shape we know (how many rivals want him, how big an upgrade he is)
 * and prints the recommended bid beside the real market quantiles for that
 * exact situation out of `faab_market_priors`. A recommendation sitting above
 * the p90 of every comparable auction is wrong whatever the model believes.
 *
 * Read only. No writes, no league sync, no Sleeper call.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { simulateAuction, type AuctionRival } from "@/lib/faab/auction";
import { buildLadder } from "@/lib/faab/ladder";
import { DEFAULT_FAAB_SETTINGS } from "@/lib/faab/default-settings";
import { upgradeStrengthOf } from "@/lib/faab/ladder";
import type { FaabSettings, MarginalValue, MarketRead } from "@/lib/faab/types";

const settings: FaabSettings = DEFAULT_FAAB_SETTINGS;

function marginalFor(netPointsPerWeek: number, oddsGain: number, weeks: number): MarginalValue {
  return {
    weeksConsidered: weeks,
    weeksStarting: weeks,
    pointsPerWeek: netPointsPerWeek,
    pointsPerStartedWeek: netPointsPerWeek,
    netPointsPerWeek,
    expectedWinsAdded: null,
    playoffOddsBefore: 45,
    playoffOddsAfter: 45 + oddsGain,
    titleOddsBefore: 8,
    titleOddsAfter: 8 + oddsGain / 4,
    weeks: [],
    dropCost: null,
    dropOptions: [],
    dropNote: null,
    isBenchOnly: false,
  };
}

const market: MarketRead = {
  yourBudget: 0,
  yourBudgetPct: 0,
  rivalMedianBudget: null,
  richestRival: null,
  budgetMultiplier: 1,
  interestedRivals: 0,
  rivalsChecked: 11,
  needMultiplier: 1,
  calendarMultiplier: 1,
  urgencyMultiplier: 1,
  comparable: null,
  weeksLeft: 10,
} as unknown as MarketRead;

type Scenario = {
  label: string;
  totalBudget: number;
  teams: number;
  /** Points a week this player adds to the READER's optimal lineup. */
  myPoints: number;
  /** Points a week he adds to each interested rival, high to low. */
  rivalPoints: number[];
  oddsGain: number;
  weeks: number;
  /** Which market cell to compare against. */
  cell: { leagueKind: string; phase: string };
  /** Chopped only: worth as the chopped branch computes it, 0 to 100. */
  choppedWorthPct?: number;
  /** How close he is to a genuine starter on the market, 0 to 1. */
  scarcityShare?: number;
  /** Which calendar band the scenario sits in. */
  calendarMultiplier?: number;
};

const SCENARIOS: Scenario[] = [
  {
    label: "Redraft 12T, streaming QB (Cam Ward shape), wk 3",
    totalBudget: 150,
    teams: 12,
    myPoints: 4.5,
    rivalPoints: [3.5, 3.0, 2.4, 1.8, 1.2],
    oddsGain: 6,
    weeks: 12,
    cell: { leagueKind: "redraft", phase: "wk2_6" },
    scarcityShare: 0.35,
    calendarMultiplier: 1.2,
  },
  {
    label: "Redraft 12T, genuine league winner (RB1 workload), wk 3",
    totalBudget: 150,
    teams: 12,
    myPoints: 12,
    rivalPoints: [10, 9, 8, 7, 6, 5],
    oddsGain: 18,
    weeks: 12,
    cell: { leagueKind: "redraft", phase: "wk2_6" },
    scarcityShare: 0.95,
    calendarMultiplier: 1.2,
  },
  {
    label: "Redraft 12T, flex depth add, wk 8",
    totalBudget: 100,
    teams: 12,
    myPoints: 2.0,
    rivalPoints: [1.6, 1.2],
    oddsGain: 2,
    weeks: 7,
    cell: { leagueKind: "redraft", phase: "wk7_10" },
    scarcityShare: 0.15,
    calendarMultiplier: 0.9,
  },
  {
    label: "Chopped 18T, elite RB (Bijan shape), wk 3, 15 alive",
    totalBudget: 1000,
    teams: 18,
    myPoints: 13,
    rivalPoints: [12, 11, 10, 9, 9, 8, 8, 7, 6, 6, 5, 4],
    oddsGain: 20,
    weeks: 14,
    cell: { leagueKind: "chopped", phase: "alive_50p" },
    // choppedStrength saturated: survival, league win and weeks alive all
    // maxed. 70 * 1.0 (over half the field still alive).
    choppedWorthPct: 70,
    scarcityShare: 1.0,
  },
  {
    label: "Chopped 18T, fringe RB2 (Javonte shape), wk 3, 15 alive",
    totalBudget: 1000,
    teams: 18,
    myPoints: 4.5,
    rivalPoints: [4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.2],
    oddsGain: 7,
    weeks: 14,
    cell: { leagueKind: "chopped", phase: "alive_50p" },
    // A real but ordinary upgrade: about a third of the chopped strength scale.
    choppedWorthPct: 24,
    scarcityShare: 0.45,
  },
];

function run(scenario: Scenario) {
  const { totalBudget } = scenario;
  // Everyone still holds most of their money, which is the situation a week 3
  // claim actually happens in.
  const budgetPct = 85;

  const rivals: AuctionRival[] = [];
  for (let i = 0; i < scenario.teams - 1; i += 1) {
    const points = scenario.rivalPoints[i] ?? 0;
    const interested = points >= settings.market.rivalNeed.minPointsPerWeek;
    const worth =
      upgradeStrengthOf(marginalFor(points, 0, scenario.weeks), settings.marginal) *
      settings.marginal.maxPctFromUpgrade;
    rivals.push({
      rosterId: i + 2,
      budgetPct,
      interested,
      centerPct: worth,
      waiverPosition: null,
    });
  }

  const calendar = scenario.calendarMultiplier ?? 1;
  for (const r of rivals) r.centerPct *= calendar;

  const curve = simulateAuction({
    yourBudgetPct: budgetPct,
    yourWaiverPosition: null,
    rivals,
    strayCell: null,
    settings: settings.auction,
    seed: 7,
    totalBudget,
    minBid: 0,
    scarcityShare: scenario.scarcityShare ?? null,
  });

  const out = buildLadder({
    marginal: marginalFor(scenario.myPoints, scenario.oddsGain, scenario.weeks),
    playerSignals: [],
    marketSignals: [],
    market: {
      ...market,
      interestedRivals: rivals.filter((r) => r.interested).length,
      rivalsChecked: rivals.length,
    } as MarketRead,
    remainingBudget: Math.round((budgetPct / 100) * totalBudget),
    totalBudget,
    minBid: 0,
    needLevel: "medium",
    mode: "league",
    settings,
    confidence: "medium",
    goal: "value",
    winChanceAt: curve.winChanceAt,
    rivalTop: curve.rivalTop,
    noRivalShare: curve.noRivalShare,
    interestedRivals: rivals.filter((r) => r.interested).length,
    worthPctOverride: scenario.choppedWorthPct ?? null,
    scarcityShare: scenario.scarcityShare ?? null,
  });

  const pct = (d: number) => ((d / totalBudget) * 100).toFixed(1);
  return {
    label: scenario.label,
    cell: scenario.cell,
    interested: rivals.filter((r) => r.interested).length,
    bid: out.ladder.bid.dollars,
    warned: out.notices.find((n) => n.includes("chases rather than prices") || n.includes("scatter a long way")) ?? null,
    bidPct: pct(out.ladder.bid.dollars),
    surePct: pct(out.ladder.bidsByGoal.sure.dollars),
    walkAwayPct: pct(out.ladder.walkAway.dollars),
    worthPct: out.worthPct.toFixed(1),
    dump: out.isDumpCandidate,
    rivalTopP50Pct: pct(curve.rivalTop.p50),
    rivalTopP90Pct: pct(curve.rivalTop.p90),
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const supabase =
    url && key ? createClient<Database>(url, key, { auth: { persistSession: false } }) : null;

  const rows = run.length >= 0 ? SCENARIOS.map(run) : [];

  for (const row of rows) {
    let marketLine = "no priors client";
    if (supabase) {
      const { data } = await supabase
        .from("faab_market_priors")
        .select("sample_size, p50, p75, p90, p99")
        .eq("league_kind", row.cell.leagueKind)
        .eq("superflex", "any")
        .eq("position", "any")
        .eq("phase", row.cell.phase)
        .eq("bidders", row.interested >= 4 ? "4p" : String(Math.max(1, row.interested)))
        .maybeSingle();
      marketLine = data
        ? `real: p50 ${data.p50}%  p75 ${data.p75}%  p90 ${data.p90}%  p99 ${data.p99}%  (n=${data.sample_size})`
        : "real: no cell";
    }

    console.log("");
    console.log(row.label);
    console.log(
      `  bidders simulated: ${row.interested} interested   dump: ${row.dump ? "YES" : "no"}`,
    );
    console.log(
      `  model: bid ${row.bidPct}%  sure ${row.surePct}%  walk-away ${row.walkAwayPct}%  worth ${row.worthPct}%`,
    );
    console.log(`  model top rival: p50 ${row.rivalTopP50Pct}%  p90 ${row.rivalTopP90Pct}%`);
    console.log(`  ${marketLine}`);
    if (row.warned) console.log(`  WARNS: ${row.warned}`);
  }
  console.log("");
}

void main();
