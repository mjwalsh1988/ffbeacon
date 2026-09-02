/**
 * Grading the moves: waivers, trades, and the draft.
 *
 * Pure. Everything arrives as plain data, and every figure is a sum of points
 * that were actually scored in settled weeks.
 *
 * THE ONE PRIMITIVE ALL THREE ARE BUILT ON
 *   `league_matchups.player_points` is a map of actual points for every player
 *   ON A ROSTER that week. A player appears under exactly one roster per week,
 *   which is what makes the map an ownership record as well as a scoring one.
 *   From it, three questions can be answered without a single extra table:
 *
 *     who owned this player in week W        -> ownerOf(week, player)
 *     what did he score for THEM from W on   -> pointsFor(player, roster, from)
 *     what did he score in this league at all -> totalPoints(player)
 *
 *   Every ledger below is one of those three summed a different way.
 *
 * WHY EACH LEDGER COUNTS WHAT IT COUNTS, AND NOT THE SAME THING TWICE
 *   A waiver claim is credited with what the player scored FOR THE CLAIMING
 *   ROSTER from the week of the claim onward. A trade is credited with what
 *   the incoming players scored for their new owner minus what the outgoing
 *   ones scored for theirs. The draft is credited with the player's production
 *   IN THE LEAGUE, for anyone.
 *
 *   That last one looks inconsistent and is deliberate. The draft decision was
 *   "take this player". What happened to him afterward is a different decision
 *   with its own ledger, so charging a good pick to nothing because he was
 *   later traded would count one manager's trade against their own draft. The
 *   two ledgers are meant to be read side by side, which only works if neither
 *   is quietly absorbing the other.
 *
 * WHY DRAFT PICKS IN A TRADE ARE NOT PRICED
 *   This model's only currency is points that have been scored. A 2028 first
 *   has scored none and will score none this season. Pricing it would mean
 *   reaching for a value source, which would make the whole ledger vary by the
 *   source toggle and break the one-answer-per-league rule in ./types.ts. So a
 *   trade that moved picks is graded on its players and flagged, and the UI
 *   says out loud that the picks are not in the number.
 */

import type {
  DraftLedger,
  DraftMove,
  LedgerPosition,
  TradeLedger,
  TradeMove,
  WaiverLedger,
  WaiverMove,
} from "./types";
import type { LedgerPlayer } from "./lineup";
import {
  MAX_STORED_DRAFT_MOVES,
  MAX_STORED_TRADE_MOVES,
  MAX_STORED_WAIVER_MOVES,
} from "./default-settings";

/** One settled week, as the index reads it. */
export type IndexedWeek = {
  week: number;
  sleeperRosterId: number;
  /** Actual points for every player on this roster that week. */
  playerPoints: Map<string, number>;
  /** The ids that were in a starting slot, placeholders already removed. */
  startedIds: Set<string>;
};

/**
 * The ownership-and-scoring index the three ledgers share.
 *
 * Built once per league season. Lookups are O(number of graded weeks), which
 * for a full season is eighteen, so nothing here needs to be cleverer.
 */
export class LedgerIndex {
  private readonly byWeek: Map<
    number,
    Map<string, { roster: number; points: number }>
  >;
  private readonly startedByWeek: Map<number, Set<string>>;
  readonly weeks: number[];

  constructor(rows: IndexedWeek[]) {
    this.byWeek = new Map();
    this.startedByWeek = new Map();
    const weekSet = new Set<number>();

    for (const row of rows) {
      weekSet.add(row.week);
      let owners = this.byWeek.get(row.week);
      if (!owners) {
        owners = new Map();
        this.byWeek.set(row.week, owners);
      }
      for (const [playerId, points] of row.playerPoints) {
        owners.set(playerId, { roster: row.sleeperRosterId, points });
      }
      let started = this.startedByWeek.get(row.week);
      if (!started) {
        started = new Set();
        this.startedByWeek.set(row.week, started);
      }
      for (const id of row.startedIds)
        started.add(`${row.sleeperRosterId}|${id}`);
    }
    this.weeks = [...weekSet].sort((a, b) => a - b);
  }

  /**
   * Points a player scored for one roster, from `fromWeek` onward.
   *
   * Ownership is re-checked every week rather than assumed to persist, so a
   * player who was claimed, dropped, and claimed by someone else contributes
   * to each owner only for the weeks they actually held him.
   */
  pointsFor(playerId: string, rosterId: number, fromWeek: number): number {
    let total = 0;
    for (const week of this.weeks) {
      if (week < fromWeek) continue;
      const entry = this.byWeek.get(week)?.get(playerId);
      if (!entry || entry.roster !== rosterId) continue;
      total += entry.points;
    }
    return total;
  }

