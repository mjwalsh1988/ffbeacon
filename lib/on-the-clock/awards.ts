/**
 * On The Clock startup-draft awards (Rankings & Awards tab).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the data the cockpit already holds (per-team rollups, the
 * league's completed trades, the made picks, and the league's starting-slot model)
 * into six live awards that re-resolve on every resync:
 *   - Most Active Trader      (The Signal Flare Award): most completed trades.
 *   - Most Successful Trader  (The Value Beacon Award): best AVERAGE FF Beacon value
 *     margin per trade (value received minus value given, averaged over their trades),
 *     gated to a minimum trade count so trade volume alone cannot win it.
 *   - First to Fill Starting Roster (The Full Beam Award): first team to fill every
 *     required starting slot, by overall pick number.
 *   - Most Boring League Mate (The Dead Air Award): fewest completed trades.
 *   - Best Drafter            (The North Star Award): most SURPLUS VALUE captured
 *     against the market (see surplus.ts). Rewards beating the market where a
 *     pick is expensive, not simply holding more picks.
 *   - Worst Drafter           (The Lost Signal Award): the exact mirror, lowest
 *     surplus: the drafter who paid the most over the market price.
 *
 * Plus seven that only became possible once the room could project points
 * (draft-pulse.ts) and read projection accuracy:
 *   - Best Starting Lineup    (The Full Signal Award): highest Draft Pulse.
 *   - Best Long-Term Build    (The Long Game Award): dynasty only. Owns the most
 *     and wins the least right now. That gap IS the rebuild.
 *   - Most Reliable Roster    (The Sure Thing Award): highest points-weighted
 *     beat rate among projected starters.
 *   - Most Volatile Roster    (The Glass Cannon Award): highest weekly spread
 *     relative to the mean.
 *   - Most Available Roster   (The Iron Man Award): highest weighted availability.
 *   - Best Single Pick        (The Steal of the Draft): largest single surplus.
 *   - Biggest Single Reach    (The Reach of the Draft): the mirror.
 *
 * Trade values reuse trade-history.ts analyzeTradeTransaction, the same FF Beacon
 * board projection the Trade History tab uses, so an award and the tab can never
 * disagree about who won a deal, and no DB round trip is needed. The interactive
 * Trade Analyzer routes through Signal Check instead, because a trade the user is
 * BUILDING deserves the full ruleset; grading a league's whole completed trade
 * history through it would mean one server analysis per historical trade to fill
 * in a card.
 *
 * Best / Worst Drafter share ONE per-roster surplus total (surplus.ts); North Star
 * takes the max and Lost Signal the min, so both judge market timing rather than
 * raw roster value.
 *
 * Every award stays "up for grabs" until it can be earned honestly: trade awards
 * until at least one trade exists and there is a standout, the drafter awards until
 * at least two teams have ADP-known picks with distinct totals, and the
 * starting-roster award until a team actually completes its lineup. Exact ties
 * surface every co-winner.
 */

import type { DraftPosition, RankedPlayer } from "./board-types";
import type { OnTheClockSettings, ShapedPick } from "./types";
import type { DraftPulseTeam } from "./draft-pulse";
import { buildMarketCurve, computePickSurplus, surplusByRoster } from "./surplus";
import { tradeMarginsFor } from "./trade-margins";
import type { TeamRollup } from "./rosters";
import {
  analyzeTradeTransaction,
  type HistoryTransaction,
  type TradeHistoryContext,
} from "./trade-history";
import { buildSlotModel, assignToSlots } from "./recommend";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type AwardId =
  | "most-active-trader"
  | "most-successful-trader"
  | "first-starting-roster"
  | "most-boring"
  | "best-drafter"
  | "worst-drafter"
  | "best-starting-lineup"
  | "long-game"
  | "most-reliable"
  | "boom-bust"
  | "iron-man"
  | "steal-of-draft"
  | "reach-of-draft";

/**
 * The award-set contract version frozen into a snapshot. A snapshot written
 * before the projection-backed awards existed is version 1 and renders the
 * original six rather than a grid with seven permanently empty cards.
 */
export const AWARDS_VERSION = 2;

