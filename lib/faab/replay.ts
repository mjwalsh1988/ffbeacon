/**
 * Would the number we print have won the auction that actually happened?
 *
 * This replaces the calibration in `backtest.ts`, which could only ask whether
 * the model's price curve landed in the same neighbourhood as a league's real
 * bids. This asks the sharper question, auction by auction: here is a claim
 * somebody actually won, here is what the model would have recommended that
 * morning, and would it have been enough.
 *
 * WHAT THE MODEL IS ALLOWED TO KNOW, AND WHY THE LIST IS SHORT
 *   Historical rosters are not stored. `rosters` holds current state only, so
 *   the lineup a manager was trying to fix in week 6 of 2024 is gone, and with
 *   it the upgrade strength that drives the worth half of the ladder. Inventing
 *   a replacement level to stand in for it would reintroduce exactly the
 *   assumption this rewrite removed, and a replay built on a fiction is worse
 *   than no replay, because it produces a number people trust.
 *
 *   So the replay grades the PRICE half of the ladder, which is the half that
 *   is genuinely recoverable:
 *     - the priors curve for the auction's own cell (7.8 rule 11), at the room
 *       the auction actually had. The cell dimension counts TOTAL bidders, the
 *       winner included, so it is not double counting the reader and must not
 *       be reduced by one to compensate. See `replayOne` for what that mistake
 *       costs.
 *     - the league's heat, computed from auctions strictly BEFORE this one, so
 *       nothing from the auction being graded, or from the same week, can leak
 *       into the number that is supposed to predict it;
 *     - tendency ignored, because tendency is about one named manager and the
 *       replay has no reader to be.
 *
 *   The worth cap (ladder rules 2, 4 and 5) is therefore NOT applied, and the
 *   reader's remaining budget is unknown, so the bid is capped at the league's
 *   full budget. Both facts are stated by the script that prints this, because
 *   a win share measured without the worth cap is an upper bound on the real
 *   one and must not be read as anything else.
 *
 * HEAT ENTERS AS THE STYLE MULTIPLIER, on purpose. In manual mode the style
 * multiplier is the "this room bids high" dial, and `bidForTargetFromCell`
 * divides the bid's share of budget by it before reading the market curve. A
 * league with heat 1.4 pays about 40% over the market for the same situation,
 * which is the same statement, so heat is passed straight into that slot
 * rather than given a second mechanism that would have to agree with the
 * first.
 *
 * Every figure out of here is a SHARE OF THE LEAGUE'S FULL BUDGET, 0 to 100,
 * for the same reason the priors are: a $12 bid in a $100 league and a $120 bid
 * in a $1,000 league are the same decision.
 *
 * Pure. No client, no clock, no Math.random, no I/O.
 */

import {
  biddersKey,
  choppedPhase,
  percentile,
  standardPhase,
  type PriorLeagueKind,
} from "./priors-build";
import { bidForTargetFromCell, pickCell, type PriorCell } from "./priors-math";
import { computeLeagueTendencies, type TendencyAuction } from "./tendency";
import type { AuctionSettings, FaabSettings } from "./types";

/** One bid in a settled auction, in dollars and as a share of the full budget. */
export type ReplayBid = { rosterId: number; amount: number; pct: number };

/** One settled auction, as the replay needs it. */
export type ReplayAuction = {
  leagueId: string;
  season: number;
  week: number;
  leagueKind: PriorLeagueKind;
  superflex: boolean;
  /** Uppercase position, or null when we hold no position for the player. */
  position: string | null;
  /** Chopped only: rosters still alive that week over rosters at the start. */
  aliveFraction: number | null;
  /** The league's per-team FAAB allowance. Always above zero. */
  totalBudget: number;
  /** Every bid, winner included, sorted high to low. */
  bids: ReplayBid[];
  winningAmount: number;
  winningPct: number;
};

export type ReplayOptions = {
  /** Win chance the value goal aims at, 0 to 1. */
  valueTarget: number;
  /** Win chance the sure goal aims at, 0 to 1. */
  sureTarget: number;
  minCellSamples: number;
  /** Standard leagues skip weeks below this. Week 1 is a different market. */
  minStandardWeek: number;
  oddNudge: boolean;
  /** Heat shrink, clamps and the contested-week floor. */
  auction: AuctionSettings;
};