  /** As pointsFor, but only the weeks the player was in a starting slot. */
  pointsStartedFor(
    playerId: string,
    rosterId: number,
    fromWeek: number,
  ): { points: number; weeks: number } {
    let points = 0;
    let weeks = 0;
    for (const week of this.weeks) {
      if (week < fromWeek) continue;
      const entry = this.byWeek.get(week)?.get(playerId);
      if (!entry || entry.roster !== rosterId) continue;
      if (!this.startedByWeek.get(week)?.has(`${rosterId}|${playerId}`))
        continue;
      points += entry.points;
      weeks += 1;
    }
    return { points, weeks };
  }

  /** Everything a player scored in this league, for whoever owned him. */
  totalPoints(playerId: string): number {
    let total = 0;
    for (const week of this.weeks) {
      const entry = this.byWeek.get(week)?.get(playerId);
      if (entry) total += entry.points;
    }
    return total;
  }
}

/** A completed transaction, flattened out of `league_transactions`. */
export type TransactionInput = {
  id: string;
  type: string;
  week: number;
  /** Sleeper player id -> roster that received them. */
  adds: Record<string, number>;
  /** Sleeper player id -> roster that gave them up. */
  drops: Record<string, number>;
  /** FAAB spent on the claim, when the league runs a budget. */
  bid: number | null;
  /** True when the transaction also moved draft picks. */
  hasPicks: boolean;
  rosterIds: number[];
};

function nameOf(players: Map<string, LedgerPlayer>, id: string): string {
  return players.get(id)?.name ?? `Player ${id}`;
}

function positionOf(
  players: Map<string, LedgerPlayer>,
  id: string,
): LedgerPosition | null {
  return players.get(id)?.position ?? null;
}

/**
 * The waiver and free agency ledger for one roster.
 *
 * A claim that has not had a settled week yet contributes zero points and
 * still counts as a move, which is correct: the manager spent the budget.
 *
 * FAAB is summed PER TRANSACTION rather than per player. A claim that adds two
 * players carries one bid, and counting it against both would double the
 * spend and halve the return.
 */
export function buildWaiverLedger(
  rosterId: number,
  transactions: TransactionInput[],
  index: LedgerIndex,
  players: Map<string, LedgerPlayer>,
  leagueHasFaab: boolean,
): WaiverLedger {
  const moves: WaiverMove[] = [];
  const bidByTransaction = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.type !== "waiver" && tx.type !== "free_agent") continue;
    for (const [playerId, toRoster] of Object.entries(tx.adds)) {
      if (Number(toRoster) !== rosterId) continue;
      if (tx.bid !== null) bidByTransaction.set(tx.id, tx.bid);
      const started = index.pointsStartedFor(playerId, rosterId, tx.week);
      moves.push({
        transactionId: tx.id,
        week: tx.week,
        playerId,
        name: nameOf(players, playerId),
        position: positionOf(players, playerId),
        bid: tx.bid,
        pointsOnRoster: index.pointsFor(playerId, rosterId, tx.week),
        pointsStarted: started.points,
        weeksStarted: started.weeks,
      });
    }
  }

  let faabSpent = 0;
  for (const bid of bidByTransaction.values()) faabSpent += bid;

  const pointsOnRoster = moves.reduce((sum, m) => sum + m.pointsOnRoster, 0);
  const pointsStarted = moves.reduce((sum, m) => sum + m.pointsStarted, 0);

  return {
    moves: moves.length,
    hits: moves.filter((m) => m.weeksStarted > 0).length,
    faabSpent: leagueHasFaab ? faabSpent : null,
    pointsOnRoster,
    pointsStarted,
    pointsPerDollar:
      leagueHasFaab && faabSpent > 0 ? pointsStarted / faabSpent : null,
    best: [...moves]
      .sort((a, b) => b.pointsStarted - a.pointsStarted)
      .slice(0, MAX_STORED_WAIVER_MOVES),
  };
}

/**
 * The trade ledger for one roster.
 *
 * A player sent away is credited to the roster that RECEIVED him, read from
 * the same transaction's `adds`, so a three-team trade attributes each leg
 * correctly rather than assuming there were only two parties.
 */