/** One team that currently holds an award (usually one; more on an exact tie). */
export interface AwardClaimant {
  rosterId: number;
  /** Owner's Sleeper username / display name (the primary label). */
  ownerName: string;
  /** Custom team name shown subtly after the username, or null. */
  teamName: string | null;
  /** Raw Sleeper avatar id (owner avatar), or null. The UI builds the URL. */
  avatar: string | null;
  isYou: boolean;
}

export interface Award {
  id: AwardId;
  /** The flavor name, e.g. "The Signal Flare Award". */
  title: string;
  /** The plain category, e.g. "Most Active Trader". */
  category: string;
  /** One-line description of how it is earned. */
  description: string;
  /** Winning team(s). Empty when pending. */
  claimants: AwardClaimant[];
  /** Short human metric for the winner(s), e.g. "3 trades". null when pending. */
  metricLabel: string | null;
  /** True when no team qualifies yet (the award is up for grabs). */
  pending: boolean;
  /** Why it is pending (shown on the card in the pending state). */
  pendingLabel: string;
  /**
   * For the two pick awards, the single pick that earned it. Absent on team
   * awards. Rendered under the claimant so the card names the actual moment.
   */
  pickHighlight?: {
    playerName: string;
    position: string | null;
    pickNo: number;
    /** Signed surplus, already rounded for display. */
    surplus: number;
  } | null;
}