/** How one auction graded, kept so a caller can print or spot-check rows. */
export type ReplayOutcome = {
  leagueId: string;
  season: number;
  week: number;
  bucket: string;
  heat: number;
  cellKey: string;
  cellSamples: number;
  valueBid: number;
  sureBid: number;
  /** 1 for a win, 0.5 for a tie with the real winner, 0 for a loss. */
  valueScore: number;
  sureScore: number;
  /** Bid minus the real winning bid, shares of budget, on strict wins only. */
  valueOverpayPct: number | null;
  sureOverpayPct: number | null;
  /** The target was out of reach, so the bid is the whole budget. */
  valueAtBudgetCap: boolean;
  sureAtBudgetCap: boolean;
};

export type ReplayBucket = {
  key: string;
  label: string;
  sampleSize: number;
  /** Share of auctions the goal's bid would have won. Ties count 0.5. */
  valueWinShare: number;
  sureWinShare: number;
  /** Auctions the bid strictly beat, which is the overpay sample. */
  valueWins: number;
  sureWins: number;
  /** Median of (bid minus winner), shares of budget, over those wins. */
  valueMedianOverpayPct: number | null;
  sureMedianOverpayPct: number | null;
};

export type ReplaySummary = {
  overall: ReplayBucket;
  /** Standard-league phases, in calendar order. */
  standard: ReplayBucket[];
  /** Chopped phases, from a full field down to a nearly empty one. */
  chopped: ReplayBucket[];
  /** Auctions that cleared the filters and found a cell. */
  graded: number;
  /** Auctions with fewer than two bids, or below the week floor. */
  skipped: number;
  /** Auctions that cleared the filters but had no market cell to price from. */
  unpriced: number;
  /** Distinct leagues behind the graded auctions. */
  leagues: number;
  /** How often the target was out of reach and the bid hit the budget cap. */
  valueAtBudgetCap: number;
  sureAtBudgetCap: number;
};

/** Standard leagues skip week 1: budgets are full and half the room bids. */
export const REPLAY_MIN_STANDARD_WEEK = 2;

const BUCKET_LABELS: Record<string, string> = {
  overall: "All auctions",
  wk1: "Week 1",
  wk2_6: "Weeks 2 to 6",
  wk7_10: "Weeks 7 to 10",
  wk11_13: "Weeks 11 to 13",
  wk14p: "Week 14 on",
  unknown: "Week not known",
  alive_50p: "Half the field or more alive",
  alive_30_50: "30 to 50 percent alive",
  alive_lt30: "Under 30 percent alive",
  alive_unknown: "Field size not known",
};

const STANDARD_ORDER = ["wk1", "wk2_6", "wk7_10", "wk11_13", "wk14p", "unknown"];
const CHOPPED_ORDER = ["alive_50p", "alive_30_50", "alive_lt30", "alive_unknown"];

export function replayOptionsFrom(settings: FaabSettings): ReplayOptions {
  return {
    valueTarget: settings.goal.valueTarget,
    sureTarget: settings.goal.sureTarget,
    minCellSamples: settings.priors.minCellSamples,
    minStandardWeek: REPLAY_MIN_STANDARD_WEEK,
    oddNudge: settings.auction.oddNudge,
    auction: settings.auction,
  };
}

/**
 * A bid over the real winner wins, a bid under it loses, and a bid level with
 * it is half a win.
 *
 * The tie is a genuine coin flip rather than a hedge. Sleeper breaks equal FAAB
 * bids on waiver priority, which we do not hold as of the morning of the claim,
 * so calling it either way would be asserting something we cannot check.
 */
export function gradeBid(bidAmount: number, winningAmount: number): number {
  if (bidAmount > winningAmount) return 1;
  if (bidAmount === winningAmount) return 0.5;
  return 0;
}

/** Which phase cell an auction is priced from. Mirrors the priors builder. */
function cellPhaseFor(auction: ReplayAuction): string | null {
  if (auction.leagueKind === "chopped") return choppedPhase(auction.aliveFraction);
  // Dynasty weeks 0 and 1 are offseason rookie and startup claims, excluded
  // from the phase cells for the same reason the builder excludes them.
  if (auction.leagueKind === "dynasty" && auction.week <= 1) return null;
  return standardPhase(auction.week);
}

/** Which bucket an auction is reported in. */
export function bucketKeyFor(auction: ReplayAuction): string {
  if (auction.leagueKind === "chopped") {
    return choppedPhase(auction.aliveFraction) ?? "alive_unknown";
  }
  return standardPhase(auction.week) ?? "unknown";
}

function isUsable(auction: ReplayAuction, options: ReplayOptions): boolean {
  if (auction.bids.length < 2) return false;
  if (auction.totalBudget <= 0) return false;
  // Chopped leagues run their market from week 1: the pool is a whole roster
  // and everybody is already bidding.
  if (auction.leagueKind !== "chopped" && auction.week < options.minStandardWeek) return false;
  return true;
}