export function buildTradeLedger(
  rosterId: number,
  transactions: TransactionInput[],
  index: LedgerIndex,
  players: Map<string, LedgerPlayer>,
): TradeLedger {
  const moves: TradeMove[] = [];

  for (const tx of transactions) {
    if (tx.type !== "trade") continue;

    const receivedIds = Object.entries(tx.adds)
      .filter(([, to]) => Number(to) === rosterId)
      .map(([playerId]) => playerId);
    const sentIds = Object.entries(tx.drops)
      .filter(([, from]) => Number(from) === rosterId)
      .map(([playerId]) => playerId);

    // A pick-only trade moves no player, so both lists are empty and the
    // roster's membership in `roster_ids` is the only evidence it took part.
    // It is still recorded, at a net of zero and flagged, because a manager who
    // made four trades this season made four trades whether or not this model
    // can price all of them.
    const touched =
      receivedIds.length > 0 ||
      sentIds.length > 0 ||
      tx.rosterIds.includes(rosterId);
    if (!touched) continue;

    let pointsIn = 0;
    for (const playerId of receivedIds) {
      pointsIn += index.pointsFor(playerId, rosterId, tx.week);
    }

    let pointsOut = 0;
    for (const playerId of sentIds) {
      const newOwner = Number(tx.adds[playerId]);
      if (!Number.isFinite(newOwner)) continue;
      pointsOut += index.pointsFor(playerId, newOwner, tx.week);
    }

    moves.push({
      transactionId: tx.id,
      week: tx.week,
      receivedIds,
      receivedNames: receivedIds.map((id) => nameOf(players, id)),
      sentIds,
      sentNames: sentIds.map((id) => nameOf(players, id)),
      pointsIn,
      pointsOut,
      net: pointsIn - pointsOut,
      involvedPicks: tx.hasPicks,
    });
  }

  return {
    trades: moves.length,
    pointsIn: moves.reduce((sum, m) => sum + m.pointsIn, 0),
    pointsOut: moves.reduce((sum, m) => sum + m.pointsOut, 0),
    net: moves.reduce((sum, m) => sum + m.net, 0),
    anyPicks: moves.some((m) => m.involvedPicks),
    moves: [...moves]
      .sort((a, b) => b.net - a.net)
      .slice(0, MAX_STORED_TRADE_MOVES),
  };
}

/** One row of `draft_selections`, flattened. */
export type DraftPickInput = {
  /** Which draft this pick belongs to, so two in one season stay apart. */
  draftId: string;
  pickNo: number;
  round: number;
  rosterId: number;
  playerId: string;
  isKeeper: boolean;
};

/** The baseline key. A round means nothing without the draft it belongs to. */
function baselineKey(pick: DraftPickInput): string {
  return `${pick.draftId}|${pick.round}`;
}

/**
 * The baseline every pick in a round is measured against: the mean production
 * of the players taken in that same round, in this same draft.
 *
 * League-internal on purpose. An external expectation curve would import
 * somebody else's opinion about what a third-rounder is worth, and would be
 * wrong for a 10-team league the moment it was built for a 12-team one. This
 * asks a question the draft can answer about itself: given what the room took
 * in round three, how did yours do.
 *
 * KEEPERS ARE EXCLUDED, from the baseline and from the ledger. A keeper is
 * carried at a slot the league's own rules set, not chosen off the board, and
 * a handful of them landing in the late rounds moves those baselines far enough
 * to misgrade every real pick around them.
 *
 * KEYED ON (DRAFT, ROUND), NOT ON ROUND. A dynasty league runs a startup and a
 * rookie draft in the same season, and round 1 of a 24-round startup is not the
 * same question as round 1 of a 4-round rookie draft. Bucketing on the round
 * alone averaged the two together and misgraded every pick in both.
 */
export function roundBaselines(
  picks: DraftPickInput[],
  index: LedgerIndex,
): Map<string, number> {
  const byRound = new Map<string, number[]>();
  for (const pick of picks) {
    if (pick.isKeeper) continue;
    const key = baselineKey(pick);
    const list = byRound.get(key) ?? [];
    list.push(index.totalPoints(pick.playerId));
    byRound.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [key, values] of byRound) {
    const sum = values.reduce((a, b) => a + b, 0);
    out.set(key, values.length > 0 ? sum / values.length : 0);
  }
  return out;
}

/** The draft ledger for one roster. */
export function buildDraftLedger(
  rosterId: number,
  picks: DraftPickInput[],
  baselines: Map<string, number>,
  index: LedgerIndex,
  players: Map<string, LedgerPlayer>,
): DraftLedger {
  const moves: DraftMove[] = [];
  for (const pick of picks) {
    if (pick.rosterId !== rosterId) continue;
    if (pick.isKeeper) continue;
    const points = index.totalPoints(pick.playerId);
    const baseline = baselines.get(baselineKey(pick)) ?? 0;
    moves.push({
      pickNo: pick.pickNo,
      round: pick.round,
      playerId: pick.playerId,
      name: nameOf(players, pick.playerId),
      position: positionOf(players, pick.playerId),
      points,
      roundBaseline: baseline,
      aboveBaseline: points - baseline,
    });
  }

  const sorted = [...moves].sort((a, b) => b.aboveBaseline - a.aboveBaseline);
  // `worst` stays empty when the whole draft already fits in `best`, rather
  // than repeating the same six picks under a heading that says they were the
  // weak ones. A reader looking at every pick a manager made does not need the
  // list told to them twice with the order flipped.
  const worst =
    sorted.length > MAX_STORED_DRAFT_MOVES
      ? sorted.slice(-MAX_STORED_DRAFT_MOVES).reverse()
      : [];
  return {
    picks: moves.length,
    points: moves.reduce((sum, m) => sum + m.points, 0),
    aboveBaseline: moves.reduce((sum, m) => sum + m.aboveBaseline, 0),
    best: sorted.slice(0, MAX_STORED_DRAFT_MOVES),
    worst,
  };
}