export interface DraftAwardsInput {
  /** Per-team rollups (already ranked). Source of names + drafted-player value. */
  rollups: TeamRollup[];
  /** roster_id -> Sleeper avatar id (owner avatar). Missing -> null. */
  avatarByRosterId: Record<number, string | null>;
  /** Completed league trades (the route already drops failed ones). */
  transactions: HistoryTransaction[];
  /** Board/draft context for trade valuation. null -> the value award stays pending. */
  tradeContext: TradeHistoryContext | null;
  /** Every made pick in the current draft (drafted players, in any order). */
  picks: ShapedPick[];
  /** Sleeper draft.settings (slot counts + teams), for the starting-slot model. */
  draftSettings: Record<string, number>;
  /** Admin settings (fallback slot targets when the draft omits slot counts). */
  settings: OnTheClockSettings;
  /**
   * Sleeper player id -> ADP (overall pick number) for the draft's resolved ADP
   * market. Kept for the board indicators and the pending copy. Pass {} when no
   * ADP snapshot exists; the drafting awards then stay pending.
   */
  adpBySleeperId: Record<string, number>;
  /**
   * The FULL board, used to build the market price curve for surplus value and
   * to value each made pick. Empty leaves the drafting awards pending.
   */
  board: RankedPlayer[];
  /** Draft Pulse standings, when projections were available. Empty is fine. */
  pulseTeams: DraftPulseTeam[];
  /** True for a dynasty format; gates the dynasty-only Long Game award. */
  isDynasty: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a Sleeper pick position string to one of the six draft buckets. */
function coercePosition(pos: string | null | undefined): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

function fmtValue(v: number): string {
  return Math.round(v).toLocaleString();
}

function tradeWord(n: number): string {
  return `${n} ${n === 1 ? "trade" : "trades"}`;
}

/** Rosters that took part in a single trade (gave OR got any asset). */
function participants(txn: HistoryTransaction): Set<number> {
  const s = new Set<number>();
  for (const r of txn.rosterIds) s.add(r);
  for (const r of Object.values(txn.adds)) s.add(r);
  for (const r of Object.values(txn.drops)) s.add(r);
  for (const p of txn.picks) {
    if (p.newOwnerRosterId != null) s.add(p.newOwnerRosterId);
    if (p.previousOwnerRosterId != null) s.add(p.previousOwnerRosterId);
  }
  for (const f of txn.faab) {
    s.add(f.sender);
    s.add(f.receiver);
  }
  return s;
}

function buildClaimantBase(
  rollups: TeamRollup[],
  avatarByRosterId: Record<number, string | null>,
): Map<number, AwardClaimant> {
  const m = new Map<number, AwardClaimant>();
  for (const r of rollups) {
    m.set(r.rosterId, {
      rosterId: r.rosterId,
      ownerName: r.ownerName,
      teamName: r.teamName,
      avatar: avatarByRosterId[r.rosterId] ?? null,
      isYou: r.isYou,
    });
  }
  return m;
}

interface ExtremeResult {
  claimants: AwardClaimant[];
  extreme: number | null;
  /** True when every eligible team shares the extreme value (no standout). */
  allTied: boolean;
}

/**
 * The eligible team(s) holding the max/min of `values`. `allTied` is true when
 * every eligible team has the same value, which the callers treat as "no winner
 * yet" so an undifferentiated field (e.g. everyone at zero trades) reads as pending
 * rather than crowning the whole league.
 */
function pickExtreme(
  base: Map<number, AwardClaimant>,
  values: Map<number, number>,
  eligibleIds: number[],
  dir: "max" | "min",
): ExtremeResult {
  if (eligibleIds.length === 0) return { claimants: [], extreme: null, allTied: false };
  let extreme = values.get(eligibleIds[0]) ?? 0;
  for (const id of eligibleIds) {
    const v = values.get(id) ?? 0;
    if (dir === "max" ? v > extreme : v < extreme) extreme = v;
  }
  const winners = eligibleIds.filter((id) => (values.get(id) ?? 0) === extreme);
  const claimants = winners
    .map((id) => base.get(id))
    .filter((c): c is AwardClaimant => c != null)
    .sort((a, b) => a.rosterId - b.rosterId);
  return { claimants, extreme, allTied: winners.length === eligibleIds.length };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const ZERO_HAVE: Record<DraftPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

/**
 * The Most Successful Trader ladder, seeded from the admin's configured minimum.
 * It relaxes one step at a time down to a single trade, so a low-volume league
 * still surfaces a winner rather than leaving the award permanently up for
 * grabs. The original hardcoded default was 3, which is where the admin setting
 * starts: high enough that a single lopsided trade cannot steal the award.
 */
function traderThresholds(minimum: number): number[] {
  const start = Math.max(1, Math.round(minimum));
  const out: number[] = [];
  for (let n = start; n >= 1; n -= 1) out.push(n);
  return out;
}

/**
 * Compute every award. Deterministic and side-effect free. Returns them in the
 * fixed product order, with any award the admin has switched off removed.
 * Callers render the array directly.
 */
export function computeDraftAwards(input: DraftAwardsInput): Award[] {
  const {
    rollups,
    avatarByRosterId,
    transactions,
    tradeContext,
    picks,
    draftSettings,
    settings,
    adpBySleeperId,
    board,
    pulseTeams,
    isDynasty,
  } = input;

  const base = buildClaimantBase(rollups, avatarByRosterId);
  const rosterIds = rollups.map((r) => r.rosterId);
  const anyTrades = transactions.length > 0;

  // ---- Trade counts (board not required): participants per completed trade ----
  const tradeCount = new Map<number, number>();
  for (const id of rosterIds) tradeCount.set(id, 0);
  for (const txn of transactions) {
    for (const rid of participants(txn)) {
      if (tradeCount.has(rid)) tradeCount.set(rid, (tradeCount.get(rid) ?? 0) + 1);
    }
  }

  // ---- Per-trade value margin (needs the FF Beacon board context) ----
  // For each completed trade, a roster's margin is the value it received minus the
  // value it gave away in THAT trade. We track the running sum of those margins and
  // the count of trades each roster moved value in, so the Most Successful Trader can
  // be judged by AVERAGE margin per trade rather than a cumulative total (which just
  // tracks trade volume and would duplicate Most Active Trader).
  // ONE per-roster margin computation, shared with the draft grades (see
  // trade-margins.ts). It used to be duplicated here, which meant an award and a
  // grade could quietly disagree about who won a deal.
  const rosterIdSet = new Set(rosterIds);
  const marginSum = new Map<number, number>();
  const marginTradeCount = new Map<number, number>();
  const netReady = tradeContext != null;
  for (const [rosterId, margin] of tradeMarginsFor(transactions, tradeContext)) {
    if (!rosterIdSet.has(rosterId)) continue;
    marginSum.set(rosterId, margin.total);
    marginTradeCount.set(rosterId, margin.trades);
  }

  // Average margin per trade, per roster (only rosters that actually moved value).
  const avgMargin = new Map<number, number>();
  for (const id of rosterIds) {
    const c = marginTradeCount.get(id) ?? 0;
    if (c > 0) avgMargin.set(id, (marginSum.get(id) ?? 0) / c);
  }

  // ---- Surplus value against the market (best AND worst drafter) ----
  // Per roster: the sum, over its made non-keeper picks, of what the player was
  // worth minus what the market said that slot was worth (see surplus.ts). This
  // replaced a sum of (pick_no - ADP), which rewarded holding more picks and
  // valued a round-one bargain the same as a round-fourteen one. Keepers are
  // excluded: their slot is assigned, not a market decision. North Star takes
  // the max; Lost Signal takes the min of the same totals.
  const valueByPlayerId = new Map<string, number>();
  const valueBySleeperId = new Map<string, number>();
  for (const p of board) {
    valueByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) valueBySleeperId.set(p.sleeperId, p.value);
  }
  const curve = buildMarketCurve(board);
  const pickSurpluses = computePickSurplus({ picks, valueByPlayerId, valueBySleeperId, curve });
  const surplusTotals = surplusByRoster(pickSurpluses);
  const adpDeltaSum = new Map<number, number>();
  const adpPickCount = new Map<number, number>();
  for (const [rosterId, entry] of surplusTotals) {
    adpDeltaSum.set(rosterId, entry.total);
    adpPickCount.set(rosterId, entry.count);
  }
  const minAdpPicks = Math.max(1, settings.awards.minAdpPicks);
  const adpEligibleIds = rosterIds.filter((id) => (adpPickCount.get(id) ?? 0) >= minAdpPicks);

  // ---- First to fill the starting lineup ----
  const completionPick = computeStartingRosterCompletion(picks, draftSettings, settings, base);

  const awards: Award[] = [];

  // 1. Most Active Trader, The Signal Flare Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "max");
    const pending = !anyTrades || r.allTied || r.extreme == null || r.extreme <= 0;
    awards.push({
      id: "most-active-trader",
      title: "The Signal Flare Award",
      category: "Most Active Trader",
      description: "Fires off the most completed trades during the draft.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel: "No trades have gone through yet. This one is up for grabs.",
    });
  }