function cellFor(
  auction: ReplayAuction,
  cells: PriorCell[],
  bidderCount: number,
  minCellSamples: number,
): PriorCell | null {
  const picked = pickCell(
    cells,
    {
      leagueKind: auction.leagueKind,
      superflex: auction.superflex,
      position: auction.position,
      phase: cellPhaseFor(auction),
      bidders: biddersKey(bidderCount),
    },
    minCellSamples,
  );
  return picked ? picked.cell : null;
}

/**
 * The odd nudge, ladder rule 8. Ties are common on round numbers, so a bid of
 * 10, 15 or 20 buys a coin flip that 11, 16 or 21 wins outright for a dollar.
 */
function nudge(bid: number, cap: number, enabled: boolean): number {
  if (!enabled) return bid;
  if (bid < 10) return bid;
  if (bid % 5 !== 0) return bid;
  if (bid + 1 > cap) return bid;
  return bid + 1;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

type Accumulator = {
  sampleSize: number;
  valueScore: number;
  sureScore: number;
  valueOverpays: number[];
  sureOverpays: number[];
};

function emptyAccumulator(): Accumulator {
  return { sampleSize: 0, valueScore: 0, sureScore: 0, valueOverpays: [], sureOverpays: [] };
}

function addOutcome(acc: Accumulator, outcome: ReplayOutcome): void {
  acc.sampleSize += 1;
  acc.valueScore += outcome.valueScore;
  acc.sureScore += outcome.sureScore;
  if (outcome.valueOverpayPct !== null) acc.valueOverpays.push(outcome.valueOverpayPct);
  if (outcome.sureOverpayPct !== null) acc.sureOverpays.push(outcome.sureOverpayPct);
}

function toBucket(key: string, acc: Accumulator): ReplayBucket {
  const n = acc.sampleSize;
  return {
    key,
    label: BUCKET_LABELS[key] ?? key,
    sampleSize: n,
    valueWinShare: n === 0 ? 0 : acc.valueScore / n,
    sureWinShare: n === 0 ? 0 : acc.sureScore / n,
    valueWins: acc.valueOverpays.length,
    sureWins: acc.sureOverpays.length,
    valueMedianOverpayPct: medianOf(acc.valueOverpays),
    sureMedianOverpayPct: medianOf(acc.sureOverpays),
  };
}

/**
 * Heat per auction, from that league's earlier auctions only.
 *
 * "Earlier" means a strictly earlier (season, week) pair. Auctions inside one
 * week are processed as a block and none of them informs another: they were
 * all filed before any of them cleared, so a manager on Tuesday did not know
 * what Wednesday's claim would go for, and neither did the model.
 *
 * Every auction of the league feeds the history, including the ones the replay
 * will not grade. Week 1 and uncontested claims are real market information;
 * `computeLeagueTendencies` applies its own contested-week and bidder filters.
 */
function heatPerAuction(
  auctions: ReplayAuction[],
  cells: PriorCell[],
  options: ReplayOptions,
): Map<ReplayAuction, number> {
  const out = new Map<ReplayAuction, number>();

  const byLeague = new Map<string, ReplayAuction[]>();
  for (const auction of auctions) {
    const list = byLeague.get(auction.leagueId) ?? [];
    list.push(auction);
    byLeague.set(auction.leagueId, list);
  }

  for (const list of byLeague.values()) {
    const ordered = [...list].sort((a, b) => a.season - b.season || a.week - b.week);
    const history: TendencyAuction[] = [];
    let cursor = 0;

    while (cursor < ordered.length) {
      const weekKey = `${ordered[cursor].season}|${ordered[cursor].week}`;
      const heat = computeLeagueTendencies(history, options.auction).heat;

      let end = cursor;
      while (end < ordered.length && `${ordered[end].season}|${ordered[end].week}` === weekKey) {
        out.set(ordered[end], heat);
        end += 1;
      }

      for (let i = cursor; i < end; i += 1) {
        const auction = ordered[i];
        // The market's own price for this situation. Heat is a statement about
        // what this room paid against what the wider market pays for the same
        // auction, so the reference has to describe the auction as it happened.
        const reference = cellFor(auction, cells, auction.bids.length, options.minCellSamples);
        if (!reference) continue;
        history.push({
          week: auction.week,
          winningPct: auction.winningPct,
          bids: auction.bids,
          referencePct: reference.p50,
        });
      }

      cursor = end;
    }
  }

  return out;
}

/** Grade one auction. Returns null when no market cell covers it. */
export function replayOne(
  auction: ReplayAuction,
  cells: PriorCell[],
  options: ReplayOptions,
  heat: number,
): ReplayOutcome | null {
  // THE CELL IS KEYED ON TOTAL BIDDERS, THE WINNER INCLUDED. priors-build.ts
  // buckets an auction under biddersKey(bidderCount) where bidderCount is the
  // length of the whole bid list, so the "1" cell is the distribution of
  // prices in auctions NOBODY contested, which clears at nearly nothing.
  //
  // The plan's "bidders from the real count minus one" means the model does
  // not count itself among its own opposition. Against a dimension that was
  // never counting the reader twice, subtracting one double discounts: it
  // prices a contested auction off the uncontested distribution and the model
  // underbids by construction. A model standing in this auction faces the room
  // the auction actually had, so it reads the cell for that room.
  const cell = cellFor(auction, cells, auction.bids.length, options.minCellSamples);
  if (!cell) return null;

  const cap = Math.floor(auction.totalBudget);
  const style = Math.max(0.01, heat);

  const rawValue = bidForTargetFromCell(cell, options.valueTarget, auction.totalBudget, cap, style);
  const rawSure = bidForTargetFromCell(cell, options.sureTarget, auction.totalBudget, cap, style);

  // A null means the target is out of reach even at the whole budget. The model
  // has nothing more to give, so it bids everything and the caller is told how
  // often that happened rather than being handed a silent gap in the sample.
  const valueAtBudgetCap = rawValue === null;
  const sureAtBudgetCap = rawSure === null;

  const valueBid = nudge(rawValue ?? cap, cap, options.oddNudge);
  const sureBid = nudge(rawSure ?? cap, cap, options.oddNudge);

  const valueScore = gradeBid(valueBid, auction.winningAmount);
  const sureScore = gradeBid(sureBid, auction.winningAmount);

  const asPct = (dollars: number) => (dollars / auction.totalBudget) * 100;
  // Overpay is what the win cost over the price that actually cleared the
  // auction, so it is only meaningful where the bid strictly beat the winner.
  // A tie paid the winner's own number and overpaid by nothing.
  const valueOverpayPct = valueScore === 1 ? asPct(valueBid) - auction.winningPct : null;
  const sureOverpayPct = sureScore === 1 ? asPct(sureBid) - auction.winningPct : null;

  return {
    leagueId: auction.leagueId,
    season: auction.season,
    week: auction.week,
    bucket: bucketKeyFor(auction),
    heat,
    cellKey: cell.cellKey,
    cellSamples: cell.sampleSize,
    valueBid,
    sureBid,
    valueScore,
    sureScore,
    valueOverpayPct,
    sureOverpayPct,
    valueAtBudgetCap,
    sureAtBudgetCap,
  };
}

export type ReplayResult = { summary: ReplaySummary; outcomes: ReplayOutcome[] };

/** The whole replay. Deterministic: same inputs, same table, every time. */
export function replayAuctions(
  auctions: ReplayAuction[],
  cells: PriorCell[],
  options: ReplayOptions,
): ReplayResult {
  const heats = heatPerAuction(auctions, cells, options);

  const overall = emptyAccumulator();
  const buckets = new Map<string, Accumulator>();
  const outcomes: ReplayOutcome[] = [];
  const leagues = new Set<string>();

  let skipped = 0;
  let unpriced = 0;
  let valueAtBudgetCap = 0;
  let sureAtBudgetCap = 0;

  for (const auction of auctions) {
    if (!isUsable(auction, options)) {
      skipped += 1;
      continue;
    }

    const outcome = replayOne(auction, cells, options, heats.get(auction) ?? 1);
    if (!outcome) {
      unpriced += 1;
      continue;
    }

    outcomes.push(outcome);
    leagues.add(auction.leagueId);
    if (outcome.valueAtBudgetCap) valueAtBudgetCap += 1;
    if (outcome.sureAtBudgetCap) sureAtBudgetCap += 1;

    addOutcome(overall, outcome);
    const bucket = buckets.get(outcome.bucket) ?? emptyAccumulator();
    addOutcome(bucket, outcome);
    buckets.set(outcome.bucket, bucket);
  }

  const ordered = (keys: string[]) =>
    keys
      .filter((key) => buckets.has(key))
      .map((key) => toBucket(key, buckets.get(key) as Accumulator));

  return {
    summary: {
      overall: toBucket("overall", overall),
      standard: ordered(STANDARD_ORDER),
      chopped: ordered(CHOPPED_ORDER),
      graded: overall.sampleSize,
      skipped,
      unpriced,
      leagues: leagues.size,
      valueAtBudgetCap,
      sureAtBudgetCap,
    },
    outcomes,
  };
}
