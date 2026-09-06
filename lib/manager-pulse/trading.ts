/**
 * Manager Pulse: trading section (docs/manager-pulse/manager-pulse-plan.md 6.5), plus the
 * cross-tool tendency DTO builder (section 8.1).
 *
 * PURE. No Supabase, no fetch, no React, no Date.now(). Takes a
 * `ManagerPulseInput` and returns plain data.
 *
 * THE RULE THAT GOVERNS THIS FILE
 *   Dynasty and redraft never pool for a value-priced figure. A dynasty
 *   superflex trade and a redraft PPR trade are priced against different
 *   format configs, so their margins sit on different scales and an average
 *   across both has no unit. That is why `avgValueMargin`, `verdictDistribution`,
 *   `positionAppetite`, `picksTraded`, `mostTradedWith`, `overpays` and
 *   `tradesWithUnpricedPicks` are all `PerTypeStat<T>`, which has no `all`
 *   field at all. There is nothing to compute for "all", so nothing is
 *   computed, and nothing here ever builds one internally to hide it.
 *   `tradeCount` and `tradesPerSeason` are the one pair of exceptions: a count
 *   of trades is scale-free (it costs nothing to add "5 dynasty trades" to
 *   "3 redraft trades" and get "8 trades"), so those two are `PoolableStat<T>`
 *   and do carry an `all`.
 *
 * NULL VERSUS ZERO IN THIS FILE
 *   Three figures are gated by an explicit sample floor from
 *   `settings.samples`, because below the floor the figure is not evidence of
 *   a pattern, it is one bad Tuesday dressed up as a trend:
 *     - `avgValueMargin`, gated by `minTradesForMargin` against the count of
 *       GRADED trades (a trade Signal Check could not price contributes
 *       nothing to a mean and must not silently become zero).
 *     - `positionAppetite`, gated by `minTradesForPositionLean` against the
 *       lens's total trade count.
 *     - `ageLean`, gated by `minTradesForAgeLean` against the lens's dynasty
 *       trade count.
 *   Below the floor, these three return null, and every other field keeps
 *   reporting its real number, sample size included, so a reader can always
 *   see the denominator even where the headline figure is withheld.
 *
 *   Every OTHER field here (`tradeCount`, `tradesPerSeason`,
 *   `avgValueMarginSampleSize`, `ageLeanSampleSize`, `verdictDistribution`,
 *   `picksTraded`, `mostTradedWith`, `overpays`, `tradesWithUnpricedPicks`) is
 *   always a real value, zero or empty where there is genuinely nothing to
 *   report, never null. This is a deliberate difference from a results-style
 *   section (lib/manager-pulse/results.ts), where an empty lens nulls every
 *   field because a rate computed from zero league-seasons is not a fact
 *   about the manager. A trade COUNT is not a rate: "0 redraft trades" is
 *   itself a true, useful statement about a manager who plays redraft
 *   leagues and has never made a deal in one, and flattening it to null would
 *   hide that fact rather than protect the reader from a false one.
 *
 * A TRADE WITH A NULL `marginPct` IS COUNTED, NEVER FLATTENED TO ZERO
 *   `tradeCount` counts every trade in the lens, graded or not. Every average
 *   here (`avgValueMargin`, and the mean inside `overpays`) is computed only
 *   over trades where `marginPct` is not null, and states its own sample size
 *   next to it. A trade Signal Check could not price could not be graded,
 *   which is a different fact from "graded at zero", and folding it into a
 *   mean as zero would drag every manager's average toward fair and make an
 *   overpayer look ordinary.
 *
 * A PLAYER WITH A NULL AGE OR MARKET VALUE IS EXCLUDED, NEVER GUESSED
 *   `positionAppetite` and `ageLean` both walk a trade's incoming and
 *   outgoing player lists and look each one up in `input.players`. A player
 *   who resolves with no position, no market value for the lens, or (for age
 *   lean) no birth date contributes nothing to the sum. He is still part of
 *   the trade for every count and threshold that counts trades; he is simply
 *   not one of the priced or aged players inside it.
 */

import { TRADE_POSITIONS, TRADE_POSITION_LABEL, type TradePosition } from "@/lib/trade-finder/types";
import { lensForCategory } from "./types";
import type {
  ManagerTrading,
  OverpayEntry,
  PickFlow,
  PerTypeStat,
  PoolableStat,
  PositionAppetite,
  TendencySlice,
  TradePartnerEntry,
  TradeVerdictBucket,
  TradeVerdictCounts,
} from "./types";
import type {
  ManagerLeagueSeason,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
} from "./input-types";