  // 2. Most Successful Trader, The Value Beacon Award.
  {
    // Judge by AVERAGE value margin per trade, so the sharpest dealmaker wins rather
    // than simply the busiest trader. Qualify on a minimum trade count that relaxes
    // 3 -> 2 -> 1 when no team meets the higher bar (see traderThresholds).
    let candidateIds: number[] = [];
    for (const threshold of traderThresholds(settings.awards.minSuccessfulTraderTrades)) {
      const ids = rosterIds.filter((id) => (marginTradeCount.get(id) ?? 0) >= threshold);
      if (ids.length > 0) {
        candidateIds = ids;
        break;
      }
    }
    const r = pickExtreme(base, avgMargin, candidateIds, "max");
    const pending =
      !netReady || !anyTrades || candidateIds.length === 0 || r.extreme == null || r.extreme <= 0;
    // Surface the winner's trade count beside the average when every co-winner shares
    // it (the common single-winner case); otherwise show the average alone.
    const winnerCounts = r.claimants.map((c) => marginTradeCount.get(c.rosterId) ?? 0);
    const sharedCount =
      winnerCounts.length > 0 && winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    awards.push({
      id: "most-successful-trader",
      title: "The Value Beacon Award",
      category: "Most Successful Trader",
      description: "Earns the best average FF Beacon value per trade across their deals.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `+${fmtValue(r.extreme!)} avg value per trade across ${tradeWord(sharedCount)}`
          : `+${fmtValue(r.extreme!)} avg value per trade`,
      pending,
      pendingLabel: netReady
        ? "No team has a winning trade average yet. Up for grabs."
        : "Trade values are still loading.",
    });
  }

  // 3. First to Fill Starting Roster, The Full Beam Award.
  {
    const completedIds = [...completionPick.keys()];
    const pending = completedIds.length === 0;
    let claimants: AwardClaimant[] = [];
    let metricLabel: string | null = null;
    if (!pending) {
      let minPick = Infinity;
      for (const v of completionPick.values()) minPick = Math.min(minPick, v);
      claimants = completedIds
        .filter((id) => completionPick.get(id) === minPick)
        .map((id) => base.get(id))
        .filter((c): c is AwardClaimant => c != null)
        .sort((a, b) => a.rosterId - b.rosterId);
      metricLabel = `Filled at pick ${minPick}`;
    }
    awards.push({
      id: "first-starting-roster",
      title: "The Full Beam Award",
      category: "First to Fill Starting Roster",
      description: "First team to fill every required starting spot.",
      claimants,
      metricLabel,
      pending,
      pendingLabel: "No team has filled every starting spot yet. Up for grabs.",
    });
  }

  // 4. Most Boring League Mate, The Dead Air Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "min");
    const pending = !anyTrades || r.allTied || r.extreme == null;
    awards.push({
      id: "most-boring",
      title: "The Dead Air Award",
      category: "Most Boring League Mate",
      description: "Makes the fewest trades while the rest of the league wheels and deals.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel: "Nobody has traded yet, so no one is in the doghouse.",
    });
  }

  // 5. Best Drafter (The North Star Award). Judged against the market in FF
  // Beacon value: the team whose picks were worth the most MORE than the market
  // price of the slots they used (see surplus.ts). A round-one bargain therefore
  // counts for more than a round-fourteen one, which the old pick-number metric
  // could not express. Uses the ADP map the caller resolved for THIS draft (the
  // locked snapshot for completed drafts), never live market data.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "max");
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const pending = noMarket || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const winnerCounts = r.claimants.map((c) => adpPickCount.get(c.rosterId) ?? 0);
    const sharedCount =
      winnerCounts.length > 0 && winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    const signed = r.extreme == null ? "" : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "best-drafter",
      title: "The North Star Award",
      category: "Best Drafter",
      description: "Gets the most value for the draft slots they spent.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} value over market across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} value over market`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so there is no market to beat."
        : `Not enough teams have made ${minAdpPicks} priced picks yet.`,
    });
  }

  // 6. Worst Drafter (The Lost Signal Award). The exact mirror of North Star:
  // the team that paid the most OVER the market price of the slots it used.
  // Same per-draft market curve, so the loser is as stable as the winner.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "min");
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const pending = noMarket || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const loserCounts = r.claimants.map((c) => adpPickCount.get(c.rosterId) ?? 0);
    const sharedCount =
      loserCounts.length > 0 && loserCounts.every((c) => c === loserCounts[0])
        ? loserCounts[0]
        : null;
    const signed = r.extreme == null ? "" : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "worst-drafter",
      title: "The Lost Signal Award",
      category: "Worst Drafter",
      description: "Pays the most over market for the draft slots they spent.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} value over market across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} value over market`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so nobody is on the hook."
        : `Not enough teams have made ${minAdpPicks} priced picks yet.`,
    });
  }

  // ---- Projection-backed awards ----
  // Every one of these needs Draft Pulse, which needs Sleeper's weekly
  // projections scored under the league's own settings. When projections are
  // unavailable the whole group stays pending with a truthful reason rather than
  // being computed from something weaker that looks the same on the card.
  const pulseById = new Map<number, DraftPulseTeam>();
  for (const t of pulseTeams) pulseById.set(t.rosterId, t);
  const minPlayers = Math.max(1, settings.awards.minPlayersForLineupAwards);
  const lineupEligibleIds = rosterIds.filter((id) => {
    const t = pulseById.get(id);
    return t != null && t.projectedCount >= minPlayers;
  });
  const noPulse = pulseTeams.length === 0;
  const pulsePendingLabel = noPulse
    ? "Weekly projections are not available for this league yet, so nothing has been scored."
    : `No team has ${minPlayers} projected players yet.`;

  // 7. Best Starting Lineup (The Full Signal Award).
  {
    const values = new Map<number, number>();
    for (const id of lineupEligibleIds) values.set(id, pulseById.get(id)?.meanStartingPoints ?? 0);
    const r = pickExtreme(base, values, lineupEligibleIds, "max");
    const pending = noPulse || lineupEligibleIds.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "best-starting-lineup",
      title: "The Full Signal Award",
      category: "Best Starting Lineup",
      description: "Projects the most points from their starting lineup each week.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : `${r.extreme!.toFixed(1)} projected points a week`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 8. Best Long-Term Build (The Long Game Award). Dynasty only, and it is the
  // gap that earns it: owning the most while projecting near the bottom right
  // now is the signature of a rebuild, and it is a compliment here rather than
  // an accusation. In a redraft league the same gap would just be a bad team.
  {
    const gaps = new Map<number, number>();
    const teamCount = rosterIds.length;
    if (isDynasty && teamCount > 1) {
      const valueRank = new Map<number, number>();
      rollups.forEach((r) => valueRank.set(r.rosterId, r.rank));
      for (const id of lineupEligibleIds) {
        const pulse = pulseById.get(id);
        const vRank = valueRank.get(id);
        if (!pulse || vRank == null) continue;
        // Both as percentiles so an eight-team league and a sixteen read alike.
        const valuePct = (teamCount - vRank) / (teamCount - 1);
        const pulsePct = (teamCount - pulse.rank) / (teamCount - 1);
        gaps.set(id, valuePct - pulsePct);
      }
    }
    const eligible = [...gaps.keys()];
    const r = pickExtreme(base, gaps, eligible, "max");
    const pending =
      !isDynasty || noPulse || eligible.length < 2 || r.allTied || r.extreme == null || r.extreme <= 0;
    awards.push({
      id: "long-game",
      title: "The Long Game Award",
      category: "Best Long-Term Build",
      description: "Owns far more than they start: the clearest rebuild in the room.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `${Math.round(r.extreme * 100)} percentile points more value than lineup`,
      pending,
      pendingLabel: !isDynasty
        ? "This is a redraft league, where every team is trying to win now."
        : noPulse
          ? pulsePendingLabel
          : "No team is holding more than it starts yet.",
    });
  }

  // 9. Most Reliable Roster (The Sure Thing Award).
  {
    const minWeeks = settings.awards.minAccuracyWeeks;
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.starterBeatRate == null) continue;
      // The gate the pending copy promises. A beat rate over one week is a
      // number, not evidence, and crowning it would make the card a lie.
      if ((t.starterWeeksPlayed ?? 0) < minWeeks) continue;
      values.set(id, t.starterBeatRate);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    const pending = noPulse || eligible.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "most-reliable",
      title: "The Sure Thing Award",
      category: "Most Reliable Roster",
      description: "Their starters beat their projections more often than anyone else's.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null ? null : `Starters beat projection ${Math.round(r.extreme * 100)}% of weeks`,
      pending,
      pendingLabel: noPulse
        ? pulsePendingLabel
        : `Not enough teams have starters with ${minWeeks} weeks of history yet.`,
    });
  }

  // 10. Most Volatile Roster (The Glass Cannon Award). Spread relative to the
  // mean, not raw spread: a high-scoring lineup swings more in absolute points
  // simply for being high-scoring, and calling that volatility would just crown
  // the best team twice.
  {
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.meanStartingPoints <= 0) continue;
      values.set(id, t.sigma / t.meanStartingPoints);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    const pending = noPulse || eligible.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "boom-bust",
      title: "The Glass Cannon Award",
      category: "Most Volatile Roster",
      description: "The widest weekly swing in the league, for better and worse.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null ? null : `Weekly swing of ${Math.round(r.extreme * 100)}% of their average`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 11. Most Available Roster (The Iron Man Award).
  {
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.starterAvailability == null) continue;
      values.set(id, t.starterAvailability);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    const pending = noPulse || eligible.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "iron-man",
      title: "The Iron Man Award",
      category: "Most Available Roster",
      description: "Drafted the starters most likely to actually be on the field.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null ? null : `Starters available ${Math.round(r.extreme * 100)}% of weeks`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 12 and 13. The two pick awards. These name a moment rather than a season, so
  // they carry a pickHighlight and their claimant is whoever made that one pick.
  {
    const sorted = pickSurpluses.slice().sort((a, b) => b.surplus - a.surplus);
    const steal = sorted[0] ?? null;
    const reach = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;

    const stealPending = noMarket || steal === null || steal.surplus <= 0;
    awards.push({
      id: "steal-of-draft",
      title: "The Steal of the Draft",
      category: "Best Single Pick",
      description: "The one pick that beat its slot by the widest margin.",
      claimants: stealPending || !steal ? [] : [base.get(steal.rosterId)].filter((c): c is AwardClaimant => c != null),
      metricLabel: stealPending || !steal ? null : `+${fmtValue(steal.surplus)} over the market price of pick ${steal.pickNo}`,
      pending: stealPending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so there is no market to beat."
        : "No pick has beaten its slot yet.",
      pickHighlight:
        stealPending || !steal
          ? null
          : {
              playerName: steal.playerName,
              position: steal.position,
              pickNo: steal.pickNo,
              surplus: Math.round(steal.surplus),
            },
    });

    const reachPending = noMarket || reach === null || reach.surplus >= 0;
    awards.push({
      id: "reach-of-draft",
      title: "The Reach of the Draft",
      category: "Biggest Single Reach",
      description: "The one pick that paid the most over its slot.",
      claimants: reachPending || !reach ? [] : [base.get(reach.rosterId)].filter((c): c is AwardClaimant => c != null),
      metricLabel:
        reachPending || !reach ? null : `${fmtValue(Math.abs(reach.surplus))} under the market price of pick ${reach.pickNo}`,
      pending: reachPending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so nobody is on the hook."
        : "No pick has come in under its slot yet.",
      pickHighlight:
        reachPending || !reach
          ? null
          : {
              playerName: reach.playerName,
              position: reach.position,
              pickNo: reach.pickNo,
              surplus: Math.round(reach.surplus),
            },
    });
  }

  // Admin can switch any award off. A missing key means on, so a settings row
  // written before an award existed never hides it.
  return awards.filter((a) => settings.awards.enabled[a.id] !== false);
}