type Lens = "dynasty" | "redraft";

/**
 * Age lean's reference point, in years. 26 sits close to the middle of the
 * fantasy-relevant career curve (most skill positions peak in their mid
 * twenties and are in decline by their late twenties), so a player younger
 * than this pulls a trade toward "buying youth" and a player older than this
 * pulls it toward "buying production". It is a defensible midpoint, not a
 * measured constant, which is why it lives here as one named value rather
 * than scattered through the arithmetic below.
 */
const AGE_LEAN_REFERENCE_AGE = 26;

/**
 * Trade margins arrive from Signal Check in PERCENT units: `marginPct` of 4.2
 * means four point two percent. The wording thresholds on the settings row are
 * SHARES, because that is what every other threshold in this feature is. This
 * converts one to the other at the single point of comparison rather than
 * changing either convention.
 */
function shareToPct(share: number): number {
  return share * 100;
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

function tradesForLens(trades: ManagerTrade[], lens: Lens): ManagerTrade[] {
  return trades.filter((t) => lensForCategory(t.category) === lens);
}

function gradedTrades(trades: ManagerTrade[]): ManagerTrade[] {
  return trades.filter((t) => t.marginPct !== null);
}

/** Mean `marginPct` over the trades passed in. Assumes callers pass only graded trades. */
function meanMarginPct(trades: ManagerTrade[]): number | null {
  const values = trades
    .map((t) => t.marginPct)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function distinctSeasonsForLens(seasons: ManagerLeagueSeason[], lens: Lens): number {
  const set = new Set<number>();
  for (const s of seasons) {
    if (lensForCategory(s.category) === lens) set.add(s.season);
  }
  return set.size;
}

function distinctSeasonsAll(seasons: ManagerLeagueSeason[]): number {
  return new Set(seasons.map((s) => s.season)).size;
}

/* -------------------------------------------------------------------------- */
/* Average value margin                                                       */
/* -------------------------------------------------------------------------- */

function computeMargin(
  trades: ManagerTrade[],
  minGradedTrades: number,
): { value: number | null; sampleSize: number } {
  const graded = gradedTrades(trades);
  const sampleSize = graded.length;
  if (sampleSize < minGradedTrades) return { value: null, sampleSize };
  return { value: meanMarginPct(graded), sampleSize };
}

/* -------------------------------------------------------------------------- */
/* Verdict distribution                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which of the six buckets one trade lands in, from THIS manager's seat.
 *
 * `marginPct` is already signed toward the manager (load.ts negates it when
 * they were on the losing side), so the sign is the direction and the
 * magnitude is the size. A trade Signal Check could not price is `ungraded`
 * and is never folded into `even`: "we could not tell" and "it was close" are
 * different claims and the whole feature keeps them apart.
 */
export function verdictBucketFor(
  marginPct: number | null,
  wording: { marginDeadzone: number; verdictClearMargin: number },
): TradeVerdictBucket {
  if (marginPct === null || !Number.isFinite(marginPct)) return "ungraded";
  const magnitude = Math.abs(marginPct);
  if (magnitude < shareToPct(wording.marginDeadzone)) return "even";
  if (magnitude >= shareToPct(wording.verdictClearMargin)) {
    return marginPct > 0 ? "clear_win" : "clear_loss";
  }
  return marginPct > 0 ? "slight_win" : "slight_loss";
}

function verdictDistributionForLens(
  trades: ManagerTrade[],
  wording: { marginDeadzone: number; verdictClearMargin: number },
): TradeVerdictCounts {
  const counts: TradeVerdictCounts = {};
  for (const trade of trades) {
    const key = verdictBucketFor(trade.marginPct, wording);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Position appetite                                                          */
/* -------------------------------------------------------------------------- */

function addPositionValue(
  totals: PositionAppetite,
  player: ManagerPlayerFacts | undefined,
  lens: Lens,
  sign: 1 | -1,
): void {
  if (!player || !player.position) return;
  const value = player.marketValue[lens];
  if (value === null) return;
  totals[player.position] = (totals[player.position] ?? 0) + sign * value;
}

function positionAppetiteForLens(
  trades: ManagerTrade[],
  players: Record<string, ManagerPlayerFacts>,
  lens: Lens,
  minTrades: number,
): PositionAppetite | null {
  if (trades.length < minTrades) return null;
  const totals: PositionAppetite = {};
  for (const trade of trades) {
    for (const playerId of trade.incomingPlayerIds) {
      addPositionValue(totals, players[playerId], lens, 1);
    }
    for (const playerId of trade.outgoingPlayerIds) {
      addPositionValue(totals, players[playerId], lens, -1);
    }
  }
  return totals;
}

/**
 * The position holding the most incoming value in one trade, used only to
 * group trades for the position half of `overpays`. Ties break toward the
 * earlier position in `TRADE_POSITIONS` (QB first), a fixed and deterministic
 * order rather than an accident of object iteration. A trade with no
 * incoming player that resolves to a priced position (everyone unpriced, or
 * unresolved) has no dominant position and is excluded from this grouping,
 * though it still counts toward the player half of `overpays` and toward
 * every trade-count figure elsewhere in this file.
 */
function dominantIncomingPosition(
  trade: ManagerTrade,
  players: Record<string, ManagerPlayerFacts>,
  lens: Lens,
): TradePosition | null {
  const totals = new Map<TradePosition, number>();
  for (const playerId of trade.incomingPlayerIds) {
    const player = players[playerId];
    if (!player || !player.position) continue;
    const value = player.marketValue[lens];
    if (value === null) continue;
    totals.set(player.position, (totals.get(player.position) ?? 0) + value);
  }
  let best: TradePosition | null = null;
  let bestValue = -Infinity;
  for (const position of TRADE_POSITIONS) {
    const value = totals.get(position);
    if (value === undefined) continue;
    if (value > bestValue) {
      bestValue = value;
      best = position;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Age lean, dynasty only                                                     */
/* -------------------------------------------------------------------------- */

function ageValueContribution(
  player: ManagerPlayerFacts | undefined,
): { value: number; age: number } | null {
  if (!player || player.age === null) return null;
  const value = player.marketValue.dynasty;
  if (value === null) return null;
  return { value, age: player.age };
}

/**
 * Net value flow weighted by how far each player's age sits from the
 * reference age, normalized by the total value moved so the result is a
 * lean rather than a raw dollar size. Buying a player younger than the
 * reference age, or selling one older than it, both push the result
 * positive; the two are the same underlying behaviour (choosing youth over
 * proven production) approached from opposite sides of the trade.
 */
function computeAgeLean(
  dynastyTrades: ManagerTrade[],
  players: Record<string, ManagerPlayerFacts>,
  minDynastyTrades: number,
): { value: number | null; sampleSize: number } {
  const sampleSize = dynastyTrades.length;
  if (sampleSize < minDynastyTrades) return { value: null, sampleSize };

  let numerator = 0;
  let totalValueMoved = 0;

  for (const trade of dynastyTrades) {
    for (const playerId of trade.incomingPlayerIds) {
      const contribution = ageValueContribution(players[playerId]);
      if (!contribution) continue;
      numerator += contribution.value * (AGE_LEAN_REFERENCE_AGE - contribution.age);
      totalValueMoved += contribution.value;
    }
    for (const playerId of trade.outgoingPlayerIds) {
      const contribution = ageValueContribution(players[playerId]);
      if (!contribution) continue;
      numerator -= contribution.value * (AGE_LEAN_REFERENCE_AGE - contribution.age);
      totalValueMoved += contribution.value;
    }
  }

  if (totalValueMoved === 0) return { value: null, sampleSize };
  return { value: numerator / totalValueMoved, sampleSize };
}

/* -------------------------------------------------------------------------- */
/* Picks traded, unpriced picks                                               */
/* -------------------------------------------------------------------------- */

function picksTradedForLens(trades: ManagerTrade[]): number {
  let total = 0;
  for (const trade of trades) total += trade.incomingPickCount + trade.outgoingPickCount;
  return total;
}

function tradesWithUnpricedPicksForLens(trades: ManagerTrade[]): number {
  return trades.filter((t) => t.hasUnpricedPick).length;
}

/**
 * Picks in, picks out, and the round each one carried.
 *
 * `acquired` and `sent` count EVERY pick that moved, so together they equal
 * `picksTradedForLens` over the same trades. `byRound` counts only the ones
 * Sleeper published a round for, ascending, and only rounds that actually
 * moved: a chart padded out to round five in a league that has never traded
 * past round three would draw two empty columns and invite a reader to
 * conclude something from them.
 */
function pickFlowForLens(trades: ManagerTrade[], roundsShown: number): PickFlow {
  let acquired = 0;
  let sent = 0;
  let roundsKnown = 0;
  const rounds = new Map<number, { acquired: number; sent: number }>();

  const bump = (round: number, key: "acquired" | "sent") => {
    const row = rounds.get(round) ?? { acquired: 0, sent: 0 };
    row[key] += 1;
    rounds.set(round, row);
    roundsKnown += 1;
  };

  for (const trade of trades) {
    acquired += trade.incomingPickCount;
    sent += trade.outgoingPickCount;
    for (const round of trade.incomingPickRounds) bump(round, "acquired");
    for (const round of trade.outgoingPickRounds) bump(round, "sent");
  }

  const ordered = [...rounds.entries()]
    .map(([round, row]) => ({ round, acquired: row.acquired, sent: row.sent }))
    .sort((a, b) => a.round - b.round);

  const head = ordered.filter((row) => row.round <= roundsShown);
  const tail = ordered.filter((row) => row.round > roundsShown);

  const byRound: PickFlow["byRound"] = [...head];
  let laterFromRound: number | null = null;
  if (tail.length > 0) {
    laterFromRound = tail[0].round;
    byRound.push({
      round: null,
      acquired: tail.reduce((sum, row) => sum + row.acquired, 0),
      sent: tail.reduce((sum, row) => sum + row.sent, 0),
    });
  }

  return { acquired, sent, roundsKnown, byRound, laterFromRound };
}

/* -------------------------------------------------------------------------- */
/* Most traded with                                                           */
/* -------------------------------------------------------------------------- */

function mostTradedWithForLens(
  trades: ManagerTrade[],
  handles: Record<string, string>,
  maxRows: number,
): TradePartnerEntry[] {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    for (const counterpartyId of trade.counterpartyUserIds) {
      counts.set(counterpartyId, (counts.get(counterpartyId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([sleeperUserId, tradeCount]) => ({
      sleeperUserId,
      // A counterparty with no known handle is kept, never dropped: we know
      // this trade happened even where we cannot yet name who it was with.
      handle: handles[sleeperUserId] ?? null,
      tradeCount,
    }))
    .sort((a, b) => {
      if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
      return a.sleeperUserId.localeCompare(b.sleeperUserId);
    })
    .slice(0, maxRows);
}

/* -------------------------------------------------------------------------- */
/* Overpays: the intersection of a negative margin and enough sample          */
/* -------------------------------------------------------------------------- */

/**
 * Where a negative average margin meets enough sample to be a pattern.
 * Two independent groupings, both gated by the same floor:
 *   - by the dominant incoming position of each trade
 *   - by a specific incoming player, across the separate trades he arrived in
 * A subject below `minOverpaySample` GRADED trades, or with a mean margin at
 * or above zero, emits nothing at all: there is no hedged, low-confidence
 * entry, because a habit reported on thin evidence is not a habit.
 *
 * Rows are capped at `maxRows` (`settings.display.tradesShown`), the same cap
 * `mostTradedWithForLens` uses: both are "how many rows a card shows", not a
 * statistical floor, so they share the one admin-editable setting rather than
 * each carrying their own.
 */
function overpaysForLens(
  trades: ManagerTrade[],
  players: Record<string, ManagerPlayerFacts>,
  lens: Lens,
  minSample: number,
  maxRows: number,
  /**
   * Which side of zero to report.
   *
   * "overpay" keeps subjects whose mean margin is below zero, sorted worst
   * first: what this manager habitually pays up for. "bargain" is the same
   * computation with the comparison and the sort flipped: what they habitually
   * come out ahead on. One function rather than two, because two would be two
   * places for the sample floor and the grouping rules to drift apart, and the
   * whole point of the pair is that they are the same measurement.
   */
  direction: "overpay" | "bargain" = "overpay",
): OverpayEntry[] {
  const byPosition = new Map<TradePosition, ManagerTrade[]>();
  const byPlayer = new Map<string, ManagerTrade[]>();

  for (const trade of trades) {
    const position = dominantIncomingPosition(trade, players, lens);
    if (position) {
      const list = byPosition.get(position) ?? [];
      list.push(trade);
      byPosition.set(position, list);
    }
    for (const playerId of trade.incomingPlayerIds) {
      const list = byPlayer.get(playerId) ?? [];
      list.push(trade);
      byPlayer.set(playerId, list);
    }
  }

  const entries: OverpayEntry[] = [];

  for (const position of TRADE_POSITIONS) {
    const group = byPosition.get(position);
    if (!group) continue;
    const graded = gradedTrades(group);
    if (graded.length < minSample) continue;
    const mean = meanMarginPct(graded);
    if (mean === null) continue;
    if (direction === "overpay" ? mean >= 0 : mean <= 0) continue;
    entries.push({
      subject: position,
      subjectLabel: TRADE_POSITION_LABEL[position],
      playerId: null,
      kind: "position",
      position,
      avgMarginPct: mean,
      sampleSize: graded.length,
    });
  }

  for (const [playerId, group] of byPlayer) {
    const graded = gradedTrades(group);
    if (graded.length < minSample) continue;
    const mean = meanMarginPct(graded);
    if (mean === null) continue;
    if (direction === "overpay" ? mean >= 0 : mean <= 0) continue;
    const player = players[playerId];
    entries.push({
      subject: playerId,
      subjectLabel: player ? player.name : playerId,
      playerId,
      kind: "player",
      // Never invented: a player we hold no position for gets null and the
      // card renders no chip rather than a guessed one.
      position: player?.position ?? null,
      avgMarginPct: mean,
      sampleSize: graded.length,
    });
  }

  // Strongest pattern first, whichever direction that is.
  entries.sort((a, b) =>
    direction === "overpay" ? a.avgMarginPct - b.avgMarginPct : b.avgMarginPct - a.avgMarginPct,
  );
  return entries.slice(0, maxRows);
}

/* -------------------------------------------------------------------------- */
/* computeTrading                                                             */
/* -------------------------------------------------------------------------- */

export function computeTrading(input: ManagerPulseInput): ManagerTrading {
  const { trades, players, handles, leagueSeasons, settings } = input;
  const samples = settings.samples;

  const dynastyTrades = tradesForLens(trades, "dynasty");
  const redraftTrades = tradesForLens(trades, "redraft");

  const dynastyCount = dynastyTrades.length;
  const redraftCount = redraftTrades.length;

  const dynastySeasons = distinctSeasonsForLens(leagueSeasons, "dynasty");
  const redraftSeasons = distinctSeasonsForLens(leagueSeasons, "redraft");
  const allSeasons = distinctSeasonsAll(leagueSeasons);

  const tradeCount: PoolableStat<number> = {
    all: dynastyCount + redraftCount,
    dynasty: dynastyCount,
    redraft: redraftCount,
  };

  const tradesPerSeason: PoolableStat<number> = {
    all: allSeasons > 0 ? (dynastyCount + redraftCount) / allSeasons : null,
    dynasty: dynastySeasons > 0 ? dynastyCount / dynastySeasons : null,
    redraft: redraftSeasons > 0 ? redraftCount / redraftSeasons : null,
  };

  const dynastyMargin = computeMargin(dynastyTrades, samples.minTradesForMargin);
  const redraftMargin = computeMargin(redraftTrades, samples.minTradesForMargin);

  const avgValueMargin: PerTypeStat<number> = {
    dynasty: dynastyMargin.value,
    redraft: redraftMargin.value,
  };
  const avgValueMarginSampleSize: PerTypeStat<number> = {
    dynasty: dynastyMargin.sampleSize,
    redraft: redraftMargin.sampleSize,
  };

  const verdictDistribution: PerTypeStat<TradeVerdictCounts> = {
    dynasty: verdictDistributionForLens(dynastyTrades, settings.wording),
    redraft: verdictDistributionForLens(redraftTrades, settings.wording),
  };

  const positionAppetite: PerTypeStat<PositionAppetite> = {
    dynasty: positionAppetiteForLens(dynastyTrades, players, "dynasty", samples.minTradesForPositionLean),
    redraft: positionAppetiteForLens(redraftTrades, players, "redraft", samples.minTradesForPositionLean),
  };

  const ageLeanResult = computeAgeLean(dynastyTrades, players, samples.minTradesForAgeLean);

  const picksTraded: PerTypeStat<number> = {
    dynasty: picksTradedForLens(dynastyTrades),
    redraft: picksTradedForLens(redraftTrades),
  };

  const pickFlow: PerTypeStat<PickFlow> = {
    dynasty: pickFlowForLens(dynastyTrades, settings.display.pickRoundsShown),
    redraft: pickFlowForLens(redraftTrades, settings.display.pickRoundsShown),
  };

  const tradesShown = settings.display.tradesShown;

  const mostTradedWith: PerTypeStat<TradePartnerEntry[]> = {
    dynasty: mostTradedWithForLens(dynastyTrades, handles, tradesShown),
    redraft: mostTradedWithForLens(redraftTrades, handles, tradesShown),
  };

  const overpays: PerTypeStat<OverpayEntry[]> = {
    dynasty: overpaysForLens(dynastyTrades, players, "dynasty", samples.minOverpaySample, tradesShown),
    redraft: overpaysForLens(redraftTrades, players, "redraft", samples.minOverpaySample, tradesShown),
  };

  const bargains: PerTypeStat<OverpayEntry[]> = {
    dynasty: overpaysForLens(
      dynastyTrades,
      players,
      "dynasty",
      samples.minOverpaySample,
      tradesShown,
      "bargain",
    ),
    redraft: overpaysForLens(
      redraftTrades,
      players,
      "redraft",
      samples.minOverpaySample,
      tradesShown,
      "bargain",
    ),
  };

  const tradesWithUnpricedPicks: PerTypeStat<number> = {
    dynasty: tradesWithUnpricedPicksForLens(dynastyTrades),
    redraft: tradesWithUnpricedPicksForLens(redraftTrades),
  };

  return {
    tradeCount,
    tradesPerSeason,
    avgValueMargin,
    avgValueMarginSampleSize,
    verdictDistribution,
    positionAppetite,
    ageLean: ageLeanResult.value,
    ageLeanSampleSize: ageLeanResult.sampleSize,
    picksTraded,
    pickFlow,
    mostTradedWith,
    overpays,
    bargains,
    tradesWithUnpricedPicks,
  };
}

/* -------------------------------------------------------------------------- */
/* buildTendencySlice (section 8.1)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The compact per-lens slice Trade Ideas reads. Built here, not in a second
 * module, because every figure it carries already exists in this file: a
 * second implementation would let the report and Trade Ideas disagree about
 * the same manager with nothing to say which one is right.
 *
 * Returns null when the lens is a true absence: zero trades AND zero
 * league-seasons, meaning we have never seen this manager play this game
 * type at all. A manager who has played redraft leagues but never traded in
 * one gets a real slice with `tradeCount: 0`, because that is a fact about
 * them; a manager we have simply never seen in redraft gets null, because
 * there is nothing to report.
 */
export function buildTendencySlice(
  input: ManagerPulseInput,
  lens: Lens,
  favouritePlayerIds: string[],
  avoidPlayerIds: string[],
): TendencySlice | null {
  const trades = tradesForLens(input.trades, lens);
  const seasons = distinctSeasonsForLens(input.leagueSeasons, lens);

  if (trades.length === 0 && seasons === 0) return null;

  const samples = input.settings.samples;
  const tendency = input.settings.tendency;

  const margin = computeMargin(trades, samples.minTradesForMargin);
  const positionAppetite =
    positionAppetiteForLens(trades, input.players, lens, samples.minTradesForPositionLean) ?? {};
  const ageLean =
    lens === "dynasty" ? computeAgeLean(trades, input.players, samples.minTradesForAgeLean).value : null;
  const picksTraded = picksTradedForLens(trades);

  // Confidence is banded on the count of GRADED trades: an ungraded trade is
  // real evidence that a manager trades, but it says nothing about whether
  // they pay up, so it should not inflate the confidence behind a
  // value-priced tendency.
  const gradedCount = gradedTrades(trades).length;
  const confidence: TendencySlice["confidence"] =
    gradedCount <= tendency.confidenceLowMax
      ? "low"
      : gradedCount <= tendency.confidenceMediumMax
        ? "medium"
        : "high";

  return {
    tradeCount: trades.length,
    tradesPerSeason: seasons > 0 ? trades.length / seasons : 0,
    avgValueMargin: margin.value,
    positionAppetite,
    ageLean,
    picksTraded,
    favouritePlayerIds,
    avoidPlayerIds,
    sampleSize: gradedCount,
    confidence,
  };
}