/**
 * For each team, the overall pick number at which it first filled every required
 * starting slot (dedicated + FLEX + SUPER_FLEX + K/DEF, per the league's slot
 * model). Teams that have not completed their lineup are absent from the map.
 */
function computeStartingRosterCompletion(
  picks: ShapedPick[],
  draftSettings: Record<string, number>,
  settings: OnTheClockSettings,
  base: Map<number, AwardClaimant>,
): Map<number, number> {
  const model = buildSlotModel(draftSettings, settings);
  const totalSlots =
    model.QB + model.RB + model.WR + model.TE + model.FLEX + model.SUPER_FLEX + model.K + model.DEF;
  const completion = new Map<number, number>();
  if (totalSlots <= 0) return completion;

  // Group each team's made picks (with a coercible position) ascending by pick no.
  // A pick whose position will not coerce (an unmapped player with no position in
  // the cached metadata) is skipped, so a team holding such a starter could have its
  // Full Beam completion delayed until that slot is filled by a mappable pick. This
  // is rare (the sync resolves most ids) and degrades safely toward "not yet filled".
  const byRoster = new Map<number, { pickNo: number; pos: DraftPosition }[]>();
  for (const pk of picks) {
    if (pk.rosterId == null || !base.has(pk.rosterId)) continue;
    const pos = coercePosition(pk.position);
    if (!pos) continue;
    const arr = byRoster.get(pk.rosterId) ?? [];
    arr.push({ pickNo: pk.pickNo, pos });
    byRoster.set(pk.rosterId, arr);
  }

  for (const [rid, list] of byRoster) {
    const sorted = list.slice().sort((a, b) => a.pickNo - b.pickNo);
    const have: Record<DraftPosition, number> = { ...ZERO_HAVE };
    for (const item of sorted) {
      have[item.pos] += 1;
      const open = assignToSlots(have, model);
      const remaining =
        open.QB + open.RB + open.WR + open.TE + open.FLEX + open.SUPER_FLEX + open.K + open.DEF;
      if (remaining === 0) {
        completion.set(rid, item.pickNo);
        break;
      }
    }
  }
  return completion;
}
